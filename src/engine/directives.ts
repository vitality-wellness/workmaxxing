/**
 * Primitive 3: Next-step directives.
 * After each gate passes, output the mandatory next action.
 */

import { getWorkflowConfig } from "./workflow-config.js";

interface GateDirective {
  gate: string;
  directive: string;
  /** Alternative directive when review mode is enabled */
  reviewDirective?: string;
}

/**
 * Per-ticket gate directives — what to do after each gate passes.
 */
const TICKET_DIRECTIVES: GateDirective[] = [
  {
    gate: "ticket_in_progress",
    directive:
      "MANDATORY: Investigate the codebase first. Answer 5 questions (similar features, types, utilities, state, constraints). Post investigation comment.",
  },
  {
    gate: "investigation",
    directive:
      "Implement the feature following your investigation findings. Commit when done. After commit, run /coderabbit:review.",
    reviewDirective:
      "Implement the feature following your investigation findings. Stage changes with `git add` but do NOT commit — the human will review and commit. Then run /coderabbit:review on staged changes.",
  },
  {
    gate: "code_committed",
    directive: "MANDATORY: Run /coderabbit:review NOW. This is required before proceeding.",
  },
  {
    gate: "coderabbit_review",
    directive:
      "Code review complete. Set ticket to 'In Human Review' in Linear (fall back to 'In Review' if that status doesn't exist):\n" +
      "  mcp__plugin_linear_linear__save_issue({ id: \"<ticket-id>\", state: \"In Human Review\" })\n" +
      "The human will review, cross-reference findings, verify ACs, and mark Done during shipping.",
    reviewDirective:
      "Code review complete. Set ticket to 'In Human Review' in Linear (fall back to 'In Review' if that status doesn't exist):\n" +
      "  mcp__plugin_linear_linear__save_issue({ id: \"<ticket-id>\", state: \"In Human Review\" })\n" +
      "REVIEW MODE: Changes are staged but not committed. The human will review the diff, commit, create a PR, and mark Done.",
  },
];

/**
 * Feature-level gate directives.
 */
const FEATURE_DIRECTIVES: GateDirective[] = [
  {
    gate: "spec_document_written",
    directive: "Spec complete. Use /plan to create an implementation plan.",
  },
  {
    gate: "plan_written",
    directive: "Plan written. Review will begin on ExitPlanMode.",
  },
  {
    gate: "review_architecture",
    directive: "Architecture review approved. Continue with code quality review.",
  },
  {
    gate: "review_code_quality",
    directive: "Code quality review approved. Continue with test review.",
  },
  {
    gate: "review_tests",
    directive: "Test review approved. Continue with performance review.",
  },
  {
    gate: "review_performance",
    directive: "Performance review approved. Continue with ticket decomposition review.",
  },
  {
    gate: "review_ticket_decomposition",
    directive: "All reviews approved. Create Linear tickets from the plan.",
  },
  {
    gate: "tickets_created",
    directive:
      "STOP. /powr plan is complete. Do NOT continue to execution. " +
      'Tell the user: "Tickets created. Type `/powr execute` to start building." ' +
      "Do not call any more tools. Do not start working on tickets. The user must explicitly invoke /powr execute.",
  },
  {
    gate: "all_tickets_done",
    directive:
      "All tickets ready for shipping. Use /powr ship to verify, mark tickets Done, and close out the workflow.",
  },
  {
    gate: "ship_verified",
    directive: "Workflow complete.",
  },
];

/** Pick the right directive text based on review mode */
function pickDirective(d: GateDirective, reviewMode: boolean): string {
  return reviewMode && d.reviewDirective ? d.reviewDirective : d.directive;
}

/**
 * Get the directive for the next un-passed gate.
 * Returns null if all gates for the current stage are passed.
 */
export function getNextDirective(
  passedGates: Set<string>,
  level: "feature" | "ticket",
  reviewMode = false
): string | null {
  const directives =
    level === "feature" ? FEATURE_DIRECTIVES : TICKET_DIRECTIVES;

  // Find the most recently passed gate to determine the next directive
  let lastPassedIndex = -1;
  for (let i = directives.length - 1; i >= 0; i--) {
    if (passedGates.has(directives[i]!.gate)) {
      lastPassedIndex = i;
      break;
    }
  }

  // The directive to show is the one for the last passed gate
  // (it tells you what to do NEXT after that gate passed)
  if (lastPassedIndex >= 0) {
    return pickDirective(directives[lastPassedIndex]!, reviewMode);
  }

  // No gates passed yet — show the first required action
  if (level === "ticket") {
    return "MANDATORY: Set ticket to In Progress in Linear. The ticket_in_progress gate will auto-record.\n  mcp__plugin_linear_linear__save_issue({ id: \"<ticket-id>\", state: \"In Progress\" })";
  }
  return null;
}

/**
 * Get the directive for a specific gate that just passed.
 */
export function getDirectiveForGate(
  gateName: string,
  level: "feature" | "ticket",
  reviewMode = false
): string | null {
  const directives =
    level === "feature" ? FEATURE_DIRECTIVES : TICKET_DIRECTIVES;
  const found = directives.find((d) => d.gate === gateName);
  if (!found) return null;
  return pickDirective(found, reviewMode);
}
