import { describe, it, expect } from "vitest";
import { getTestDb } from "./db.js";
import { WorkflowRepo } from "./workflow-repo.js";
import { SessionRepo } from "./session-repo.js";
import { GateRepo } from "./gate-repo.js";
import { AuditRepo } from "./audit-repo.js";

describe("SQLite store", () => {
  it("creates a workflow and retrieves it", () => {
    const db = getTestDb();
    const repo = new WorkflowRepo(db);

    const workflow = repo.create({
      featureName: "test feature",
      repo: "/test/repo",
      stage: "SPECCING",
    });

    expect(workflow.id).toBeTruthy();
    expect(workflow.featureName).toBe("test feature");
    expect(workflow.stage).toBe("SPECCING");
    expect(workflow.active).toBe(true);

    db.close();
  });

  it("finds active workflow for repo", () => {
    const db = getTestDb();
    const repo = new WorkflowRepo(db);

    repo.create({ featureName: "feat1", repo: "/repo/a", stage: "SPECCING" });
    repo.create({ featureName: "feat2", repo: "/repo/b", stage: "PLANNING" });

    const found = repo.findActiveForRepo("/repo/a");
    expect(found?.featureName).toBe("feat1");

    const notFound = repo.findActiveForRepo("/repo/c");
    expect(notFound).toBeNull();

    db.close();
  });

  it("advances workflow stage", () => {
    const db = getTestDb();
    const repo = new WorkflowRepo(db);

    const workflow = repo.create({
      featureName: "test",
      repo: "/repo",
      stage: "SPECCING",
    });

    repo.updateStage(workflow.id, "PLANNING");

    const updated = repo.getById(workflow.id);
    expect(updated?.stage).toBe("PLANNING");

    db.close();
  });

  it("creates and checks gates", () => {
    const db = getTestDb();
    const workflows = new WorkflowRepo(db);
    const gates = new GateRepo(db);

    const workflow = workflows.create({
      featureName: "test",
      repo: "/repo",
      stage: "SPECCING",
    });

    expect(gates.isPassed(workflow.id, "spec_document_written")).toBe(false);

    gates.record({
      workflowId: workflow.id,
      gateName: "spec_document_written",
      evidence: { path: "/plans/test.md" },
    });

    expect(gates.isPassed(workflow.id, "spec_document_written")).toBe(true);

    const passed = gates.getPassedNames(workflow.id);
    expect(passed.has("spec_document_written")).toBe(true);
    expect(passed.has("plan_written")).toBe(false);

    db.close();
  });

  it("manages sessions", () => {
    const db = getTestDb();
    const sessions = new SessionRepo(db);

    const session = sessions.create({
      workflowId: null,
      repo: "/repo",
    });

    expect(session.id).toBeTruthy();
    expect(session.active).toBe(true);
    expect(session.bypassed).toBe(false);

    sessions.markBypassed(session.id);
    const updated = sessions.getById(session.id);
    expect(updated?.bypassed).toBe(true);

    sessions.deactivate(session.id);
    const deactivated = sessions.getById(session.id);
    expect(deactivated?.active).toBe(false);

    db.close();
  });

  it("logs audit entries", () => {
    const db = getTestDb();
    const audit = new AuditRepo(db);

    audit.log({
      workflowId: "wf-123",
      eventType: "workflow_started",
      details: { name: "test" },
    });

    audit.log({
      workflowId: "wf-123",
      eventType: "gate_recorded",
      details: { gate: "spec_document_written" },
    });

    const recent = audit.recent(10);
    expect(recent).toHaveLength(2);
    expect(recent[0]?.eventType).toBe("gate_recorded");
    expect(recent[1]?.eventType).toBe("workflow_started");

    db.close();
  });
});
