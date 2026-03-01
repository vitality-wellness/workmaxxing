/**
 * Primitive 3: Next-step directives.
 * After each gate passes, output the mandatory next action.
 */

import { getWorkflowConfig } from "./workflow-config.js";

interface GateDirective {
  gate: string;
  directive: string;
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
  },
  {
    gate: "code_committed",
    directive: "MANDATORY: Run /coderabbit:review NOW. This is required before proceeding.",
  },
  {
    gate: "coderabbit_review",
    directive:
      "MANDATORY: Cross-reference CodeRabbit findings with Linear tickets.\n" +
      "1. List all tickets in the same project/cycle\n" +
      "2. Classify each finding: 'Must Fix Now' or 'Covered by Future Tickets'\n" +
      "3. Post a comment with '## Code Review Findings (CodeRabbit)'\n" +
      "4. Create sub-tickets for each 'Must Fix Now' item",
  },
  {
    gate: "findings_crossreferenced",
    directive:
      "Fix all 'Must Fix Now' items from the cross-reference. " +
      "Post a resolution comment with '## Code Review Findings — Resolved'.",
  },
  {
    gate: "findings_resolved",
    directive:
      "MANDATORY: Verify acceptance criteria.\n" +
      "1. Extract ACs from ticket description\n" +
      "2. Verify each criterion (PASS/FAIL)\n" +
      "3. Post comment with '## Acceptance Criteria Verification' and 'ALL CRITERIA PASSED'",
  },
  {
    gate: "acceptance_criteria",
    directive:
      "All gates passed. Commit final changes, mark ticket as Done in Linear.",
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
    directive: "All tickets done. Use /ship for final verification.",
  },
  {
    gate: "ship_verified",
    directive: "Workflow complete.",
  },
];

/**
 * Get the directive for the next un-passed gate.
 * Returns null if all gates for the current stage are passed.
 */
export function getNextDirective(
  passedGates: Set<string>,
  level: "feature" | "ticket"
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
    return directives[lastPassedIndex]!.directive;
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
  level: "feature" | "ticket"
): string | null {
  const directives =
    level === "feature" ? FEATURE_DIRECTIVES : TICKET_DIRECTIVES;
  const found = directives.find((d) => d.gate === gateName);
  return found?.directive ?? null;
}
