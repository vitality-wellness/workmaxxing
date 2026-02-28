import { describe, it, expect } from "vitest";
import { detectGatesFromComment } from "./gate-detection.js";

describe("detectGatesFromComment", () => {
  it("detects investigation gate", () => {
    const result = detectGatesFromComment(
      "## Investigation Findings\n\nThe codebase uses..."
    );
    expect(result).toEqual([{ gate: "investigation", confidence: "exact" }]);
  });

  it("detects findings_crossreferenced gate", () => {
    const result = detectGatesFromComment(
      "## Code Review Findings (CodeRabbit)\n\nMust Fix Now:\n- thing"
    );
    expect(result).toEqual([
      { gate: "findings_crossreferenced", confidence: "exact" },
    ]);
  });

  it("auto-passes findings_resolved when no Must Fix Now", () => {
    const result = detectGatesFromComment(
      "## Code Review Findings (CodeRabbit)\n\nAll items covered by future tickets."
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      gate: "findings_crossreferenced",
      confidence: "exact",
    });
    expect(result[1]).toEqual({
      gate: "findings_resolved",
      confidence: "inferred",
    });
  });

  it("does NOT auto-pass findings_resolved when Must Fix Now exists", () => {
    const result = detectGatesFromComment(
      "## Code Review Findings (CodeRabbit)\n\n### Must Fix Now\n- Fix the bug"
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.gate).toBe("findings_crossreferenced");
  });

  it("detects findings_resolved gate", () => {
    const result = detectGatesFromComment(
      "## Code Review Findings — Resolved\n\nAll items fixed."
    );
    expect(result).toEqual([
      { gate: "findings_resolved", confidence: "exact" },
    ]);
  });

  it("detects acceptance_criteria gate", () => {
    const result = detectGatesFromComment(
      "## Acceptance Criteria Verification\n\nALL CRITERIA PASSED"
    );
    expect(result).toEqual([
      { gate: "acceptance_criteria", confidence: "exact" },
    ]);
  });

  it("auto-passes acceptance_criteria when no explicit ACs", () => {
    const result = detectGatesFromComment(
      "The ticket has no explicit acceptance criteria, so verifying implementation."
    );
    expect(result).toEqual([
      { gate: "acceptance_criteria", confidence: "exact" },
    ]);
  });

  it("returns empty for unrelated comments", () => {
    const result = detectGatesFromComment("Just a regular comment about progress.");
    expect(result).toEqual([]);
  });
});
