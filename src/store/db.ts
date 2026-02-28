import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const DB_DIR = join(homedir(), ".powr");
const DB_PATH = join(DB_DIR, "workflow.db");

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    stage TEXT NOT NULL,
    repo TEXT NOT NULL,
    feature_name TEXT,
    plan_file TEXT,
    linear_project_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS ticket_workflows (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(id),
    ticket_id TEXT NOT NULL,
    linear_issue_id TEXT,
    stage TEXT NOT NULL DEFAULT 'QUEUED',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS gates (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    ticket_workflow_id TEXT,
    gate_name TEXT NOT NULL,
    evidence TEXT,
    recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    workflow_id TEXT REFERENCES workflows(id),
    ticket_workflow_id TEXT REFERENCES ticket_workflows(id),
    repo TEXT NOT NULL,
    bypassed INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_activity TEXT NOT NULL DEFAULT (datetime('now')),
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workflow_id TEXT,
    ticket_workflow_id TEXT,
    event_type TEXT NOT NULL,
    details TEXT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_workflows_active_repo
    ON workflows(active, repo);
  CREATE INDEX IF NOT EXISTS idx_sessions_active_repo
    ON sessions(active, repo);
  CREATE INDEX IF NOT EXISTS idx_gates_workflow
    ON gates(workflow_id);
  CREATE INDEX IF NOT EXISTS idx_audit_workflow
    ON audit_log(workflow_id);
`;

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  if (!existsSync(DB_DIR)) {
    mkdirSync(DB_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);

  // Enable WAL mode for concurrent reads from hooks
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // Retry for up to 5s if another process is writing (9 terminals writing concurrently)
  db.pragma("busy_timeout = 5000");

  // Create tables
  db.exec(SCHEMA);

  return db;
}

export function getDbPath(): string {
  return DB_PATH;
}

/** For testing: use an in-memory database */
export function getTestDb(): Database.Database {
  const testDb = new Database(":memory:");
  testDb.pragma("foreign_keys = ON");
  testDb.exec(SCHEMA);
  return testDb;
}
