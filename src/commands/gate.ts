import { Command } from "commander";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { getDb } from "../store/db.js";
import { GateRepo } from "../store/gate-repo.js";
import { AuditRepo } from "../store/audit-repo.js";
import { TicketWorkflowRepo } from "../store/ticket-workflow-repo.js";
import { getWorkflowConfig, getTicketStageOrder, deriveGateNextStage, getTicketGateNames } from "../engine/workflow-config.js";
import { validateGateEvidence, GATE_EVIDENCE_EXAMPLES } from "../engine/state-machine.js";
import { resolveWorkflow, requireWorkflow } from "../resolve-workflow.js";
import { detectGatesFromComment } from "../engine/gate-detection.js";
import { getNextDirective, getDirectiveForGate } from "../engine/directives.js";
import { getRepoConfig } from "../config/repo-config.js";

/** Maps ticket-scoped gates to the ticket stage they advance to (derived from config) */
const GATE_NEXT_STAGE = deriveGateNextStage();

/** Ordered ticket stage names for monotonic advancement */
const TICKET_STAGE_ORDER = getTicketStageOrder();

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

      // --- File existence check for spec/plan gates (only when path-based evidence) ---
      if (name === "spec_document_written" || name === "plan_written") {
        if (evidence.path) {
          const filePath = evidence.path as string;
          if (!existsSync(filePath)) {
            console.error(
              `Error: File "${filePath}" does not exist. The ${name} gate requires a real file path.`
            );
            process.exit(2);
          }
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
        // Safety net: sync ticket stages from gates before checking.
        // If all gates passed but stage is stuck (e.g., gates recorded out of order),
        // advance the stage to DONE so allDone() passes.
        const allTickets = ticketWorkflows.listForWorkflow(workflow.id);
        const ticketGateNames = getTicketGateNames();
        let synced = 0;
        for (const tw of allTickets) {
          if (tw.stage === "DONE") continue;
          const passedNames = gates.getPassedNamesForTicket(workflow.id, tw.id);
          if (ticketGateNames.every((g) => passedNames.has(g))) {
            ticketWorkflows.updateStage(tw.id, "DONE");
            synced++;
            if (!opts.json) {
              console.log(`  Synced ${tw.ticketId} stage → DONE (all gates passed)`);
            }
          }
        }

        if (!ticketWorkflows.allDone(workflow.id)) {
          const total = ticketWorkflows.countTotal(workflow.id);
          const done = ticketWorkflows.countByStage(workflow.id, "DONE");
          const notDone = allTickets.filter((tw) => tw.stage !== "DONE");
          console.error(
            `Error: Not all tickets are done (${done}/${total} completed). Cannot record all_tickets_done.`
          );
          console.error(`\nStuck tickets:`);
          for (const tw of notDone) {
            console.error(`  ${tw.ticketId.padEnd(12)} stage: ${tw.stage}`);
          }
          console.error(`\nTo remove phantom entries: powr-workmaxxing tickets remove <ticket-id>`);
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

      // --- Auto-advance ticket stage (monotonic — never go backward) ---
      if (ticketWorkflowId && GATE_NEXT_STAGE[name]) {
        const tw = ticketWorkflows.getById(ticketWorkflowId)!;
        const targetStage = GATE_NEXT_STAGE[name]!;
        const currentIdx = TICKET_STAGE_ORDER.indexOf(tw.stage);
        const targetIdx = TICKET_STAGE_ORDER.indexOf(targetStage);

        if (targetIdx > currentIdx) {
          ticketWorkflows.updateStage(ticketWorkflowId, targetStage);
          if (!opts.json) {
            console.log(`  → Ticket stage advanced to ${targetStage}`);
          }
        } else if (!opts.json && targetIdx <= currentIdx) {
          console.log(`  → Ticket already at ${tw.stage} (past ${targetStage}), stage unchanged`);
        }
      }

      db.close();
    }
  );

gateCommand
  .command("record-batch")
  .description("Record multiple gates at once for a ticket (comma-separated names)")
  .argument("<names>", "Comma-separated gate names (e.g., investigation,code_committed)")
  .option("--evidence <json>", "Evidence JSON (applied to all gates)", "{}")
  .option("--repo <path>", "Repository path", process.cwd())
  .option("-w, --workflow <id>", "Workflow ID (or set POWR_WF env var)")
  .option("-t, --ticket <id>", "Ticket ID (e.g., POWR-500) — scopes gates to a ticket workflow")
  .option("--json", "Output as JSON")
  .action(
    (
      names: string,
      opts: {
        evidence: string;
        repo: string;
        workflow?: string;
        ticket?: string;
        json?: boolean;
      }
    ) => {
      const gateNames = names.split(",").map((n) => n.trim()).filter(Boolean);
      if (gateNames.length === 0) {
        console.error("Error: no gate names provided.");
        process.exit(2);
      }

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

      // Resolve ticket workflow once
      let ticketWorkflowId: string | null = null;
      if (opts.ticket) {
        let tw = ticketWorkflows.findByTicketId(workflow.id, opts.ticket);
        if (!tw) {
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

      const results: Array<{ gate: string; recorded: boolean; error?: string }> = [];

      for (const gateName of gateNames) {
        // Validate evidence schema
        const validation = validateGateEvidence(gateName, evidence);
        if (!validation.valid) {
          results.push({ gate: gateName, recorded: false, error: validation.error });
          continue;
        }

        gates.record({
          workflowId: workflow.id,
          ticketWorkflowId,
          gateName,
          evidence,
        });

        audit.log({
          workflowId: workflow.id,
          eventType: "gate_recorded",
          details: { gate: gateName, evidence, ticketId: opts.ticket ?? null },
        });

        results.push({ gate: gateName, recorded: true });

        // Auto-advance ticket stage
        if (ticketWorkflowId && GATE_NEXT_STAGE[gateName]) {
          const tw = ticketWorkflows.getById(ticketWorkflowId)!;
          const targetStage = GATE_NEXT_STAGE[gateName]!;
          const currentIdx = TICKET_STAGE_ORDER.indexOf(tw.stage);
          const targetIdx = TICKET_STAGE_ORDER.indexOf(targetStage);

          if (targetIdx > currentIdx) {
            ticketWorkflows.updateStage(ticketWorkflowId, targetStage);
            if (!opts.json) {
              console.log(`  → ${gateName}: ticket stage advanced to ${targetStage}`);
            }
          }
        }
      }

      if (opts.json) {
        console.log(JSON.stringify({ results, ticketId: opts.ticket ?? null }));
      } else {
        for (const r of results) {
          if (r.recorded) {
            console.log(`✅ ${r.gate}`);
          } else {
            console.log(`❌ ${r.gate}: ${r.error}`);
          }
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
  .option("-t, --ticket <id>", "Ticket ID — check gate for a specific ticket")
  .option("--json", "Output as JSON")
  .action(
    (
      name: string,
      opts: { repo: string; workflow?: string; ticket?: string; json?: boolean }
    ) => {
      const db = getDb();
      const gates = new GateRepo(db);
      const ticketWorkflows = new TicketWorkflowRepo(db);

      const workflow = resolveWorkflow(db, opts);
      if (!workflow) {
        if (opts.json) {
          console.log(JSON.stringify({ passed: false, error: "no workflow" }));
        }
        process.exit(1);
      }

      let passed: boolean;

      if (opts.ticket) {
        const tw = ticketWorkflows.findByTicketId(workflow.id, opts.ticket);
        if (!tw) {
          if (opts.json) {
            console.log(
              JSON.stringify({
                passed: false,
                error: `no ticket workflow for ${opts.ticket}`,
              })
            );
          } else {
            console.error(`No ticket workflow found for ${opts.ticket}`);
          }
          process.exit(1);
        }
        passed = gates.isPassedForTicket(workflow.id, tw.id, name);
      } else {
        passed = gates.isPassed(workflow.id, name);
      }

      if (opts.json) {
        console.log(
          JSON.stringify({
            gate: name,
            passed,
            ticket: opts.ticket ?? null,
          })
        );
      }

      db.close();
      process.exit(passed ? 0 : 1);
    }
  );

gateCommand
  .command("check-ticket")
  .description("Check all 7 ticket gates at once for a specific ticket")
  .argument("<ticket-id>", "Ticket ID (e.g., POWR-500)")
  .option("--repo <path>", "Repository path", process.cwd())
  .option("-w, --workflow <id>", "Workflow ID (or set POWR_WF env var)")
  .option("--json", "Output as JSON")
  .action(
    (
      ticketId: string,
      opts: { repo: string; workflow?: string; json?: boolean }
    ) => {
      const db = getDb();
      const gates = new GateRepo(db);
      const ticketWorkflows = new TicketWorkflowRepo(db);

      const workflow = requireWorkflow(db, opts);

      const tw = ticketWorkflows.findByTicketId(workflow.id, ticketId);
      if (!tw) {
        if (opts.json) {
          console.log(
            JSON.stringify({
              allPassed: false,
              ticket: ticketId,
              error: `no ticket workflow for ${ticketId}`,
            })
          );
        } else {
          console.error(`No ticket workflow found for ${ticketId}`);
        }
        process.exit(1);
      }

      const TICKET_GATES = getTicketGateNames();

      const passedNames = gates.getPassedNamesForTicket(workflow.id, tw.id);
      const gateResults = TICKET_GATES.map((g) => ({
        name: g,
        passed: passedNames.has(g),
      }));
      const allPassed = gateResults.every((g) => g.passed);

      if (opts.json) {
        console.log(
          JSON.stringify({
            allPassed,
            ticket: ticketId,
            stage: tw.stage,
            gates: gateResults,
          })
        );
      } else {
        console.log(`Ticket: ${ticketId} (stage: ${tw.stage})`);
        console.log();
        for (const gate of gateResults) {
          console.log(`  ${gate.passed ? "✅" : "⬜"} ${gate.name}`);
        }
        console.log();
        console.log(allPassed ? "All gates passed." : "Some gates missing.");
      }

      db.close();
      process.exit(allPassed ? 0 : 1);
    }
  );

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
  .command("list-ticket-gates")
  .description("Print ticket gate names (space-separated, for shell scripts)")
  .action(() => {
    console.log(getTicketGateNames().join(" "));
  });

gateCommand
  .command("schema")
  .description("Show the expected evidence format for a gate")
  .argument("[name]", "Gate name (omit to show all)")
  .action((name?: string) => {
    if (name) {
      const example = GATE_EVIDENCE_EXAMPLES[name];
      if (example) {
        console.log(`${name}: ${example}`);
      } else {
        console.log(`${name}: (no schema — accepts any evidence)`);
      }
    } else {
      for (const [gate, example] of Object.entries(GATE_EVIDENCE_EXAMPLES)) {
        console.log(`  ${gate}: ${example}`);
      }
    }
  });

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
    const repoConfig = getRepoConfig(workflow.repo);
    const reviewMode = repoConfig?.reviewMode === true;

    // Determine level based on stage
    const isTicketLevel = [
      "INVESTIGATING", "IMPLEMENTING", "CODE_REVIEWING",
      "CROSS_REFING", "FIXING", "VERIFYING_ACS",
    ].includes(workflow.stage);

    const directive = getNextDirective(
      passedGates,
      isTicketLevel ? "ticket" : "feature",
      reviewMode
    );

    if (directive) {
      console.log(directive);
    }

    db.close();
  });
