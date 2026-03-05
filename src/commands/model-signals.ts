import { Command } from "commander";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

export type Complexity = "Simple" | "Moderate" | "Complex";

export interface DiffStats {
  files: number;
  insertions: number;
  deletions: number;
}

export interface ModelSignalsResult {
  ticketId: string;
  estimate: number | null;
  labels: string[] | null;
  complexity: Complexity | null;
  diffStats: DiffStats | null;
}

const LEGACY_ESTIMATES: Record<string, number> = {
  S: 1,
  M: 3,
  L: 5,
};

const TICKET_ID_PATTERN = /^[A-Z]+-\d+$/;

/**
 * Parse a Complexity Assessment value from markdown content.
 * Tries two patterns in order:
 *   1. Heading (##/###/#) followed by value on subsequent line(s)
 *   2. Inline bold format: **Complexity Assessment:** Simple
 */
export function parseComplexity(content: string): Complexity | null {
  // Pattern 1: heading followed by value (with optional blank/whitespace lines between)
  const headingMatch = content.match(
    /^#{1,3}\s*Complexity(?:\s+Assessment)?\s*$\n[\s\n]*(Simple|Moderate|Complex)/mi
  );
  if (headingMatch?.[1]) {
    return headingMatch[1] as Complexity;
  }

  // Pattern 2: inline bold
  const boldMatch = content.match(
    /\*\*Complexity(?:\s+Assessment)?:\*\*\s*(Simple|Moderate|Complex)/i
  );
  if (boldMatch?.[1]) {
    return boldMatch[1] as Complexity;
  }

  return null;
}

/**
 * Normalize an estimate value to a number.
 * Handles numeric values, string numbers, and legacy S/M/L strings.
 */
function normalizeEstimate(raw: unknown): number | null {
  if (typeof raw === "number") {
    return raw;
  }
  if (typeof raw === "string") {
    const upper = raw.toUpperCase();
    const legacy = LEGACY_ESTIMATES[upper];
    if (legacy !== undefined) {
      return legacy;
    }
    const parsed = Number(raw);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return null;
}

/**
 * Search ticket-summaries directory for a ticket by ID.
 * Returns { estimate, labels } or nulls if not found.
 */
function findTicketInSummaries(
  ticketId: string,
  summariesDir: string
): { estimate: number | null; labels: string[] | null } {
  const nullResult = { estimate: null, labels: null };

  if (!existsSync(summariesDir)) {
    return nullResult;
  }

  let files: string[];
  try {
    files = readdirSync(summariesDir).filter((f) => f.endsWith(".json"));
  } catch {
    return nullResult;
  }

  for (const file of files) {
    try {
      const raw = readFileSync(join(summariesDir, file), "utf-8");
      const parsed: unknown = JSON.parse(raw);

      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("tickets" in parsed)
      ) {
        continue;
      }

      const obj = parsed as { tickets: unknown };
      if (!Array.isArray(obj.tickets)) {
        continue;
      }

      for (const ticket of obj.tickets) {
        if (
          typeof ticket === "object" &&
          ticket !== null &&
          "id" in ticket &&
          (ticket as { id: unknown }).id === ticketId
        ) {
          const t = ticket as Record<string, unknown>;
          const estimate = normalizeEstimate(t["estimate"]);
          const rawLabels = t["labels"];
          const labels = Array.isArray(rawLabels)
            ? (rawLabels.filter((l): l is string => typeof l === "string"))
            : null;
          return { estimate, labels };
        }
      }
    } catch {
      // Skip malformed JSON files
      continue;
    }
  }

  return nullResult;
}

/**
 * Parse git diff --stat output to extract summary stats.
 */
export function parseDiffStats(output: string): DiffStats | null {
  const trimmed = output.trim();
  if (!trimmed) {
    return null;
  }

  // The summary line is always the last line, e.g.:
  // " 3 files changed, 45 insertions(+), 12 deletions(-)"
  const lines = trimmed.split("\n");
  const lastLine = lines[lines.length - 1];
  if (!lastLine) {
    return null;
  }

  const filesMatch = lastLine.match(/(\d+)\s+files?\s+changed/);
  const insertionsMatch = lastLine.match(/(\d+)\s+insertions?\(\+\)/);
  const deletionsMatch = lastLine.match(/(\d+)\s+deletions?\(-\)/);

  if (!filesMatch) {
    return null;
  }

  return {
    files: Number(filesMatch[1]),
    insertions: insertionsMatch ? Number(insertionsMatch[1]) : 0,
    deletions: deletionsMatch ? Number(deletionsMatch[1]) : 0,
  };
}

/**
 * Extract all model selection signals for a given ticket.
 * Pure function that reads from disk — no Commander dependency.
 */
export function extractSignals(
  ticketId: string,
  opts: {
    summariesDir: string;
    handoffsDir: string;
    includeDiff: boolean;
    repo: string;
  }
): ModelSignalsResult {
  // 1. Ticket summaries: estimate + labels
  const { estimate, labels } = findTicketInSummaries(
    ticketId,
    opts.summariesDir
  );

  // 2. Investigation handoff: complexity
  let complexity: Complexity | null = null;
  const handoffPath = join(opts.handoffsDir, `investigate-${ticketId}.md`);
  if (existsSync(handoffPath)) {
    try {
      const content = readFileSync(handoffPath, "utf-8");
      complexity = parseComplexity(content);
    } catch {
      // File unreadable — leave as null
    }
  }

  // 3. Diff stats (optional)
  let diffStats: DiffStats | null = null;
  if (opts.includeDiff) {
    try {
      const output = execSync("git diff --stat HEAD", {
        cwd: opts.repo,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      diffStats = parseDiffStats(output);
    } catch {
      // Git error or not a repo — leave as null
    }
  }

  return {
    ticketId,
    estimate,
    labels,
    complexity,
    diffStats,
  };
}

export const modelSignalsCommand = new Command("model-signals")
  .description(
    "Extract model selection signals for a ticket (estimate, labels, complexity, diff stats)"
  )
  .argument("<ticket-id>", "Ticket ID (e.g. SUNDAE-2417)")
  .option(
    "--summaries <dir>",
    "Path to ticket-summaries directory",
  )
  .option("--repo <path>", "Repository path", process.cwd())
  .option("--diff", "Include git diff stats in output")
  .action(
    (
      ticketId: string,
      opts: { summaries?: string; repo: string; diff?: boolean }
    ) => {
      if (!TICKET_ID_PATTERN.test(ticketId)) {
        console.error(
          `Error: Invalid ticket ID format: ${ticketId}. Expected format: PREFIX-123`
        );
        process.exit(2);
      }

      const summariesDir =
        opts.summaries ?? join(opts.repo, ".claude", "ticket-summaries");
      const handoffsDir = join(opts.repo, ".claude", "handoffs");

      const result = extractSignals(ticketId, {
        summariesDir,
        handoffsDir,
        includeDiff: opts.diff ?? false,
        repo: opts.repo,
      });

      console.log(JSON.stringify(result));
    }
  );
