import type { Complexity, DiffStats } from "./model-signals.js";

/**
 * Agent names that support dynamic model selection.
 * powr-implement routing is handled separately via selectImplementAgent().
 */
export type ModelSelectAgent =
  | "powr-investigate"
  | "powr-code-review"
  | "powr-ship-verify";

/**
 * Input signals for model selection decisions.
 * All fields are nullable — missing data triggers conservative (sonnet) fallback.
 */
export interface SelectModelInput {
  estimate: number | null;
  labels: string[] | null;
  complexity: Complexity | null;
  diffStats: DiffStats | null;
  /** Number of tickets in the current ship batch (only used for ship-verify). */
  ticketCount: number | null;
  /** Whether all quality gates passed for all tickets (only used for ship-verify). */
  allGatesPassed: boolean | null;
}

export interface ModelSelection {
  model: string;
  reason: string;
}

/**
 * Select the appropriate model for a given agent based on ticket signals.
 *
 * Decision table:
 * - powr-investigate: haiku if estimate <= 1 OR labels includes "bug-fix", sonnet otherwise
 * - powr-code-review: haiku if diffStats.files === 1 AND total diff lines < 50, sonnet otherwise
 * - powr-ship-verify: haiku if ticketCount <= 2 AND allGatesPassed, sonnet otherwise
 */
export function selectModel(
  agent: ModelSelectAgent,
  signals: SelectModelInput
): ModelSelection {
  switch (agent) {
    case "powr-investigate":
      return selectInvestigateModel(signals);
    case "powr-code-review":
      return selectCodeReviewModel(signals);
    case "powr-ship-verify":
      return selectShipVerifyModel(signals);
  }
}

function selectInvestigateModel(signals: SelectModelInput): ModelSelection {
  if (signals.estimate !== null && signals.estimate <= 1) {
    return {
      model: "haiku",
      reason: `estimate is ${signals.estimate} (<= 1), using haiku`,
    };
  }

  if (
    signals.labels !== null &&
    signals.labels.some((l) => l.toLowerCase() === "bug-fix")
  ) {
    return {
      model: "haiku",
      reason: 'labels include "bug-fix", using haiku',
    };
  }

  return {
    model: "sonnet",
    reason:
      signals.estimate !== null
        ? `estimate is ${signals.estimate} (> 1) with no bug-fix label, using sonnet`
        : "no estimate available, defaulting to sonnet",
  };
}

function selectCodeReviewModel(signals: SelectModelInput): ModelSelection {
  if (signals.diffStats === null) {
    return {
      model: "sonnet",
      reason: "no diff stats available, defaulting to sonnet",
    };
  }

  const totalLines = signals.diffStats.insertions + signals.diffStats.deletions;

  if (signals.diffStats.files === 1 && totalLines < 50) {
    return {
      model: "haiku",
      reason: `single file with ${totalLines} changed lines (< 50), using haiku`,
    };
  }

  if (signals.diffStats.files > 1) {
    return {
      model: "sonnet",
      reason: `${signals.diffStats.files} files changed, using sonnet`,
    };
  }

  return {
    model: "sonnet",
    reason: `single file but ${totalLines} changed lines (>= 50), using sonnet`,
  };
}

function selectShipVerifyModel(signals: SelectModelInput): ModelSelection {
  if (signals.ticketCount === null) {
    return {
      model: "sonnet",
      reason: "no ticket count available, defaulting to sonnet",
    };
  }

  if (signals.allGatesPassed === null) {
    return {
      model: "sonnet",
      reason: "gate status unknown, defaulting to sonnet",
    };
  }

  if (signals.ticketCount <= 2 && signals.allGatesPassed) {
    return {
      model: "haiku",
      reason: `${signals.ticketCount} ticket(s) with all gates passed, using haiku`,
    };
  }

  if (!signals.allGatesPassed) {
    return {
      model: "sonnet",
      reason: `some gates failed, using sonnet`,
    };
  }

  return {
    model: "sonnet",
    reason: `${signals.ticketCount} tickets (> 2), using sonnet`,
  };
}

/**
 * Select the implementation agent based on complexity.
 * Simple -> powr-implement (sonnet), Moderate/Complex -> powr-implement-complex (inherit).
 * Null complexity defaults to powr-implement-complex (conservative fallback).
 */
export function selectImplementAgent(
  complexity: Complexity | null
): { agent: "powr-implement" | "powr-implement-complex"; reason: string } {
  if (complexity === "Simple") {
    return {
      agent: "powr-implement",
      reason: 'complexity is "Simple", routing to powr-implement (sonnet)',
    };
  }

  if (complexity === null) {
    return {
      agent: "powr-implement-complex",
      reason:
        "complexity unknown, defaulting to powr-implement-complex (inherit)",
    };
  }

  return {
    agent: "powr-implement-complex",
    reason: `complexity is "${complexity}", routing to powr-implement-complex (inherit)`,
  };
}
