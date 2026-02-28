import type { ParsedPlan } from "./plan-parser.js";

// --- Types ---

export interface TicketSpec {
  /** Step number from the plan */
  stepNumber: number;
  /** Issue title */
  title: string;
  /** Markdown description with acceptance criteria */
  description: string;
  /** Sub-issue specs */
  subTickets: SubTicketSpec[];
  /** Step numbers this depends on (maps to other TicketSpecs) */
  dependsOnSteps: number[];
  /** Inferred label names */
  labels: string[];
  /** Priority: 1=Urgent, 2=High, 3=Normal, 4=Low */
  priority: number;
  /** Estimate in points */
  estimate: number;
}

export interface SubTicketSpec {
  title: string;
  description: string;
}

// --- Label mapping ---

const REPO_LABEL_MAP: Record<string, string> = {
  frontend: "Frontend",
  api: "Backend",
  website: "Frontend",
};

const EFFORT_ESTIMATE_MAP: Record<string, number> = {
  small: 1,
  medium: 3,
  large: 5,
};

// --- Spec generation (pure, no API calls) ---

/**
 * Convert parsed plan steps into ticket specs.
 * Pure function — no side effects. Output is consumed by Claude
 * to create tickets via the Linear MCP plugin.
 */
export function planToTicketSpecs(plan: ParsedPlan): TicketSpec[] {
  return plan.steps.map((step) => {
    const labels: string[] = ["Feature"];
    if (step.repo) {
      const repoLabel = REPO_LABEL_MAP[step.repo];
      if (repoLabel) labels.push(repoLabel);
    }

    // Priority: first steps (fewer deps) get higher priority
    const priority = step.dependencies.length === 0 ? 2 : 3;

    // Format description with acceptance criteria
    const descParts: string[] = [];
    descParts.push(`## Goal\n\n${step.title}`);

    if (step.description) {
      descParts.push(`## Details\n\n${step.description}`);
    }

    if (step.acceptanceCriteria.length > 0) {
      descParts.push(
        `## Acceptance Criteria\n\n${step.acceptanceCriteria.map((ac) => `- [ ] ${ac}`).join("\n")}`
      );
    }

    // Generate sub-tickets from substeps
    const subTickets: SubTicketSpec[] = step.substeps.map((sub) => ({
      title: sub.title,
      description: sub.description || `Implementation task for: ${sub.title}`,
    }));

    return {
      stepNumber: step.number,
      title: step.title,
      description: descParts.join("\n\n"),
      subTickets,
      dependsOnSteps: step.dependencies,
      labels,
      priority,
      estimate: EFFORT_ESTIMATE_MAP[step.estimatedEffort] ?? 3,
    };
  });
}

/**
 * Format ticket specs as a human-readable preview.
 */
export function formatTicketPreview(specs: TicketSpec[]): string {
  const lines: string[] = [];
  lines.push(`Plan → ${specs.length} ticket(s):\n`);

  for (const spec of specs) {
    const deps =
      spec.dependsOnSteps.length > 0
        ? ` (blocked by step ${spec.dependsOnSteps.join(", ")})`
        : "";
    const labels = spec.labels.join(", ");
    const priority =
      ["", "Urgent", "High", "Normal", "Low"][spec.priority] ?? "Normal";

    lines.push(`  ${spec.stepNumber}. ${spec.title}`);
    lines.push(
      `     Priority: ${priority} | Estimate: ${spec.estimate}pt | Labels: ${labels}${deps}`
    );

    if (spec.subTickets.length > 0) {
      for (const sub of spec.subTickets) {
        lines.push(`     └─ ${sub.title}`);
      }
    }

    if (spec.dependsOnSteps.length > 0) {
      lines.push(
        `     ⛓  Blocked by: step ${spec.dependsOnSteps.join(", step ")}`
      );
    }

    lines.push("");
  }

  return lines.join("\n");
}
