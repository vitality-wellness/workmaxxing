import { z } from "zod";
import { getWorkflowConfig, type StageConfig } from "./workflow-config.js";

/**
 * Pure state machine logic — no side effects, fully testable.
 */

// --- Gate evidence schemas ---

/** Human-readable evidence examples for each gate. Used in error messages and `gate schema`. */
export const GATE_EVIDENCE_EXAMPLES: Record<string, string> = {
  spec_document_written: '{"documentId": "linear-doc-uuid"} or {"path": ".claude/specs/feature.md"}',
  plan_written: '{"documentId": "linear-doc-uuid"} or {"path": ".claude/plans/feature.md"}',
  review_architecture: '{"approved": true}',
  review_code_quality: '{"approved": true}',
  review_tests: '{"approved": true}',
  review_performance: '{"approved": true}',
  review_ticket_decomposition: '{"approved": true}',
  tickets_created: '{"ticketIds": ["PROJ-123"]}',
  all_tickets_done: '{"ticketCount": 1}',
  ship_verified: '{"verified": true}',
  ticket_in_progress: '{"linearIssueId": "PROJ-123"}',
  investigation: '{"commentUrl": "optional"}',
  code_committed: '{"commitSha": "abc1234"}',
  coderabbit_review: '{"reviewUrl": "optional"}',
};

/** Evidence schemas for each gate. Gates not listed here accept any evidence. */
const GATE_EVIDENCE_SCHEMAS: Record<string, z.ZodType> = {
  spec_document_written: z.union([
    z.object({ documentId: z.string() }),
    z.object({ path: z.string() }),
  ]),
  plan_written: z.union([
    z.object({ documentId: z.string() }),
    z.object({ path: z.string() }),
  ]),
  review_architecture: z.object({ approved: z.boolean() }),
  review_code_quality: z.object({ approved: z.boolean() }),
  review_tests: z.object({ approved: z.boolean() }),
  review_performance: z.object({ approved: z.boolean() }),
  review_ticket_decomposition: z.object({ approved: z.boolean() }),
  tickets_created: z.object({ ticketIds: z.array(z.string()) }),
  all_tickets_done: z.object({ ticketCount: z.number() }),
  ship_verified: z.object({ verified: z.boolean() }),
  ticket_in_progress: z.object({ linearIssueId: z.string() }),
  investigation: z.object({ commentUrl: z.string().optional() }).passthrough(),
  code_committed: z.object({ commitSha: z.string() }).passthrough(),
  coderabbit_review: z
    .object({ reviewUrl: z.string().optional() })
    .passthrough(),
};

export interface TransitionResult {
  valid: boolean;
  from: string;
  to: string;
  error?: string;
}

export interface GateValidationResult {
  valid: boolean;
  gate: string;
  error?: string;
}

/**
 * Validate that a stage transition is allowed.
 * Only allows moving to the declared nextStage (no skipping, no going back).
 */
export function validateTransition(
  stages: Record<string, StageConfig>,
  currentStage: string,
  targetStage: string
): TransitionResult {
  const config = stages[currentStage];
  if (!config) {
    return {
      valid: false,
      from: currentStage,
      to: targetStage,
      error: `Unknown current stage: "${currentStage}"`,
    };
  }

  if (!stages[targetStage]) {
    return {
      valid: false,
      from: currentStage,
      to: targetStage,
      error: `Unknown target stage: "${targetStage}"`,
    };
  }

  if (config.nextStage === null) {
    return {
      valid: false,
      from: currentStage,
      to: targetStage,
      error: `Stage "${currentStage}" is terminal — cannot advance`,
    };
  }

  if (config.nextStage !== targetStage) {
    return {
      valid: false,
      from: currentStage,
      to: targetStage,
      error: `Cannot transition ${currentStage} → ${targetStage}. Next stage must be "${config.nextStage}"`,
    };
  }

  return { valid: true, from: currentStage, to: targetStage };
}

/**
 * Check if all required gates for a stage are satisfied.
 * Returns the list of missing gate names.
 */
export function checkGates(
  stages: Record<string, StageConfig>,
  stageName: string,
  passedGates: Set<string>
): string[] {
  const config = stages[stageName];
  if (!config) return [];
  return config.requiredGates.filter((g) => !passedGates.has(g));
}

/**
 * Validate gate evidence against its schema (if one exists).
 */
export function validateGateEvidence(
  gateName: string,
  evidence: Record<string, unknown>
): GateValidationResult {
  const schema = GATE_EVIDENCE_SCHEMAS[gateName];
  if (!schema) {
    // No schema defined — accept any evidence
    return { valid: true, gate: gateName };
  }

  const result = schema.safeParse(evidence);
  if (!result.success) {
    const example = GATE_EVIDENCE_EXAMPLES[gateName];
    const hint = example ? ` Expected format: ${example}` : "";
    return {
      valid: false,
      gate: gateName,
      error: `Invalid evidence for gate "${gateName}": ${result.error.issues.map((i) => i.message).join(", ")}.${hint}`,
    };
  }

  return { valid: true, gate: gateName };
}

/**
 * Get the full valid transition chain for a workflow type.
 * e.g., ["SPECCING", "PLANNING", "REVIEWING", ...]
 */
export function getTransitionChain(
  stages: Record<string, StageConfig>,
  startStage: string
): string[] {
  const chain: string[] = [startStage];
  let current = startStage;

  while (true) {
    const config = stages[current];
    if (!config || config.nextStage === null) break;
    chain.push(config.nextStage);
    current = config.nextStage;
  }

  return chain;
}

/**
 * Validate that the entire workflow config is internally consistent.
 * Useful for catching config errors at startup.
 */
export function validateConfig(): string[] {
  const errors: string[] = [];
  const config = getWorkflowConfig();

  for (const [name, stage] of Object.entries(config.stages)) {
    if (stage.nextStage !== null && !config.stages[stage.nextStage]) {
      errors.push(
        `Feature stage "${name}" references unknown nextStage "${stage.nextStage}"`
      );
    }
  }

  for (const [name, stage] of Object.entries(config.ticketStages)) {
    if (stage.nextStage !== null && !config.ticketStages[stage.nextStage]) {
      errors.push(
        `Ticket stage "${name}" references unknown nextStage "${stage.nextStage}"`
      );
    }
  }

  // Check for unreachable stages
  const featureChain = new Set(getTransitionChain(config.stages, "SPECCING"));
  featureChain.add("IDLE"); // IDLE is the terminal + reset state
  for (const name of Object.keys(config.stages)) {
    if (!featureChain.has(name)) {
      errors.push(`Feature stage "${name}" is unreachable from SPECCING`);
    }
  }

  const ticketChain = new Set(
    getTransitionChain(config.ticketStages, "QUEUED")
  );
  for (const name of Object.keys(config.ticketStages)) {
    if (!ticketChain.has(name)) {
      errors.push(`Ticket stage "${name}" is unreachable from QUEUED`);
    }
  }

  return errors;
}
