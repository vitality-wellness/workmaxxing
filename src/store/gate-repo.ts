import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { getWorkflowConfig } from "../engine/workflow-config.js";

export interface Gate {
  id: string;
  workflowId: string;
  ticketWorkflowId: string | null;
  gateName: string;
  evidence: Record<string, unknown> | null;
  recordedAt: string;
}

interface GateRow {
  id: string;
  workflow_id: string;
  ticket_workflow_id: string | null;
  gate_name: string;
  evidence: string | null;
  recorded_at: string;
}

function rowToGate(row: GateRow): Gate {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    ticketWorkflowId: row.ticket_workflow_id,
    gateName: row.gate_name,
    evidence: row.evidence
      ? (JSON.parse(row.evidence) as Record<string, unknown>)
      : null,
    recordedAt: row.recorded_at,
  };
}

export interface GateStatus {
  name: string;
  passed: boolean;
  recordedAt?: string;
}

export class GateRepo {
  constructor(private db: Database.Database) {}

  record(input: {
    workflowId: string;
    ticketWorkflowId?: string | null;
    gateName: string;
    evidence?: Record<string, unknown>;
  }): Gate {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO gates (id, workflow_id, ticket_workflow_id, gate_name, evidence)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.workflowId,
        input.ticketWorkflowId ?? null,
        input.gateName,
        input.evidence ? JSON.stringify(input.evidence) : null
      );

    return this.getById(id)!;
  }

  getById(id: string): Gate | null {
    const row = this.db
      .prepare("SELECT * FROM gates WHERE id = ?")
      .get(id) as GateRow | undefined;
    return row ? rowToGate(row) : null;
  }

  isPassed(workflowId: string, gateName: string): boolean {
    const row = this.db
      .prepare(
        "SELECT 1 FROM gates WHERE workflow_id = ? AND gate_name = ? LIMIT 1"
      )
      .get(workflowId, gateName);
    return row !== undefined;
  }

  getPassedNames(workflowId: string): Set<string> {
    const rows = this.db
      .prepare("SELECT DISTINCT gate_name FROM gates WHERE workflow_id = ?")
      .all(workflowId) as Array<{ gate_name: string }>;
    return new Set(rows.map((r) => r.gate_name));
  }

  listForWorkflow(workflowId: string): GateStatus[] {
    // Get the workflow's current stage to find required gates
    const workflowRow = this.db
      .prepare("SELECT stage FROM workflows WHERE id = ?")
      .get(workflowId) as { stage: string } | undefined;

    if (!workflowRow) return [];

    const config = getWorkflowConfig();
    const stageConfig = config.stages[workflowRow.stage];
    const requiredGates = stageConfig?.requiredGates ?? [];
    const passedGates = this.getPassedNames(workflowId);

    const passedRows = this.db
      .prepare(
        "SELECT gate_name, recorded_at FROM gates WHERE workflow_id = ?"
      )
      .all(workflowId) as Array<{ gate_name: string; recorded_at: string }>;

    const recordedAtMap = new Map(
      passedRows.map((r) => [r.gate_name, r.recorded_at])
    );

    return requiredGates.map((name) => ({
      name,
      passed: passedGates.has(name),
      recordedAt: recordedAtMap.get(name),
    }));
  }
}
