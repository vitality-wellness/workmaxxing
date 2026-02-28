import { Command } from "commander";
import { getDb } from "../store/db.js";
import { SessionRepo } from "../store/session-repo.js";
import { WorkflowRepo } from "../store/workflow-repo.js";
import { AuditRepo } from "../store/audit-repo.js";

export const sessionCommand = new Command("session").description(
  "Manage Claude Code sessions"
);

sessionCommand
  .command("start")
  .description("Register a new session for this repo")
  .option("--repo <path>", "Repository path", process.cwd())
  .option("--json", "Output as JSON")
  .action((opts: { repo: string; json?: boolean }) => {
    const db = getDb();
    const sessions = new SessionRepo(db);
    const workflows = new WorkflowRepo(db);
    const audit = new AuditRepo(db);

    // Link to active workflow if one exists
    const workflow = workflows.findActiveForRepo(opts.repo);

    const session = sessions.create({
      workflowId: workflow?.id ?? null,
      repo: opts.repo,
    });

    audit.log({
      workflowId: workflow?.id ?? null,
      eventType: "session_started",
      details: { sessionId: session.id, repo: opts.repo },
    });

    if (opts.json) {
      console.log(JSON.stringify({ session, workflow: workflow ?? null }));
    } else {
      console.log(`Session started: ${session.id}`);
      if (workflow) {
        console.log(`Linked to workflow: "${workflow.featureName}" (${workflow.stage})`);
      }
    }

    db.close();
  });

sessionCommand
  .command("cleanup")
  .description("Detect and clean up stale sessions")
  .option("--max-age-hours <hours>", "Max session age in hours", "2")
  .option("--json", "Output as JSON")
  .action((opts: { maxAgeHours: string; json?: boolean }) => {
    const db = getDb();
    const sessions = new SessionRepo(db);

    const maxAgeMs = parseInt(opts.maxAgeHours, 10) * 60 * 60 * 1000;
    const stale = sessions.findStale(maxAgeMs);

    if (stale.length === 0) {
      if (opts.json) {
        console.log(JSON.stringify({ cleaned: 0 }));
      } else {
        console.log("No stale sessions found.");
      }
      db.close();
      return;
    }

    for (const session of stale) {
      sessions.deactivate(session.id);
    }

    if (opts.json) {
      console.log(JSON.stringify({ cleaned: stale.length, sessions: stale }));
    } else {
      console.log(`Cleaned ${stale.length} stale session(s).`);
    }

    db.close();
  });

sessionCommand
  .command("info")
  .description("Show current session info")
  .option("--repo <path>", "Repository path", process.cwd())
  .option("--json", "Output as JSON")
  .action((opts: { repo: string; json?: boolean }) => {
    const db = getDb();
    const sessions = new SessionRepo(db);

    const session = sessions.findActiveForRepo(opts.repo);

    if (!session) {
      if (opts.json) {
        console.log(JSON.stringify({ session: null }));
      } else {
        console.log("No active session for this repo.");
      }
      db.close();
      return;
    }

    if (opts.json) {
      console.log(JSON.stringify({ session }));
    } else {
      console.log(`Session:  ${session.id}`);
      console.log(`Repo:     ${session.repo}`);
      console.log(`Started:  ${session.startedAt}`);
      console.log(`Activity: ${session.lastActivity}`);
    }

    db.close();
  });
