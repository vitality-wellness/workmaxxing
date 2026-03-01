import { Command } from "commander";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { getDb } from "../store/db.js";
import { GateRepo } from "../store/gate-repo.js";
import { AuditRepo } from "../store/audit-repo.js";
import { TicketWorkflowRepo } from "../store/ticket-workflow-repo.js";
import { getWorkflowConfig } from "../engine/workflow-config.js";
import { validateGateEvidence } from "../engine/state-machine.js";
import { resolveWorkflow, requireWorkflow } from "../resolve-workflow.js";
import { detectGatesFromComment } from "../engine/gate-detection.js";
import { getNextDirective, getDirectiveForGate } from "../engine/directives.js";

/** Maps ticket-scoped gates to the ticket stage they advance to */
const GATE_NEXT_STAGE: Record<string, string> = {
  ticket_in_progress: "INVESTIGATING",
  investigation: "IMPLEMENTING",
  code_committed: "CODE_REVIEWING",
  coderabbit_review: "CROSS_REFING",
  findings_crossreferenced: "FIXING",
  findings_resolved: "VERIFYING_ACS",
  acceptance_criteria: "DONE",
};

export const gateCommand = new Command("gate").description(
  "Manage workflow gates (checkpoints)"
);

gateCommand
  .command("record")
  .description("Record a gate as passed with evidence")
  .argument("<name>", "Gate name")
  .option("--evidence <json>", "Evidence JSON", "{}")
  .option("--repo <path>", "Repository path", process.cwd())
  .option("-w, --workflow <id>", "Workflow ID (or set POWR_WF env var)")
  .option("-t, --ticket <id>", "Ticket ID (e.g., POWR-500) — scopes gate to a ticket workflow")
  .option("--json", "Output as JSON")
  .action(
    (
      name: string,
      opts: {
        evidence: string;
        repo: string;
        workflow?: string;
        ticket?: string;
        json?: boolean;
      }
    ) => {
      const db = getDb();
      const gates = new GateRepo(db);
      const audit = new AuditRepo(db);
      const ticketWorkflows = new TicketWorkflowRepo(db);

      const workflow = requireWorkflow(db, opts);

      let evidence: Record<string, unknown>;
      try {
        evidence = JSON.parse(opts.evidence) as Record<string, unknown>;
      } catch {
        console.error("Error: --evidence must be valid JSON.");
        process.exit(2);
      }

      // --- Evidence schema validation ---
      const validation = validateGateEvidence(name, evidence);
      if (!validation.valid) {
        console.error(`Error: ${validation.error}`);
        process.exit(2);
      }

      // --- Validate tickets_created evidence has real ticket IDs ---
      if (name === "tickets_created") {
        const ticketIds = evidence.ticketIds;
        const placeholderPattern = /^[A-Z]+-[Xx]+$/;
        if (
          !Array.isArray(ticketIds) ||
          ticketIds.length === 0 ||
          ticketIds.some(
            (id: unknown) =>
              typeof id !== "string" ||
              id.trim() === "" ||
              placeholderPattern.test(id)
          )
        ) {
          console.error(
            'Error: tickets_created requires real ticket IDs in evidence.ticketIds (e.g., ["POWR-500"]). ' +
              "Placeholder values like POWR-XXX are not allowed."
          );
          process.exit(2);
        }
      }

      // --- File existence check for spec/plan gates ---
      if (name === "spec_document_written" || name === "plan_written") {
        const filePath = evidence.path as string;
        if (!existsSync(filePath)) {
          console.error(
            `Error: File "${filePath}" does not exist. The ${name} gate requires a real file path.`
          );
          process.exit(2);
        }
      }

      // --- Commit SHA validation for code_committed ---
      if (name === "code_committed") {
        const sha = evidence.commitSha as string;
        try {
          execSync(`git rev-parse --verify "${sha}"`, {
            stdio: "pipe",
            cwd: opts.repo,
          });
        } catch {
          console.error(
            `Error: Commit SHA "${sha}" is not a valid commit. The code_committed gate requires a real commit SHA.`
          );
          process.exit(2);
        }
      }

      // --- all_tickets_done verification ---
      if (name === "all_tickets_done") {
        if (!ticketWorkflows.allDone(workflow.id)) {
          const total = ticketWorkflows.countTotal(workflow.id);
          const done = ticketWorkflows.countByStage(workflow.id, "DONE");
          console.error(
            `Error: Not all tickets are done (${done}/${total} completed). Cannot record all_tickets_done.`
          );
          process.exit(2);
        }
      }

      // --- Resolve ticket workflow if --ticket provided ---
      let ticketWorkflowId: string | null = null;
      if (opts.ticket) {
        let tw = ticketWorkflows.findByTicketId(workflow.id, opts.ticket);
        if (!tw) {
          // Auto-create ticket_workflow
          tw = ticketWorkflows.create({
            workflowId: workflow.id,
            ticketId: opts.ticket,
            linearIssueId: opts.ticket,
          });
          if (!opts.json) {
            console.log(`Created ticket workflow for ${opts.ticket}`);
          }
        }
        ticketWorkflowId = tw.id;
      }

      gates.record({
        workflowId: workflow.id,
        ticketWorkflowId,
        gateName: name,
        evidence,
      });

      audit.log({
        workflowId: workflow.id,
        eventType: "gate_recorded",
        details: { gate: name, evidence, ticketId: opts.ticket ?? null },
      });

      if (opts.json) {
        console.log(JSON.stringify({ recorded: true, gate: name, ticketId: opts.ticket ?? null }));
      } else {
        console.log(`✅ Gate recorded: ${name}${opts.ticket ? ` (ticket: ${opts.ticket})` : ""}`);
      }

      // --- Auto-advance ticket stage ---
      if (ticketWorkflowId && GATE_NEXT_STAGE[name]) {
        ticketWorkflows.updateStage(ticketWorkflowId, GATE_NEXT_STAGE[name]!);
        if (!opts.json) {
          console.log(`  → Ticket stage advanced to ${GATE_NEXT_STAGE[name]}`);
        }
      }

      db.close();
    }
  );

