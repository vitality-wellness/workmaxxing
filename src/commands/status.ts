import { Command } from "commander";
import { getDb } from "../store/db.js";
import { WorkflowRepo } from "../store/workflow-repo.js";
import { SessionRepo } from "../store/session-repo.js";
import { GateRepo } from "../store/gate-repo.js";

export const statusCommand = new Command("status")
  .description("Show current workflow state, next action, and gate progress")
  .option("--repo <path>", "Repository path", process.cwd())
  .option("--json", "Output as JSON")
  .action((opts: { repo: string; json?: boolean }) => {
    const db = getDb();
    const workflows = new WorkflowRepo(db);
    const sessions = new SessionRepo(db);
    const gates = new GateRepo(db);

    const active = workflows.findActiveForRepo(opts.repo);

    if (!active) {
      if (opts.json) {
        console.log(JSON.stringify({ status: "idle", workflow: null }));
      } else {
        console.log("No active workflow. Use `powr-workflow start <name>` to begin.");
      }
      return;
    }

    const currentGates = gates.listForWorkflow(active.id);
    const session = sessions.findActiveForRepo(opts.repo);

    if (opts.json) {
      console.log(
        JSON.stringify({
          status: "active",
          workflow: active,
          gates: currentGates,
          session,
        })
      );
    } else {
      console.log(`Workflow: ${active.featureName}`);
      console.log(`Stage:    ${active.stage}`);
      console.log(`Repo:     ${active.repo}`);
      console.log(`Started:  ${active.createdAt}`);
      console.log();

      if (currentGates.length > 0) {
        console.log("Gates:");
        for (const gate of currentGates) {
          console.log(`  ${gate.passed ? "✅" : "⬜"} ${gate.name}`);
        }
      }
    }

    db.close();
  });
