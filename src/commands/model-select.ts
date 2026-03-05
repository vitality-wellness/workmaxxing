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
  // Threshold: estimate <= 1 maps to haiku.
  // Rationale: a 1-point ticket is a small, bounded change (single function, config tweak).
  // Investigation for these is just "find the file, read it, report." Haiku handles this
  // reliably at ~19x less cost than Opus and ~5x less than Sonnet.
  if (signals.estimate !== null && signals.estimate <= 1) {
    return {
      model: "haiku",
      reason: `estimate is ${signals.estimate} (<= 1), using haiku`,
    };
  }

  // Bug-fix label independently triggers haiku regardless of estimate.
  // Rationale: bug fixes have a known root cause to chase — the investigation pattern is
  // grep → read → identify. This is well within Haiku's capability, and we don't want to
  // pay Sonnet rates just because a bug-fix ticket has estimate = 2.
  if (
    signals.labels !== null &&
    signals.labels.some((l) => l.toLowerCase() === "bug-fix")
  ) {
    return {
      model: "haiku",
      reason: 'labels include "bug-fix", using haiku',
    };
  }

  // Conservative fallback: sonnet for everything else (larger features, null estimate).
  // We never upgrade investigation to Opus — investigation informs decisions but doesn't
  // make architectural ones. Sonnet provides ample reasoning for codebase exploration.
  return {
    model: "sonnet",
    reason:
      signals.estimate !== null
        ? `estimate is ${signals.estimate} (> 1) with no bug-fix label, using sonnet`
        : "no estimate available, defaulting to sonnet",
  };
}

function selectCodeReviewModel(signals: SelectModelInput): ModelSelection {
  // Conservative fallback when diff stats are unavailable (e.g., first run, pre-commit).
  // We can't assess scope without the diff, so default to the safer Sonnet tier.
  if (signals.diffStats === null) {
    return {
      model: "sonnet",
      reason: "no diff stats available, defaulting to sonnet",
    };
  }

  const totalLines = signals.diffStats.insertions + signals.diffStats.deletions;

  // Threshold: single file AND < 50 total changed lines → haiku.
  // Rationale: a small single-file diff is pure pattern-matching — check naming,
  // check logic, check test coverage. This is the cheapest form of review and Haiku
  // handles it without quality loss. The 50-line threshold is empirically "one screen
  // of code"; above that, cross-file reasoning starts to matter.
  if (signals.diffStats.files === 1 && totalLines < 50) {
    return {
      model: "haiku",
      reason: `single file with ${totalLines} changed lines (< 50), using haiku`,
    };
  }

  // Multi-file diffs need cross-file reasoning — Sonnet can track import chains,
  // side effects across modules, and interface consistency. Opus adds no value here
  // since code review is checklist-based, not architectural.
  if (signals.diffStats.files > 1) {
    return {
      model: "sonnet",
      reason: `${signals.diffStats.files} files changed, using sonnet`,
    };
  }

  // Single file but >= 50 lines: enough code that subtle logic bugs can hide.
  // Upgrade to Sonnet for deeper line-by-line reasoning.
  return {
    model: "sonnet",
    reason: `single file but ${totalLines} changed lines (>= 50), using sonnet`,
  };
}

function selectShipVerifyModel(signals: SelectModelInput): ModelSelection {
  // Can't determine scope without ticket count — default to Sonnet.
  if (signals.ticketCount === null) {
    return {
      model: "sonnet",
      reason: "no ticket count available, defaulting to sonnet",
    };
  }

  // Gate status unknown means we can't confirm the happy path — stay on Sonnet
  // so the agent has enough reasoning to investigate why gates are missing.
  if (signals.allGatesPassed === null) {
    return {
      model: "sonnet",
      reason: "gate status unknown, defaulting to sonnet",
    };
  }

  // Threshold: <= 2 tickets AND all gates passed → haiku.
  // Rationale: when everything is green, ship verify is "read state, confirm all green,
  // format the report." This is pure data aggregation with no reasoning required.
  // Haiku handles this at 19x less cost than Opus and 5x less than Sonnet.
  // The 2-ticket ceiling keeps Haiku on small, low-risk ships where verification
  // failures would be obvious; larger batches have more surface area for subtle issues.
  if (signals.ticketCount <= 2 && signals.allGatesPassed) {
    return {
      model: "haiku",
      reason: `${signals.ticketCount} ticket(s) with all gates passed, using haiku`,
    };
  }

  // Failed gates need investigation: which gate failed, why, what to do.
  // Sonnet has the reasoning depth to connect gate failures to specific tickets.
  if (!signals.allGatesPassed) {
    return {
      model: "sonnet",
      reason: `some gates failed, using sonnet`,
    };
  }

  // 3+ tickets, all gates passed: verify is still just data aggregation,
  // but larger batch size means more surface area — Sonnet for thoroughness.
  return {
    model: "sonnet",
    reason: `${signals.ticketCount} tickets (> 2), using sonnet`,
  };
}

/**
 * Select the implementation agent based on complexity.
 * Simple -> powr-implement (sonnet), Moderate/Complex -> powr-implement-complex (inherit).
 * Null complexity defaults to powr-implement-complex (conservative fallback).
 *
 * Note: this is an agent routing decision, not a model override. The two agents have
 * different system prompts optimized for their complexity tier. powr-implement (Sonnet)
 * is tuned for straightforward, bounded changes. powr-implement-complex (inherit = user's
 * model, typically Opus) is tuned for architecture decisions, cross-cutting changes, and
 * cases where the implementation approach itself is uncertain.
 *
 * The "inherit" default on powr-implement-complex means it runs at whatever model the
 * user has configured, making it the safe choice when complexity is ambiguous.
 */
export function selectImplementAgent(
  complexity: Complexity | null
): { agent: "powr-implement" | "powr-implement-complex"; reason: string } {
  // Simple complexity: the investigation confirmed a bounded, well-understood change.
  // Sonnet (via powr-implement) handles this reliably at 5x less cost than Opus.
  if (complexity === "Simple") {
    return {
      agent: "powr-implement",
      reason: 'complexity is "Simple", routing to powr-implement (sonnet)',
    };
  }

  // Unknown complexity (null): investigation hasn't run yet or didn't produce a rating.
  // Conservative fallback to powr-implement-complex (inherit) — better to over-provision
  // than to undermine the implementation with an underpowered model on an unknown task.
  if (complexity === null) {
    return {
      agent: "powr-implement-complex",
      reason:
        "complexity unknown, defaulting to powr-implement-complex (inherit)",
    };
  }

  // Moderate or Complex: requires deeper reasoning, possibly architectural decisions.
  // Route to powr-implement-complex (inherit = user's model, typically Opus).
  return {
    agent: "powr-implement-complex",
    reason: `complexity is "${complexity}", routing to powr-implement-complex (inherit)`,
  };
}
