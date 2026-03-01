import { Command } from "commander";
import { getDb } from "../store/db.js";
import { WorkflowRepo } from "../store/workflow-repo.js";
import { GateRepo } from "../store/gate-repo.js";
import { AuditRepo } from "../store/audit-repo.js";
import { getWorkflowConfig } from "../engine/workflow-config.js";
import { validateTransition } from "../engine/state-machine.js";
import { requireWorkflow } from "../resolve-workflow.js";

export const advanceCommand = new Command("advance")
  .description(
    "Advance workflow to next stage (checks all required gates first)"
  )
  .option("--repo <path>", "Repository path", process.cwd())
  .option("-w, --workflow <id>", "Workflow ID (or set POWR_WF env var)")
  .option("--json", "Output as JSON")
  .action((opts: { repo: string; workflow?: string; json?: boolean }) => {
    const db = getDb();
    const gates = new GateRepo(db);
    const audit = new AuditRepo(db);
    const workflows = new WorkflowRepo(db);

    const workflow = requireWorkflow(db, opts);

    const config = getWorkflowConfig();
    const stageConfig = config.stages[workflow.stage];
    if (!stageConfig) {
      console.error(`Error: Unknown stage "${workflow.stage}".`);
      process.exit(2);
    }

    // Check required gates
    const requiredGates = stageConfig.requiredGates ?? [];
    const passedGates = gates.getPassedNames(workflow.id);
    const missingGates = requiredGates.filter((g) => !passedGates.has(g));

    if (missingGates.length > 0) {
      if (opts.json) {
        console.log(
          JSON.stringify({
            advanced: false,
            currentStage: workflow.stage,
            missingGates,
          })
        );
      } else {
        console.error(`Cannot advance from ${workflow.stage}. Missing gates:`);
        for (const gate of missingGates) {
          console.error(`  ⬜ ${gate}`);
        }
      }
      process.exit(1);
    }

    const nextStage = stageConfig.nextStage;
    if (!nextStage) {
      if (opts.json) {
        console.log(
          JSON.stringify({ advanced: false, reason: "No next stage (workflow complete)" })
        );
      } else {
        console.log(`Workflow is in final stage: ${workflow.stage}. Nothing to advance to.`);
      }
      db.close();
      return;
    }

    const transition = validateTransition(config.stages, workflow.stage, nextStage);
    if (!transition.valid) {
      console.error(`Error: ${transition.error}`);
      process.exit(2);
    }

    const previousStage = workflow.stage;
    workflows.updateStage(workflow.id, nextStage);

    audit.log({
      workflowId: workflow.id,
      eventType: "stage_advanced",
      details: { from: previousStage, to: nextStage },
    });

    if (opts.json) {
      console.log(
        JSON.stringify({ advanced: true, from: previousStage, to: nextStage })
      );
    } else {
      console.log(`Advanced: ${previousStage} → ${nextStage}`);
    }

    // After TICKETING → EXECUTING, print stop directive so Claude halts
    if (previousStage === "TICKETING" && nextStage === "EXECUTING") {
      console.log();
      console.log("STOP. /powr plan is complete. Do NOT continue to execution.");
      console.log('Tell the user: "Tickets created. Type `/powr execute` to start building."');
      console.log("Do not call any more tools. Do not start working on tickets.");
    }

    db.close();
  });
