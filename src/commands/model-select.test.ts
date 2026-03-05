import { describe, it, expect } from "vitest";
import {
  selectModel,
  selectImplementAgent,
  type SelectModelInput,
} from "./model-select.js";

// -- Helpers --

/** Base signals with all nulls — override specific fields per test. */
function baseSignals(overrides: Partial<SelectModelInput> = {}): SelectModelInput {
  return {
    estimate: null,
    labels: null,
    complexity: null,
    diffStats: null,
    ticketCount: null,
    allGatesPassed: null,
    ...overrides,
  };
}

// -- powr-investigate --

describe("selectModel: powr-investigate", () => {
  it("returns haiku variant when estimate is 1", () => {
    const result = selectModel(
      "powr-investigate",
      baseSignals({ estimate: 1 })
    );
    expect(result.agentFile).toBe("powr-investigate-haiku");
    expect(result.reason).toContain("estimate");
  });

  it("returns haiku variant when estimate is 0", () => {
    const result = selectModel(
      "powr-investigate",
      baseSignals({ estimate: 0 })
    );
    expect(result.agentFile).toBe("powr-investigate-haiku");
  });

  it("returns haiku variant when labels include bug-fix", () => {
    const result = selectModel(
      "powr-investigate",
      baseSignals({ estimate: 5, labels: ["feature", "bug-fix"] })
    );
    expect(result.agentFile).toBe("powr-investigate-haiku");
    expect(result.reason).toContain("bug-fix");
  });

  it("returns haiku variant when labels include Bug-Fix (case-insensitive)", () => {
    const result = selectModel(
      "powr-investigate",
      baseSignals({ estimate: 3, labels: ["Bug-Fix"] })
    );
    expect(result.agentFile).toBe("powr-investigate-haiku");
  });

  it("returns default agent when estimate is 3 and no bug-fix label", () => {
    const result = selectModel(
      "powr-investigate",
      baseSignals({ estimate: 3, labels: ["feature"] })
    );
    expect(result.agentFile).toBe("powr-investigate");
    expect(result.reason).toContain("3");
  });

  it("returns default agent when estimate is 5", () => {
    const result = selectModel(
      "powr-investigate",
      baseSignals({ estimate: 5, labels: [] })
    );
    expect(result.agentFile).toBe("powr-investigate");
  });

  it("returns default agent when estimate is null (fallback)", () => {
    const result = selectModel(
      "powr-investigate",
      baseSignals({ estimate: null, labels: ["feature"] })
    );
    expect(result.agentFile).toBe("powr-investigate");
    expect(result.reason).toContain("no estimate");
  });

  it("returns default agent when both estimate and labels are null", () => {
    const result = selectModel("powr-investigate", baseSignals());
    expect(result.agentFile).toBe("powr-investigate");
  });

  it("prefers estimate <= 1 over non-bug-fix labels", () => {
    const result = selectModel(
      "powr-investigate",
      baseSignals({ estimate: 1, labels: ["feature"] })
    );
    expect(result.agentFile).toBe("powr-investigate-haiku");
    expect(result.reason).toContain("estimate");
  });
});

// -- powr-code-review --

describe("selectModel: powr-code-review", () => {
  it("returns haiku variant for 1 file with 30 total changed lines", () => {
    const result = selectModel(
      "powr-code-review",
      baseSignals({
        diffStats: { files: 1, insertions: 20, deletions: 10 },
      })
    );
    expect(result.agentFile).toBe("powr-code-review-haiku");
    expect(result.reason).toContain("30");
    expect(result.reason).toContain("< 50");
  });

  it("returns haiku variant for 1 file with 0 changed lines", () => {
    const result = selectModel(
      "powr-code-review",
      baseSignals({
        diffStats: { files: 1, insertions: 0, deletions: 0 },
      })
    );
    expect(result.agentFile).toBe("powr-code-review-haiku");
  });

  it("returns haiku variant for 1 file with 49 total changed lines (boundary)", () => {
    const result = selectModel(
      "powr-code-review",
      baseSignals({
        diffStats: { files: 1, insertions: 30, deletions: 19 },
      })
    );
    expect(result.agentFile).toBe("powr-code-review-haiku");
  });

  it("returns default agent for 1 file with exactly 50 total changed lines (boundary)", () => {
    const result = selectModel(
      "powr-code-review",
      baseSignals({
        diffStats: { files: 1, insertions: 30, deletions: 20 },
      })
    );
    expect(result.agentFile).toBe("powr-code-review");
    expect(result.reason).toContain(">= 50");
  });

  it("returns default agent for 1 file with 60 total changed lines", () => {
    const result = selectModel(
      "powr-code-review",
      baseSignals({
        diffStats: { files: 1, insertions: 40, deletions: 20 },
      })
    );
    expect(result.agentFile).toBe("powr-code-review");
  });

  it("returns default agent for 2 files even with small diff", () => {
    const result = selectModel(
      "powr-code-review",
      baseSignals({
        diffStats: { files: 2, insertions: 5, deletions: 3 },
      })
    );
    expect(result.agentFile).toBe("powr-code-review");
    expect(result.reason).toContain("2 files");
  });

  it("returns default agent for 5 files with large diff", () => {
    const result = selectModel(
      "powr-code-review",
      baseSignals({
        diffStats: { files: 5, insertions: 200, deletions: 50 },
      })
    );
    expect(result.agentFile).toBe("powr-code-review");
  });

  it("returns default agent when diffStats is null (fallback)", () => {
    const result = selectModel(
      "powr-code-review",
      baseSignals({ diffStats: null })
    );
    expect(result.agentFile).toBe("powr-code-review");
    expect(result.reason).toContain("no diff stats");
  });
});

