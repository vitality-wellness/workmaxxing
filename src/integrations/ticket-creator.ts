import type { LinearClient } from "@linear/sdk";
import type { PlanStep, ParsedPlan } from "./plan-parser.js";

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

export interface CreatedTicket {
  identifier: string;
  id: string;
  title: string;
  url: string;
  subTickets: Array<{ identifier: string; id: string; title: string; url: string }>;
}

export interface CreateTicketsOptions {
  teamId: string;
  projectId?: string;
  milestoneId?: string;
  cycleId?: string;
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
 * This is a pure function — no side effects.
 */
export function planToTicketSpecs(plan: ParsedPlan): TicketSpec[] {
  return plan.steps.map((step, index) => {
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
 * Format ticket specs as a human-readable preview (for dry-run mode).
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
    const priority = ["", "Urgent", "High", "Normal", "Low"][spec.priority] ?? "Normal";

    lines.push(
      `  ${spec.stepNumber}. ${spec.title}`
    );
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

// --- Linear API ticket creation ---

/**
 * Create tickets in Linear from specs.
 * Returns the created ticket identifiers for dependency wiring.
 */
export async function createTicketsInLinear(
  client: LinearClient,
  specs: TicketSpec[],
  options: CreateTicketsOptions
): Promise<CreatedTicket[]> {
  const created: CreatedTicket[] = [];
  // Map step number → created issue ID for dependency wiring
  const stepToIssueId = new Map<number, string>();

  // Resolve label IDs
  const labelMap = await resolveLabelIds(client, options.teamId, specs);

  // Create parent issues first (in order, so deps can be wired)
  for (const spec of specs) {
    const issuePayload = await client.createIssue({
      teamId: options.teamId,
      title: spec.title,
      description: spec.description,
      priority: spec.priority,
      estimate: spec.estimate,
      labelIds: spec.labels
        .map((l) => labelMap.get(l))
        .filter((id): id is string => id !== undefined),
      ...(options.projectId ? { projectId: options.projectId } : {}),
      ...(options.milestoneId
        ? { projectMilestoneId: options.milestoneId }
        : {}),
      ...(options.cycleId ? { cycleId: options.cycleId } : {}),
    });

    const issue = await issuePayload.issue;
    if (!issue) throw new Error(`Failed to create issue for step ${spec.stepNumber}`);

    stepToIssueId.set(spec.stepNumber, issue.id);

    // Create sub-issues
    const subTickets: CreatedTicket["subTickets"] = [];
    for (const sub of spec.subTickets) {
      const subPayload = await client.createIssue({
        teamId: options.teamId,
        title: sub.title,
        description: sub.description,
        parentId: issue.id,
        priority: spec.priority,
        estimate: 1,
        ...(options.projectId ? { projectId: options.projectId } : {}),
      });
      const subIssue = await subPayload.issue;
      if (subIssue) {
        subTickets.push({
          identifier: subIssue.identifier,
          id: subIssue.id,
          title: sub.title,
          url: subIssue.url,
        });
      }
    }

    created.push({
      identifier: issue.identifier,
      id: issue.id,
      title: spec.title,
      url: issue.url,
      subTickets,
    });
  }

  // Wire dependencies (second pass — all issues must exist first)
  for (const spec of specs) {
    if (spec.dependsOnSteps.length === 0) continue;
    const issueId = stepToIssueId.get(spec.stepNumber);
    if (!issueId) continue;

    const blockingIds = spec.dependsOnSteps
      .map((stepNum) => stepToIssueId.get(stepNum))
      .filter((id): id is string => id !== undefined);

    if (blockingIds.length > 0) {
      for (const blockingId of blockingIds) {
        await client.createIssueRelation({
          issueId,
          relatedIssueId: blockingId,
          type: "blocks",
        });
      }
    }
  }

  return created;
}

async function resolveLabelIds(
  client: LinearClient,
  teamId: string,
  specs: TicketSpec[]
): Promise<Map<string, string>> {
  const neededLabels = new Set<string>();
  for (const spec of specs) {
    for (const label of spec.labels) {
      neededLabels.add(label);
    }
  }

  const labelMap = new Map<string, string>();
  const team = await client.team(teamId);
  const labels = await team.labels();

  for (const label of labels.nodes) {
    if (neededLabels.has(label.name)) {
      labelMap.set(label.name, label.id);
    }
  }

  return labelMap;
}
