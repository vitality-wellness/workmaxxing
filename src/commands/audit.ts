import { Command } from "commander";
import { getDb } from "../store/db.js";
import { AuditRepo } from "../store/audit-repo.js";

export const auditCommand = new Command("audit").description(
  "View workflow audit log"
);

auditCommand
  .command("log")
  .description("Show recent workflow events")
  .option("--limit <n>", "Number of events to show", "20")
  .option("--json", "Output as JSON")
  .action((opts: { limit: string; json?: boolean }) => {
    const db = getDb();
    const audit = new AuditRepo(db);
    const limit = parseInt(opts.limit, 10);
    const entries = audit.recent(limit);

    if (opts.json) {
      console.log(JSON.stringify(entries));
    } else {
      if (entries.length === 0) {
        console.log("No audit log entries.");
        db.close();
        return;
      }

      for (const entry of entries) {
        const details = entry.details
          ? ` | ${JSON.stringify(entry.details)}`
          : "";
        console.log(
          `  ${entry.timestamp}  ${entry.eventType}${details}`
        );
      }
    }

    db.close();
  });
