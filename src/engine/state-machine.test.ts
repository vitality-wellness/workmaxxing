import { describe, it, expect } from "vitest";
import {
  validateTransition,
  checkGates,
  validateGateEvidence,
  getTransitionChain,
  validateConfig,
} from "./state-machine.js";
import { getWorkflowConfig } from "./workflow-config.js";

const { stages, ticketStages } = getWorkflowConfig();

describe("validateTransition", () => {
  it("allows valid forward transitions", () => {
    expect(validateTransition(stages, "SPECCING", "PLANNING").valid).toBe(true);
    expect(validateTransition(stages, "PLANNING", "REVIEWING").valid).toBe(true);
    expect(validateTransition(stages, "REVIEWING", "TICKETING").valid).toBe(true);
    expect(validateTransition(stages, "TICKETING", "EXECUTING").valid).toBe(true);
    expect(validateTransition(stages, "EXECUTING", "SHIPPING").valid).toBe(true);
    expect(validateTransition(stages, "SHIPPING", "IDLE").valid).toBe(true);
  });

  it("rejects skipping stages", () => {
    const result = validateTransition(stages, "SPECCING", "REVIEWING");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Next stage must be");
  });

  it("rejects backward transitions", () => {
    const result = validateTransition(stages, "REVIEWING", "SPECCING");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Next stage must be");
  });

  it("rejects advancing from terminal stage", () => {
    const result = validateTransition(stages, "IDLE", "SPECCING");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("terminal");
  });

  it("rejects unknown stages", () => {
    expect(validateTransition(stages, "NONEXISTENT", "PLANNING").valid).toBe(false);
    expect(validateTransition(stages, "SPECCING", "NONEXISTENT").valid).toBe(false);
  });

  it("allows valid ticket transitions", () => {
    expect(validateTransition(ticketStages, "QUEUED", "INVESTIGATING").valid).toBe(true);
    expect(validateTransition(ticketStages, "INVESTIGATING", "IMPLEMENTING").valid).toBe(true);
    expect(validateTransition(ticketStages, "IMPLEMENTING", "CODE_REVIEWING").valid).toBe(true);
    expect(validateTransition(ticketStages, "CODE_REVIEWING", "DONE").valid).toBe(true);
  });

  it("rejects skipping ticket stages", () => {
    const result = validateTransition(ticketStages, "QUEUED", "IMPLEMENTING");
    expect(result.valid).toBe(false);
  });
});

describe("checkGates", () => {
  it("returns missing gates", () => {
    const passed = new Set(["spec_document_written"]);
    const missing = checkGates(stages, "SPECCING", passed);
    expect(missing).toEqual([]);
  });

  it("returns all required gates when none passed", () => {
    const missing = checkGates(stages, "REVIEWING", new Set());
    expect(missing).toEqual([
      "review_architecture",
      "review_code_quality",
      "review_tests",
      "review_performance",
      "review_ticket_decomposition",
    ]);
  });

  it("returns partial missing gates", () => {
    const passed = new Set(["review_architecture", "review_tests"]);
    const missing = checkGates(stages, "REVIEWING", passed);
    expect(missing).toEqual([
      "review_code_quality",
      "review_performance",
      "review_ticket_decomposition",
    ]);
  });

  it("returns empty for stages with no gates", () => {
    const missing = checkGates(stages, "IDLE", new Set());
    expect(missing).toEqual([]);
  });
});

describe("validateGateEvidence", () => {
  it("accepts path evidence for spec_document_written", () => {
    const result = validateGateEvidence("spec_document_written", {
      path: "/plans/test.md",
    });
    expect(result.valid).toBe(true);
  });

  it("accepts documentId evidence for spec_document_written", () => {
    const result = validateGateEvidence("spec_document_written", {
      documentId: "0a26c332-23e2-45fe-9e05-2906dc6f7a62",
    });
    expect(result.valid).toBe(true);
  });

  it("rejects empty evidence for spec_document_written", () => {
    const result = validateGateEvidence("spec_document_written", {});
    expect(result.valid).toBe(false);
    expect(result.error).toContain("spec_document_written");
  });

  it("accepts valid evidence for tickets_created", () => {
    const result = validateGateEvidence("tickets_created", {
      ticketIds: ["POWR-100", "POWR-101"],
    });
    expect(result.valid).toBe(true);
  });

  it("accepts any evidence for unknown gates", () => {
    const result = validateGateEvidence("custom_gate", { anything: true });
    expect(result.valid).toBe(true);
  });

  it("accepts passthrough evidence for ticket gates", () => {
    const result = validateGateEvidence("investigation", {
      commentUrl: "https://linear.app/...",
      extraField: "allowed",
    });
    expect(result.valid).toBe(true);
  });

  it("requires linearIssueId for ticket_in_progress", () => {
    const result = validateGateEvidence("ticket_in_progress", {});
    expect(result.valid).toBe(false);
    expect(result.error).toContain("ticket_in_progress");
  });

  it("accepts valid ticket_in_progress evidence", () => {
    const result = validateGateEvidence("ticket_in_progress", {
      linearIssueId: "POWR-500",
    });
    expect(result.valid).toBe(true);
  });

  it("requires commitSha for code_committed", () => {
    const result = validateGateEvidence("code_committed", {});
    expect(result.valid).toBe(false);
    expect(result.error).toContain("code_committed");
  });

  it("accepts valid code_committed evidence with SHA", () => {
    const result = validateGateEvidence("code_committed", {
      commitSha: "abc1234",
    });
    expect(result.valid).toBe(true);
  });
});

describe("getTransitionChain", () => {
  it("returns full feature workflow chain", () => {
    const chain = getTransitionChain(stages, "SPECCING");
    expect(chain).toEqual([
      "SPECCING",
      "PLANNING",
      "REVIEWING",
      "TICKETING",
      "EXECUTING",
      "SHIPPING",
      "IDLE",
    ]);
  });

  it("returns full ticket workflow chain", () => {
    const chain = getTransitionChain(ticketStages, "QUEUED");
    expect(chain).toEqual([
      "QUEUED",
      "INVESTIGATING",
      "IMPLEMENTING",
      "CODE_REVIEWING",
      "DONE",
    ]);
  });

  it("returns single stage for terminal", () => {
    expect(getTransitionChain(stages, "IDLE")).toEqual(["IDLE"]);
    expect(getTransitionChain(ticketStages, "DONE")).toEqual(["DONE"]);
  });
});

describe("validateConfig", () => {
  it("returns no errors for current config", () => {
    const errors = validateConfig();
    expect(errors).toEqual([]);
  });
});
