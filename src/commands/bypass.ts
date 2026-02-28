import { Command } from "commander";
import { getDb } from "../store/db.js";
import { SessionRepo } from "../store/session-repo.js";
import { AuditRepo } from "../store/audit-repo.js";

export const bypassCommand = new Command("bypass")
  .description('Mark current session as bypassed ("no ticket" equivalent)')
  .option("--repo <path>", "Repository path", process.cwd())
  .option("--json", "Output as JSON")
  .action((opts: { repo: string; json?: boolean }) => {
    const db = getDb();
    const sessions = new SessionRepo(db);
    const audit = new AuditRepo(db);

    let session = sessions.findActiveForRepo(opts.repo);
    if (!session) {
      session = sessions.create({ workflowId: null, repo: opts.repo });
    }

    sessions.markBypassed(session.id);

    audit.log({
      workflowId: null,
      eventType: "session_bypassed",
      details: { sessionId: session.id, repo: opts.repo },
    });

    if (opts.json) {
      console.log(JSON.stringify({ bypassed: true, sessionId: session.id }));
    } else {
      console.log("Session marked as bypassed. Production edits allowed without a ticket.");
    }

    db.close();
  });
