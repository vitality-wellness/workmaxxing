import type Database from "better-sqlite3";
import { WorkflowRepo, type Workflow } from "./store/workflow-repo.js";

/**
 * Resolve the active workflow for a command.
 *
 * Priority:
 * 1. --workflow <id> flag (explicit)
 * 2. POWR_WF env var (set per-terminal)
 * 3. Fallback: find active workflow for --repo (legacy single-terminal mode)
 *
 * This enables 9 terminals in the same repo to each have their own workflow.
 */
export function resolveWorkflow(
  db: Database.Database,
  opts: { workflow?: string; repo: string }
): Workflow | null {
  const workflows = new WorkflowRepo(db);

  // 1. Explicit workflow ID (flag or env)
  const workflowId = opts.workflow ?? process.env["POWR_WF"];
  if (workflowId) {
    const workflow = workflows.getById(workflowId);
    if (!workflow) {
      console.error(
        `Error: Workflow "${workflowId}" not found. Check POWR_WF or --workflow value.`
      );
      process.exit(1);
    }
    if (!workflow.active) {
      console.error(
        `Error: Workflow "${workflowId}" is no longer active.`
      );
      process.exit(1);
    }
    return workflow;
  }

  // 2. Fallback: repo-based lookup
  return workflows.findActiveForRepo(opts.repo);
}

/**
 * Like resolveWorkflow but exits with error if none found.
 */
export function requireWorkflow(
  db: Database.Database,
  opts: { workflow?: string; repo: string }
): Workflow {
  const workflow = resolveWorkflow(db, opts);
  if (!workflow) {
    console.error(
      "Error: No active workflow. Use `powr-workmaxxing start <name>` first."
    );
    process.exit(1);
  }
  return workflow;
}
