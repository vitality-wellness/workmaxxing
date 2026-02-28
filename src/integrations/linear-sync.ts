import type { LinearClient } from "@linear/sdk";

// --- Label management ---

const WORKFLOW_LABELS = [
  { name: "workflow:investigating", color: "#3B82F6" },
  { name: "workflow:implementing", color: "#10B981" },
  { name: "workflow:reviewing", color: "#F59E0B" },
  { name: "workflow:done", color: "#6366F1" },
  { name: "gate:investigation", color: "#93C5FD" },
  { name: "gate:coderabbit", color: "#86EFAC" },
  { name: "gate:crossref", color: "#FDE68A" },
  { name: "gate:ac-verified", color: "#C4B5FD" },
];

/**
 * Ensure all workflow labels exist for a team. Idempotent.
 */
export async function ensureWorkflowLabels(
  client: LinearClient,
  teamId: string
): Promise<Map<string, string>> {
  const team = await client.team(teamId);
  const existingLabels = await team.labels();
  const existingMap = new Map(
    existingLabels.nodes.map((l) => [l.name, l.id])
  );

  const labelMap = new Map<string, string>();
  let created = 0;

  for (const label of WORKFLOW_LABELS) {
    const existing = existingMap.get(label.name);
    if (existing) {
      labelMap.set(label.name, existing);
    } else {
      const result = await client.createIssueLabel({
        name: label.name,
        color: label.color,
        teamId,
      });
      const newLabel = await result.issueLabel;
      if (newLabel) {
        labelMap.set(label.name, newLabel.id);
        created++;
      }
    }
  }

  return labelMap;
}

// --- Stage → Linear status mapping ---

const STAGE_TO_STATUS: Record<string, string> = {
  QUEUED: "Backlog",
  INVESTIGATING: "In Progress",
  IMPLEMENTING: "In Progress",
  CODE_REVIEWING: "In Review",
  CROSS_REFING: "In Review",
  FIXING: "In Progress",
  VERIFYING_ACS: "In Review",
  DONE: "Done",
};

const STAGE_TO_LABEL: Record<string, string> = {
  INVESTIGATING: "workflow:investigating",
  IMPLEMENTING: "workflow:implementing",
  CODE_REVIEWING: "workflow:reviewing",
  CROSS_REFING: "workflow:reviewing",
  FIXING: "workflow:implementing",
  VERIFYING_ACS: "workflow:reviewing",
  DONE: "workflow:done",
};

/**
 * Sync a ticket's workflow stage to its Linear issue status and labels.
 */
export async function syncTicketStageToLinear(
  client: LinearClient,
  linearIssueId: string,
  stage: string,
  teamId: string
): Promise<void> {
  const targetStatusName = STAGE_TO_STATUS[stage];
  if (!targetStatusName) return;

  // Resolve status ID
  const team = await client.team(teamId);
  const states = await team.states();
  const targetState = states.nodes.find((s) => s.name === targetStatusName);

  if (targetState) {
    await client.updateIssue(linearIssueId, {
      stateId: targetState.id,
    });
  }

  // Apply stage label
  const stageLabelName = STAGE_TO_LABEL[stage];
  if (stageLabelName) {
    const labels = await team.labels();
    const label = labels.nodes.find((l) => l.name === stageLabelName);
    if (label) {
      const issue = await client.issue(linearIssueId);
      const currentLabels = await issue.labels();
      const currentLabelIds = currentLabels.nodes.map((l) => l.id);

      // Remove other workflow: labels, add the current one
      const workflowLabelIds = labels.nodes
        .filter((l) => l.name.startsWith("workflow:"))
        .map((l) => l.id);

      const newLabelIds = [
        ...currentLabelIds.filter((id) => !workflowLabelIds.includes(id)),
        label.id,
      ];

      await client.updateIssue(linearIssueId, { labelIds: newLabelIds });
    }
  }
}

/**
 * Post a workflow transition comment to a Linear issue.
 */
export async function postTransitionComment(
  client: LinearClient,
  linearIssueId: string,
  fromStage: string,
  toStage: string
): Promise<void> {
  await client.createComment({
    issueId: linearIssueId,
    body: `**Workflow:** ${fromStage} → ${toStage}`,
  });
}
