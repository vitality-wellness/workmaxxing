import { Command } from "commander";
import { getDb } from "../store/db.js";
import { WorkflowRepo } from "../store/workflow-repo.js";
import { SessionRepo } from "../store/session-repo.js";
import { AuditRepo } from "../store/audit-repo.js";

export const startExecuteCommand = new Command("start-execute")
  .description(
    "Start a workflow directly at EXECUTING stage for pre-existing tickets"
  )
  .argument("<name>", "Feature or batch name")
  .option("--repo <path>", "Repository path", process.cwd())
  .option(
    "--tickets <ids>",
    "Comma-separated ticket IDs being executed",
    (v: string) => v.split(",")
  )
  .option("--json", "Output as JSON")
  .action(
    (
      name: string,
      opts: { repo: string; tickets?: string[]; json?: boolean }
    ) => {
      const db = getDb();
      const workflows = new WorkflowRepo(db);
      const sessions = new SessionRepo(db);
      const audit = new AuditRepo(db);

      const workflow = workflows.create({
        featureName: name,
        repo: opts.repo,
        stage: "EXECUTING",
      });

      const session = sessions.create({
        workflowId: workflow.id,
        repo: opts.repo,
      });

      audit.log({
        workflowId: workflow.id,
        eventType: "workflow_started_direct_execute",
        details: {
          name,
          repo: opts.repo,
          sessionId: session.id,
          tickets: opts.tickets ?? [],
          reason:
            "Pre-existing tickets — skipped spec/plan ceremony, per-ticket gates still enforced",
        },
      });

      if (opts.json) {
        console.log(JSON.stringify({ workflow, session }));
      } else {
        console.log(`Workflow started at EXECUTING: "${name}"`);
        console.log(`ID:    ${workflow.id}`);
        console.log(`Stage: ${workflow.stage}`);
        if (opts.tickets?.length) {
          console.log(`Tickets: ${opts.tickets.join(", ")}`);
        }
        console.log();
        console.log(`Set this in your terminal to scope all commands:`);
        console.log(`  export POWR_WF=${workflow.id}`);
      }

      db.close();
    }
  );
