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
    requiredGates: ["ticket_in_progress"],
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
    description: "Running CodeRabbit review, then handing off to human",
    requiredGates: ["coderabbit_review"],
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

/** Get the ordered ticket stage chain (QUEUED → ... → DONE) */
export function getTicketStageOrder(): string[] {
  const order: string[] = ["QUEUED"];
  let current = "QUEUED";
  while (TICKET_STAGES[current]?.nextStage) {
    current = TICKET_STAGES[current]!.nextStage!;
    order.push(current);
  }
  return order;
}

/**
 * Derive the gate→nextStage mapping from TICKET_STAGES config.
 * Each ticket stage has exactly one required gate; recording that gate
 * should advance the ticket to the stage's nextStage.
 */
export function deriveGateNextStage(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [, stageConfig] of Object.entries(TICKET_STAGES)) {
    if (stageConfig.nextStage) {
      for (const gate of stageConfig.requiredGates) {
        map[gate] = stageConfig.nextStage;
      }
    }
  }
  return map;
}

/** All ticket-scoped gate names in order */
export function getTicketGateNames(): string[] {
  const order = getTicketStageOrder();
  const gates: string[] = [];
  for (const stage of order) {
    const config = TICKET_STAGES[stage];
    if (config) {
      gates.push(...config.requiredGates);
    }
  }
  return gates;
}
