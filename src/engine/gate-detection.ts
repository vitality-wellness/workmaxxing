/**
 * Primitive 2: Gate auto-detection from Linear comment text.
 * Pattern-matches comment content to determine which gate(s) it satisfies.
 */

export interface DetectedGate {
  gate: string;
  confidence: "exact" | "inferred";
}

interface DetectionRule {
  gate: string;
  /** All patterns must match (AND logic) */
  patterns: RegExp[];
  /** If these also match, auto-pass these additional gates */
  autoPass?: Array<{ gate: string; unless: RegExp }>;
}

const DETECTION_RULES: DetectionRule[] = [
  {
    gate: "investigation",
    // Match "## Investigation", "Investigation Findings", etc.
    patterns: [/##\s*investigation|investigation\s+findings/i],
  },
];

/**
 * Detect which gates a comment text satisfies.
 * Returns all matched gates (may include auto-passed gates).
 */
export function detectGatesFromComment(text: string): DetectedGate[] {
  const detected: DetectedGate[] = [];
  const seen = new Set<string>();

  for (const rule of DETECTION_RULES) {
    const allMatch = rule.patterns.every((p) => p.test(text));
    if (!allMatch) continue;

    if (!seen.has(rule.gate)) {
      detected.push({ gate: rule.gate, confidence: "exact" });
      seen.add(rule.gate);
    }

    // Check auto-pass rules
    if (rule.autoPass) {
      for (const ap of rule.autoPass) {
        if (!ap.unless.test(text) && !seen.has(ap.gate)) {
          detected.push({ gate: ap.gate, confidence: "inferred" });
          seen.add(ap.gate);
        }
      }
    }
  }

  return detected;
}
