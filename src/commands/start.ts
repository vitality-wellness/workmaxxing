import { Command } from "commander";
import { getDb } from "../store/db.js";
import { WorkflowRepo } from "../store/workflow-repo.js";
import { SessionRepo } from "../store/session-repo.js";
import { AuditRepo } from "../store/audit-repo.js";

export const startCommand = new Command("start")
  .description("Begin a new feature workflow")
  .argument("<name>", "Feature name")
  .option("--repo <path>", "Repository path", process.cwd())
  .option("--json", "Output as JSON")
  .action((name: string, opts: { repo: string; json?: boolean }) => {
    const db = getDb();
    const workflows = new WorkflowRepo(db);
    const sessions = new SessionRepo(db);
    const audit = new AuditRepo(db);

    // Check for existing active workflow
    const existing = workflows.findActiveForRepo(opts.repo);
    if (existing) {
      console.error(
        `Error: Active workflow already exists: "${existing.featureName}" (${existing.stage}). ` +
          `Use \`powr-workmaxxing advance\` or \`powr-workmaxxing abandon\` first.`
      );
      process.exit(1);
    }

    const workflow = workflows.create({
      featureName: name,
      repo: opts.repo,
      stage: "SPECCING",
    });

    const session = sessions.create({
      workflowId: workflow.id,
      repo: opts.repo,
    });

    audit.log({
      workflowId: workflow.id,
      eventType: "workflow_started",
      details: { name, repo: opts.repo, sessionId: session.id },
    });

    if (opts.json) {
      console.log(JSON.stringify({ workflow, session }));
    } else {
      console.log(`Workflow started: "${name}"`);
      console.log(`ID:    ${workflow.id}`);
      console.log(`Stage: ${workflow.stage}`);
    }

    db.close();
  });
