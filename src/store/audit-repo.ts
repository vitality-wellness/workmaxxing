import type Database from "better-sqlite3";

export interface AuditEntry {
  id: number;
  workflowId: string | null;
  ticketWorkflowId: string | null;
  eventType: string;
  details: Record<string, unknown> | null;
  timestamp: string;
}

export class AuditRepo {
  constructor(private db: Database.Database) {}

  log(input: {
    workflowId: string | null;
    ticketWorkflowId?: string | null;
    eventType: string;
    details?: Record<string, unknown>;
  }): void {
    this.db
      .prepare(
        `INSERT INTO audit_log (workflow_id, ticket_workflow_id, event_type, details)
         VALUES (?, ?, ?, ?)`
      )
      .run(
        input.workflowId,
        input.ticketWorkflowId ?? null,
        input.eventType,
        input.details ? JSON.stringify(input.details) : null
      );
  }

  recent(limit = 20): AuditEntry[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM audit_log ORDER BY timestamp DESC, id DESC LIMIT ?"
      )
      .all(limit) as Array<{
      id: number;
      workflow_id: string | null;
      ticket_workflow_id: string | null;
      event_type: string;
      details: string | null;
      timestamp: string;
    }>;

    return rows.map((r) => ({
      id: r.id,
      workflowId: r.workflow_id,
      ticketWorkflowId: r.ticket_workflow_id,
      eventType: r.event_type,
      details: r.details
        ? (JSON.parse(r.details) as Record<string, unknown>)
        : null,
      timestamp: r.timestamp,
    }));
  }
}