// -- powr-ship-verify --

describe("selectModel: powr-ship-verify", () => {
  it("returns haiku variant for 1 ticket with all gates passed", () => {
    const result = selectModel(
      "powr-ship-verify",
      baseSignals({ ticketCount: 1, allGatesPassed: true })
    );
    expect(result.agentFile).toBe("powr-ship-verify-haiku");
    expect(result.reason).toContain("1 ticket");
  });

  it("returns haiku variant for 2 tickets with all gates passed", () => {
    const result = selectModel(
      "powr-ship-verify",
      baseSignals({ ticketCount: 2, allGatesPassed: true })
    );
    expect(result.agentFile).toBe("powr-ship-verify-haiku");
    expect(result.reason).toContain("2 ticket");
  });

  it("returns default agent for 3 tickets even with all gates passed", () => {
    const result = selectModel(
      "powr-ship-verify",
      baseSignals({ ticketCount: 3, allGatesPassed: true })
    );
    expect(result.agentFile).toBe("powr-ship-verify");
    expect(result.reason).toContain("3 tickets");
    expect(result.reason).toContain("> 2");
  });

  it("returns default agent for 2 tickets with failed gates", () => {
    const result = selectModel(
      "powr-ship-verify",
      baseSignals({ ticketCount: 2, allGatesPassed: false })
    );
    expect(result.agentFile).toBe("powr-ship-verify");
    expect(result.reason).toContain("gates failed");
  });

  it("returns default agent for 1 ticket with failed gates", () => {
    const result = selectModel(
      "powr-ship-verify",
      baseSignals({ ticketCount: 1, allGatesPassed: false })
    );
    expect(result.agentFile).toBe("powr-ship-verify");
  });

  it("returns default agent when ticketCount is null (fallback)", () => {
    const result = selectModel(
      "powr-ship-verify",
      baseSignals({ ticketCount: null, allGatesPassed: true })
    );
    expect(result.agentFile).toBe("powr-ship-verify");
    expect(result.reason).toContain("no ticket count");
  });

  it("returns default agent when allGatesPassed is null (fallback)", () => {
    const result = selectModel(
      "powr-ship-verify",
      baseSignals({ ticketCount: 2, allGatesPassed: null })
    );
    expect(result.agentFile).toBe("powr-ship-verify");
    expect(result.reason).toContain("gate status unknown");
  });

  it("returns default agent when both ticketCount and allGatesPassed are null", () => {
    const result = selectModel("powr-ship-verify", baseSignals());
    expect(result.agentFile).toBe("powr-ship-verify");
  });
});

// -- selectImplementAgent --

describe("selectImplementAgent", () => {
  it('routes Simple to powr-implement', () => {
    const result = selectImplementAgent("Simple");
    expect(result.agent).toBe("powr-implement");
    expect(result.reason).toContain("Simple");
    expect(result.reason).toContain("sonnet");
  });

  it('routes Moderate to powr-implement-complex', () => {
    const result = selectImplementAgent("Moderate");
    expect(result.agent).toBe("powr-implement-complex");
    expect(result.reason).toContain("Moderate");
    expect(result.reason).toContain("inherit");
  });

  it('routes Complex to powr-implement-complex', () => {
    const result = selectImplementAgent("Complex");
    expect(result.agent).toBe("powr-implement-complex");
    expect(result.reason).toContain("Complex");
    expect(result.reason).toContain("inherit");
  });

  it('routes null to powr-implement-complex (conservative fallback)', () => {
    const result = selectImplementAgent(null);
    expect(result.agent).toBe("powr-implement-complex");
    expect(result.reason).toContain("unknown");
    expect(result.reason).toContain("inherit");
  });
});

// -- Cross-cutting: every result has agentFile + reason --

describe("selectModel: all results have agentFile and reason", () => {
  const agents = [
    "powr-investigate",
    "powr-code-review",
    "powr-ship-verify",
  ] as const;

  for (const agent of agents) {
    it(`${agent} returns non-empty agentFile and reason`, () => {
      const result = selectModel(agent, baseSignals());
      expect(result.agentFile).toBeTruthy();
      expect(result.reason).toBeTruthy();
      expect(typeof result.agentFile).toBe("string");
      expect(typeof result.reason).toBe("string");
    });
  }
});
