/**
 * Declarative workflow stage configuration.
 *
 * Adding a new stage = adding a new entry here. No code changes needed elsewhere.
 */

export interface StageConfig {
  /** Human-readable description */
  description: string;
  /** Gates that must pass before advancing to nextStage */
  requiredGates: string[];
  /** The stage to transition to (null = terminal) */
  nextStage: string | null;
}

export interface WorkflowConfig {
  /** Feature-level workflow stages */
  stages: Record<string, StageConfig>;
  /** Per-ticket sub-workflow stages */
  ticketStages: Record<string, StageConfig>;
}

const FEATURE_STAGES: Record<string, StageConfig> = {
  SPECCING: {
    description: "Gathering requirements and writing spec document",
    requiredGates: ["spec_document_written"],
    nextStage: "PLANNING",
  },
  PLANNING: {
    description: "Creating implementation plan",
    requiredGates: ["plan_written"],
    nextStage: "REVIEWING",
  },
  REVIEWING: {
    description: "Interactive plan review (architecture, quality, tests, perf, tickets)",
    requiredGates: [
      "review_architecture",
      "review_code_quality",
      "review_tests",
      "review_performance",
      "review_ticket_decomposition",
    ],
    nextStage: "TICKETING",
  },
  TICKETING: {
    description: "Decomposing plan into Linear tickets",
    requiredGates: ["tickets_created"],
    nextStage: "EXECUTING",
  },
  EXECUTING: {
    description: "Working through tickets",
    requiredGates: ["all_tickets_done"],
    nextStage: "SHIPPING",
  },
  SHIPPING: {
    description: "Final verification and cleanup",
    requiredGates: ["ship_verified"],
    nextStage: "IDLE",
  },
  IDLE: {
    description: "No active workflow",
    requiredGates: [],
    nextStage: null,
  },
};

const TICKET_STAGES: Record<string, StageConfig> = {
  QUEUED: {
    description: "Waiting to be started",
    requiredGates: [],
    nextStage: "INVESTIGATING",
  },
  INVESTIGATING: {
    description: "Exploring codebase, answering 5 investigation questions",
    requiredGates: ["investigation"],
    nextStage: "IMPLEMENTING",
  },
  IMPLEMENTING: {
    description: "Writing code and committing changes",
    requiredGates: ["code_committed"],
    nextStage: "CODE_REVIEWING",
  },
  CODE_REVIEWING: {
    description: "Running CodeRabbit review",
    requiredGates: ["coderabbit_review"],
    nextStage: "CROSS_REFING",
  },
  CROSS_REFING: {
    description: "Cross-referencing findings with existing Linear tickets",
    requiredGates: ["findings_crossreferenced"],
    nextStage: "FIXING",
  },
  FIXING: {
    description: "Fixing 'Must Fix Now' items from review",
    requiredGates: ["findings_resolved"],
    nextStage: "VERIFYING_ACS",
  },
  VERIFYING_ACS: {
    description: "Verifying acceptance criteria",
    requiredGates: ["acceptance_criteria"],
    nextStage: "DONE",
  },
  DONE: {
    description: "Ticket complete",
    requiredGates: [],
    nextStage: null,
  },
};

let cachedConfig: WorkflowConfig | null = null;

export function getWorkflowConfig(): WorkflowConfig {
  if (!cachedConfig) {
    cachedConfig = {
      stages: FEATURE_STAGES,
      ticketStages: TICKET_STAGES,
    };
  }
  return cachedConfig;
}

/** Get all valid stage names for the feature workflow */
export function getFeatureStageNames(): string[] {
  return Object.keys(FEATURE_STAGES);
}

/** Get all valid stage names for the ticket sub-workflow */
export function getTicketStageNames(): string[] {
  return Object.keys(TICKET_STAGES);
}
