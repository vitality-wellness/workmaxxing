import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export interface Session {
  id: string;
  workflowId: string | null;
  ticketWorkflowId: string | null;
  repo: string;
  bypassed: boolean;
  startedAt: string;
  lastActivity: string;
  active: boolean;
}

interface SessionRow {
  id: string;
  workflow_id: string | null;
  ticket_workflow_id: string | null;
  repo: string;
  bypassed: number;
  started_at: string;
  last_activity: string;
  active: number;
}

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    ticketWorkflowId: row.ticket_workflow_id,
    repo: row.repo,
    bypassed: row.bypassed === 1,
    startedAt: row.started_at,
    lastActivity: row.last_activity,
    active: row.active === 1,
  };
}

export class SessionRepo {
  constructor(private db: Database.Database) {}

  create(input: { workflowId: string | null; repo: string }): Session {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO sessions (id, workflow_id, repo)
         VALUES (?, ?, ?)`
      )
      .run(id, input.workflowId, input.repo);

    return this.getById(id)!;
  }

  getById(id: string): Session | null {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE id = ?")
      .get(id) as SessionRow | undefined;
    return row ? rowToSession(row) : null;
  }

  findActiveForRepo(repo: string): Session | null {
    const row = this.db
      .prepare(
        "SELECT * FROM sessions WHERE active = 1 AND repo = ? ORDER BY last_activity DESC LIMIT 1"
      )
      .get(repo) as SessionRow | undefined;
    return row ? rowToSession(row) : null;
  }

  markBypassed(id: string): void {
    this.db
      .prepare(
        "UPDATE sessions SET bypassed = 1, last_activity = datetime('now') WHERE id = ?"
      )
      .run(id);
  }

  heartbeat(id: string): void {
    this.db
      .prepare(
        "UPDATE sessions SET last_activity = datetime('now') WHERE id = ?"
      )
      .run(id);
  }

  deactivate(id: string): void {
    this.db
      .prepare(
        "UPDATE sessions SET active = 0, last_activity = datetime('now') WHERE id = ?"
      )
      .run(id);
  }

  findStale(maxAgeMs: number): Session[] {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const rows = this.db
      .prepare(
        "SELECT * FROM sessions WHERE active = 1 AND last_activity < ?"
      )
      .all(cutoff) as SessionRow[];
    return rows.map(rowToSession);
  }
}
