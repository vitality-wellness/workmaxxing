import { Command } from "commander";
import { getDb } from "../store/db.js";
import { SessionRepo } from "../store/session-repo.js";
import { GateRepo } from "../store/gate-repo.js";
import { resolveWorkflow } from "../resolve-workflow.js";

export const statusCommand = new Command("status")
  .description("Show current workflow state, next action, and gate progress")
  .option("--repo <path>", "Repository path", process.cwd())
  .option("-w, --workflow <id>", "Workflow ID (or set POWR_WF env var)")
  .option("--json", "Output as JSON")
  .action((opts: { repo: string; workflow?: string; json?: boolean }) => {
    const db = getDb();
    const sessions = new SessionRepo(db);
    const gates = new GateRepo(db);

    const active = resolveWorkflow(db, opts);

    if (!active) {
      if (opts.json) {
        console.log(JSON.stringify({ status: "idle", workflow: null }));
      } else {
        console.log("No active workflow. Use `powr-workmaxxing start <name>` to begin.");
      }
      db.close();
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
      console.log(`ID:       ${active.id}`);
      console.log(`Stage:    ${active.stage}`);
      console.log(`Repo:     ${active.repo}`);
      console.log(`Started:  ${active.createdAt}`);
      console.log();
      console.log(`Export for this terminal:`);
      console.log(`  export POWR_WF=${active.id}`);
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
