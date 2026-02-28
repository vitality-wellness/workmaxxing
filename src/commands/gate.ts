import { Command } from "commander";
import { getDb } from "../store/db.js";
import { GateRepo } from "../store/gate-repo.js";
import { AuditRepo } from "../store/audit-repo.js";
import { getWorkflowConfig } from "../engine/workflow-config.js";
import { resolveWorkflow, requireWorkflow } from "../resolve-workflow.js";

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
  .option("--json", "Output as JSON")
  .action(
    (
      name: string,
      opts: { evidence: string; repo: string; workflow?: string; json?: boolean }
    ) => {
      const db = getDb();
      const gates = new GateRepo(db);
      const audit = new AuditRepo(db);

      const workflow = requireWorkflow(db, opts);

      let evidence: Record<string, unknown>;
      try {
        evidence = JSON.parse(opts.evidence) as Record<string, unknown>;
      } catch {
        console.error("Error: --evidence must be valid JSON.");
        process.exit(2);
      }

      gates.record({
        workflowId: workflow.id,
        gateName: name,
        evidence,
      });

      audit.log({
        workflowId: workflow.id,
        eventType: "gate_recorded",
        details: { gate: name, evidence },
      });

      if (opts.json) {
        console.log(JSON.stringify({ recorded: true, gate: name }));
      } else {
        console.log(`✅ Gate recorded: ${name}`);
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
