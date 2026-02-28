import { z } from "zod";

// --- Schema ---

export const PlanStepSchema = z.object({
  /** Step number (1-based) */
  number: z.number(),
  /** Step title */
  title: z.string(),
  /** Full description text */
  description: z.string(),
  /** Nested sub-steps */
  substeps: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
    })
  ),
  /** Step numbers this depends on (e.g., [1, 2]) */
  dependencies: z.array(z.number()),
  /** Inferred repo from file paths (frontend, api, website, or null) */
  repo: z.string().nullable(),
  /** Estimated effort: "small" | "medium" | "large" based on substep count + description length */
  estimatedEffort: z.enum(["small", "medium", "large"]),
  /** Extracted acceptance criteria (checkbox items) */
  acceptanceCriteria: z.array(z.string()),
});

export type PlanStep = z.infer<typeof PlanStepSchema>;

export interface ParsedPlan {
  title: string;
  steps: PlanStep[];
  rawText: string;
}

// --- Repo detection ---

const REPO_PATTERNS: Array<{ pattern: RegExp; repo: string }> = [
  { pattern: /\blib\/|\.dart\b|flutter|pubspec/i, repo: "frontend" },
  { pattern: /\bios\/Runner\/|\.swift\b|SwiftUI/i, repo: "frontend" },
  { pattern: /\bcmd\/|internal\/|\.go\b|go\.mod/i, repo: "api" },
  { pattern: /\bsrc\/pages|astro|\.astro\b|website/i, repo: "website" },
];

function inferRepo(text: string): string | null {
  for (const { pattern, repo } of REPO_PATTERNS) {
    if (pattern.test(text)) return repo;
  }
  return null;
}

// --- Effort estimation ---

function estimateEffort(
  description: string,
  substepCount: number
): "small" | "medium" | "large" {
  const totalLength = description.length;
  if (substepCount >= 4 || totalLength > 500) return "large";
  if (substepCount >= 2 || totalLength > 200) return "medium";
  return "small";
}

// --- Dependency extraction ---

const DEP_PATTERNS = [
  /(?:after|depends on|blocked by|requires)\s+step\s+(\d+)/gi,
  /(?:after|depends on|blocked by|requires)\s+#(\d+)/gi,
  /\bstep\s+(\d+)\s+(?:must|should|needs to)\s+(?:be\s+)?(?:done|complete|finished)/gi,
];

function extractDependencies(text: string): number[] {
  const deps = new Set<number>();
  for (const pattern of DEP_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const num = parseInt(match[1]!, 10);
      if (!isNaN(num)) deps.add(num);
    }
  }
  return [...deps].sort();
}

// --- Acceptance criteria extraction ---

function extractAcceptanceCriteria(text: string): string[] {
  const criteria: string[] = [];
  const lines = text.split("\n");
  for (const line of lines) {
    // Match checkbox items: - [ ] or - [x] or * [ ]
    const match = line.match(/^\s*[-*]\s*\[[ x]?\]\s*(.+)/i);
    if (match?.[1]) {
      criteria.push(match[1].trim());
    }
  }
  return criteria;
}

// --- Main parser ---

/**
 * Parse a markdown plan into structured PlanSteps.
 *
 * Supports these formats:
 * - Numbered headers: `## 1. Step title` or `### Step 1: Title`
 * - Numbered list items: `1. Step title`
 * - H2/H3 sections treated as steps when numbered
 *
 * Sub-steps are detected as nested list items or sub-headers.
 */
export function parsePlan(markdown: string): ParsedPlan {
  const lines = markdown.split("\n");
  const steps: PlanStep[] = [];

  // Extract plan title from first H1
  let title = "Untitled Plan";
  for (const line of lines) {
    const h1Match = line.match(/^#\s+(.+)/);
    if (h1Match?.[1]) {
      title = h1Match[1].trim();
      break;
    }
  }

  // Strategy: find numbered steps via headers or numbered lists
  const stepBlocks = splitIntoStepBlocks(lines);

  for (const block of stepBlocks) {
    const fullText = block.bodyLines.join("\n");
    const substeps = extractSubsteps(block.bodyLines);
    const acceptanceCriteria = extractAcceptanceCriteria(fullText);

    steps.push({
      number: block.number,
      title: block.title,
      description: fullText.trim(),
      substeps,
      dependencies: extractDependencies(fullText),
      repo: inferRepo(fullText) ?? inferRepo(block.title),
      estimatedEffort: estimateEffort(fullText, substeps.length),
      acceptanceCriteria,
    });
  }

  if (steps.length === 0) {
    // Fallback: treat the entire plan as a single step
    const fullText = markdown;
    steps.push({
      number: 1,
      title,
      description: fullText.trim(),
      substeps: [],
      dependencies: [],
      repo: inferRepo(fullText),
      estimatedEffort: estimateEffort(fullText, 0),
      acceptanceCriteria: extractAcceptanceCriteria(fullText),
    });
  }

  return { title, steps, rawText: markdown };
}

interface StepBlock {
  number: number;
  title: string;
  bodyLines: string[];
}

function splitIntoStepBlocks(lines: string[]): StepBlock[] {
  const blocks: StepBlock[] = [];
  let current: StepBlock | null = null;

  for (const line of lines) {
    // Match numbered headers: ## 1. Title, ### Step 1: Title, ## Step 1 — Title
    const headerMatch = line.match(
      /^#{2,3}\s+(?:Step\s+)?(\d+)[.:)\-—]\s*(.+)/i
    );
    if (headerMatch) {
      if (current) blocks.push(current);
      current = {
        number: parseInt(headerMatch[1]!, 10),
        title: headerMatch[2]!.trim(),
        bodyLines: [],
      };
      continue;
    }

    // Match top-level numbered list: 1. Title (only at start or after blank line)
    const listMatch = line.match(/^(\d+)\.\s+\*?\*?(.+?)\*?\*?\s*$/);
    if (listMatch && !current) {
      if (current) blocks.push(current);
      current = {
        number: parseInt(listMatch[1]!, 10),
        title: listMatch[2]!.trim(),
        bodyLines: [],
      };
      continue;
    }

    if (current) {
      // New top-level numbered item starts a new block
      const newItemMatch = line.match(/^(\d+)\.\s+\*?\*?(.+?)\*?\*?\s*$/);
      if (
        newItemMatch &&
        parseInt(newItemMatch[1]!, 10) === current.number + 1
      ) {
        blocks.push(current);
        current = {
          number: parseInt(newItemMatch[1]!, 10),
          title: newItemMatch[2]!.trim(),
          bodyLines: [],
        };
        continue;
      }

      current.bodyLines.push(line);
    }
  }

  if (current) blocks.push(current);
  return blocks;
}

function extractSubsteps(
  bodyLines: string[]
): Array<{ title: string; description: string }> {
  const substeps: Array<{ title: string; description: string }> = [];

  for (const line of bodyLines) {
    // Match nested list items: "  - Sub-step title" or "  * Sub-step"
    const match = line.match(/^\s{2,}[-*]\s+(.+)/);
    if (match?.[1]) {
      // Skip checkbox items (those are acceptance criteria)
      if (/^\[[ x]?\]/.test(match[1])) continue;
      substeps.push({
        title: match[1].trim(),
        description: "",
      });
    }
  }

  return substeps;
}
