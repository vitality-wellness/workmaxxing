import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export interface TicketWorkflow {
  id: string;
  workflowId: string;
  ticketId: string;
  linearIssueId: string | null;
  stage: string;
  createdAt: string;
  updatedAt: string;
}

interface TicketWorkflowRow {
  id: string;
  workflow_id: string;
  ticket_id: string;
  linear_issue_id: string | null;
  stage: string;
  created_at: string;
  updated_at: string;
}

function rowToTicketWorkflow(row: TicketWorkflowRow): TicketWorkflow {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    ticketId: row.ticket_id,
    linearIssueId: row.linear_issue_id,
    stage: row.stage,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class TicketWorkflowRepo {
  constructor(private db: Database.Database) {}

  create(input: {
    workflowId: string;
    ticketId: string;
    linearIssueId?: string | null;
  }): TicketWorkflow {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO ticket_workflows (id, workflow_id, ticket_id, linear_issue_id, stage)
         VALUES (?, ?, ?, ?, 'QUEUED')`
      )
      .run(id, input.workflowId, input.ticketId, input.linearIssueId ?? null);
    return this.getById(id)!;
  }

  getById(id: string): TicketWorkflow | null {
    const row = this.db
      .prepare("SELECT * FROM ticket_workflows WHERE id = ?")
      .get(id) as TicketWorkflowRow | undefined;
    return row ? rowToTicketWorkflow(row) : null;
  }

  findByTicketId(
    workflowId: string,
    ticketId: string
  ): TicketWorkflow | null {
    const row = this.db
      .prepare(
        "SELECT * FROM ticket_workflows WHERE workflow_id = ? AND ticket_id = ?"
      )
      .get(workflowId, ticketId) as TicketWorkflowRow | undefined;
    return row ? rowToTicketWorkflow(row) : null;
  }

  listForWorkflow(workflowId: string): TicketWorkflow[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM ticket_workflows WHERE workflow_id = ? ORDER BY created_at"
      )
      .all(workflowId) as TicketWorkflowRow[];
    return rows.map(rowToTicketWorkflow);
  }

  updateStage(id: string, stage: string): void {
    this.db
      .prepare(
        "UPDATE ticket_workflows SET stage = ?, updated_at = datetime('now') WHERE id = ?"
      )
      .run(stage, id);
  }

  countByStage(
    workflowId: string,
    stage: string
  ): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) as count FROM ticket_workflows WHERE workflow_id = ? AND stage = ?"
      )
      .get(workflowId, stage) as { count: number };
    return row.count;
  }

  countTotal(workflowId: string): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) as count FROM ticket_workflows WHERE workflow_id = ?"
      )
      .get(workflowId) as { count: number };
    return row.count;
  }

  allDone(workflowId: string): boolean {
    const total = this.countTotal(workflowId);
    if (total === 0) return false;
    const done = this.countByStage(workflowId, "DONE");
    return done === total;
  }

  delete(id: string): void {
    this.db
      .prepare("DELETE FROM ticket_workflows WHERE id = ?")
      .run(id);
  }

  deleteByTicketId(workflowId: string, ticketId: string): boolean {
    const result = this.db
      .prepare(
        "DELETE FROM ticket_workflows WHERE workflow_id = ? AND ticket_id = ?"
      )
      .run(workflowId, ticketId);
    return result.changes > 0;
  }
}
