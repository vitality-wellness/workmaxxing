/**
 * Primitive 4: Ticket field validation.
 * Validates Linear ticket creation params against quality rules.
 */

export interface TicketInput {
  title?: string;
  description?: string;
  assignee?: string | null;
  cycle?: string;
  project?: string;
  labels?: string[];
  estimate?: number;
  parentId?: string | null;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate ticket creation params.
 * Sub-tickets (parentId present) have relaxed requirements.
 */
export function validateTicket(input: TicketInput): ValidationResult {
  const errors: string[] = [];
  const isSubTicket = !!input.parentId;

  // Title always required
  if (!input.title?.trim()) {
    errors.push("title: Required");
  }

  // Assignee always required
  if (!input.assignee) {
    errors.push('assignee: Required (use "me" for self-assignment)');
  }

  // Cycle always required
  if (!input.cycle) {
    errors.push('cycle: Required (use "current" for active cycle)');
  }

  // Project: required for full tickets, optional for sub-tickets
  if (!isSubTicket && !input.project) {
    errors.push("project: Required for top-level tickets");
  }

  // Labels: at least 1
  if (!input.labels || input.labels.length === 0) {
    errors.push("labels: At least 1 label required");
  }

  // Estimate: required and > 0
  if (input.estimate === undefined || input.estimate === null || input.estimate <= 0) {
    errors.push(
      "estimate: Required (>0). Scale: 1=trivial, 2=small, 3=medium, 5=large, 8=very large"
    );
  }

  // Description quality
  if (isSubTicket) {
    // Sub-tickets: just need non-empty description
    if (!input.description?.trim()) {
      errors.push("description: Required (can be brief for sub-tickets)");
    }
  } else {
    // Full tickets: 100+ chars, 2+ headings, AC section
    const desc = input.description ?? "";

    if (desc.length < 100) {
      errors.push(
        `description: Too short (${desc.length} chars, need 100+)`
      );
    }

    const headingCount = (desc.match(/^#{2,}\s/gm) ?? []).length;
    if (headingCount < 2) {
      errors.push(
        `description: Needs more structure (${headingCount} headings, need 2+)`
      );
    }

    // Acceptance criteria check
    const hasACHeading = /#{1,}\s*acceptance\s+criteria/i.test(desc);
    const checkboxCount = (desc.match(/- \[ \]/g) ?? []).length;

    if (!hasACHeading) {
      errors.push(
        'description: Missing "## Acceptance Criteria" heading'
      );
    }
    if (checkboxCount < 1) {
      errors.push(
        'description: Missing checkbox items (need at least one "- [ ] ...")'
      );
    }
  }

  return { valid: errors.length === 0, errors };
}