gateCommand
  .command("check")
  .description("Check if a gate is passed")
  .argument("<name>", "Gate name")
  .option("--repo <path>", "Repository path", process.cwd())
  .option("-w, --workflow <id>", "Workflow ID (or set POWR_WF env var)")
  .action((name: string, opts: { repo: string; workflow?: string }) => {
    const db = getDb();
    const gates = new GateRepo(db);

    const workflow = resolveWorkflow(db, opts);
    if (!workflow) {
      process.exit(1);
    }

    const passed = gates.isPassed(workflow.id, name);
    process.exit(passed ? 0 : 1);
  });

gateCommand
  .command("list")
  .description("List all gates for current stage with status")
  .option("--repo <path>", "Repository path", process.cwd())
  .option("-w, --workflow <id>", "Workflow ID (or set POWR_WF env var)")
  .option("--json", "Output as JSON")
  .action((opts: { repo: string; workflow?: string; json?: boolean }) => {
    const db = getDb();
    const gates = new GateRepo(db);

    const workflow = requireWorkflow(db, opts);

    const config = getWorkflowConfig();
    const stageConfig = config.stages[workflow.stage];
    const requiredGates = stageConfig?.requiredGates ?? [];
    const passedGates = gates.getPassedNames(workflow.id);

    const gateList = requiredGates.map((g) => ({
      name: g,
      passed: passedGates.has(g),
    }));

    if (opts.json) {
      console.log(JSON.stringify({ stage: workflow.stage, gates: gateList }));
    } else {
      console.log(`Stage: ${workflow.stage}`);
      console.log();
      if (gateList.length === 0) {
        console.log("  No gates required for this stage.");
      }
      for (const gate of gateList) {
        console.log(`  ${gate.passed ? "✅" : "⬜"} ${gate.name}`);
      }
    }

    db.close();
  });

gateCommand
  .command("detect")
  .description("Auto-detect gates from Linear comment text")
  .option("--text <text>", "Comment text to analyze")
  .option("--repo <path>", "Repository path", process.cwd())
  .option("-w, --workflow <id>", "Workflow ID (or set POWR_WF env var)")
  .option("--json", "Output as JSON")
  .action(
    (opts: { text?: string; repo: string; workflow?: string; json?: boolean }) => {
      const text = opts.text ?? "";
      const detected = detectGatesFromComment(text);

      if (opts.json) {
        console.log(JSON.stringify(detected));
      } else {
        if (detected.length === 0) {
          console.log("No gates detected in comment.");
        } else {
          for (const d of detected) {
            const tag = d.confidence === "inferred" ? " (auto-passed)" : "";
            console.log(`  ✅ ${d.gate}${tag}`);
          }
        }
      }
    }
  );

gateCommand
  .command("next")
  .description("Show the mandatory next action based on current gate progress")
  .option("--repo <path>", "Repository path", process.cwd())
  .option("-w, --workflow <id>", "Workflow ID (or set POWR_WF env var)")
  .action((opts: { repo: string; workflow?: string }) => {
    const db = getDb();
    const gates = new GateRepo(db);

    const workflow = resolveWorkflow(db, opts);
    if (!workflow) {
      db.close();
      return;
    }

    const passedGates = gates.getPassedNames(workflow.id);

    // Determine level based on stage
    const isTicketLevel = [
      "INVESTIGATING", "IMPLEMENTING", "CODE_REVIEWING",
      "CROSS_REFING", "FIXING", "VERIFYING_ACS",
    ].includes(workflow.stage);

    const directive = getNextDirective(
      passedGates,
      isTicketLevel ? "ticket" : "feature"
    );

    if (directive) {
      console.log(directive);
    }

    db.close();
  });
