import { describe, it, expect } from "vitest";
import { detectGatesFromComment } from "./gate-detection.js";

describe("detectGatesFromComment", () => {
  it("detects investigation gate", () => {
    const result = detectGatesFromComment(
      "## Investigation Findings\n\nThe codebase uses..."
    );
    expect(result).toEqual([{ gate: "investigation", confidence: "exact" }]);
  });

  it("detects investigation from markdown header", () => {
    const result = detectGatesFromComment(
      "## Investigation\n\n**File:**..."
    );
    expect(result).toEqual([{ gate: "investigation", confidence: "exact" }]);
  });

  it("returns empty for unrelated comments", () => {
    const result = detectGatesFromComment("Just a regular comment about progress.");
    expect(result).toEqual([]);
  });
});
