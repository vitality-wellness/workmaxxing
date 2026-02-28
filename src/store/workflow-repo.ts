import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";

export interface Workflow {
  id: string;
  stage: string;
  repo: string;
  featureName: string | null;
  planFile: string | null;
  linearProjectId: string | null;
  createdAt: string;
  updatedAt: string;
  active: boolean;
}

interface WorkflowRow {
  id: string;
  stage: string;
  repo: string;
  feature_name: string | null;
  plan_file: string | null;
  linear_project_id: string | null;
  created_at: string;
  updated_at: string;
  active: number;
}

function rowToWorkflow(row: WorkflowRow): Workflow {
  return {
    id: row.id,
    stage: row.stage,
    repo: row.repo,
    featureName: row.feature_name,
    planFile: row.plan_file,
    linearProjectId: row.linear_project_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    active: row.active === 1,
  };
}

export class WorkflowRepo {
  constructor(private db: Database.Database) {}

  create(input: {
    featureName: string;
    repo: string;
    stage: string;
  }): Workflow {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO workflows (id, stage, repo, feature_name)
         VALUES (?, ?, ?, ?)`
      )
      .run(id, input.stage, input.repo, input.featureName);

    return this.getById(id)!;
  }

  getById(id: string): Workflow | null {
    const row = this.db
      .prepare("SELECT * FROM workflows WHERE id = ?")
      .get(id) as WorkflowRow | undefined;
    return row ? rowToWorkflow(row) : null;
  }

  findActiveForRepo(repo: string): Workflow | null {
    const row = this.db
      .prepare(
        "SELECT * FROM workflows WHERE active = 1 AND repo = ? ORDER BY updated_at DESC LIMIT 1"
      )
      .get(repo) as WorkflowRow | undefined;
    return row ? rowToWorkflow(row) : null;
  }

  updateStage(id: string, stage: string): void {
    this.db
      .prepare(
        "UPDATE workflows SET stage = ?, updated_at = datetime('now') WHERE id = ?"
      )
      .run(stage, id);
  }

  deactivate(id: string): void {
    this.db
      .prepare(
        "UPDATE workflows SET active = 0, updated_at = datetime('now') WHERE id = ?"
      )
      .run(id);
  }
}
