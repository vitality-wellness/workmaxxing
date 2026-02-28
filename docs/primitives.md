# Primitives Needed

7 primitives that, composed together, recreate every feature from the old 15-script system.

## 1. Repo Config (`~/.powr/repos.json`)

Per-repo configuration that the hook runner and CLI read.

```json
{
  "/Users/rokindo/Dev/vitality/powr-frontend": {
    "name": "frontend",
    "team": "POWR",
    "productionPaths": ["lib/", "ios/"],
    "analyzeCommand": "dart analyze",
    "restartCommand": "./scripts/run_prod.sh",
    "iterm": true
  },
  "/Users/rokindo/Dev/vitality/powr-api": {
    "name": "api",
    "team": "POWR",
    "productionPaths": ["internal/", "cmd/"],
    "analyzeCommand": "go vet ./...",
    "restartCommand": null,
    "iterm": false
  },
  "/Users/rokindo/Dev/vitality/website": {
    "name": "website",
    "team": "POWR",
    "productionPaths": ["src/"],
    "analyzeCommand": "npm run build",
    "restartCommand": null,
    "iterm": false
  }
}
```

**Enables:** production file gating, repo-appropriate static analysis, dev server restart, team resolution.

---

## 2. Gate Auto-Detection (`gate detect <comment-text>`)

A CLI command that pattern-matches Linear comment text and returns which gate(s) it satisfies.

```bash
powr-workmaxxing gate detect --text "## Investigation Findings\n..."
# → investigation

powr-workmaxxing gate detect --text "## Code Review Findings (CodeRabbit)\n..."
# → findings_crossreferenced

powr-workmaxxing gate detect --text "## Acceptance Criteria Verification\nALL CRITERIA PASSED"
# → acceptance_criteria
```

**Patterns:**

| Comment contains | Gate recorded |
|---|---|
| "Investigation Findings" | `investigation` |
| "Code Review Findings (CodeRabbit)" | `findings_crossreferenced` |
| "Code Review Findings" + "Resolved" | `findings_resolved` |
| "Acceptance Criteria Verification" + "ALL CRITERIA PASSED" | `acceptance_criteria` |
| "no explicit acceptance criteria" | `acceptance_criteria` (auto-pass) |

**Auto-pass rules** baked in:
- If `findings_crossreferenced` detected AND text has no "Must Fix Now" → also auto-pass `findings_resolved`
- If AC verification detected AND text has "no explicit acceptance criteria" → auto-pass `acceptance_criteria`

**Enables:** comment-based gate detection, auto-pass rules. The PostToolUse hook calls this after `create_comment`.

---

## 3. Next-Step Directives (`gate next`)

After recording a gate, output the mandatory next action. Derived from the workflow config — no hardcoding.

```bash
powr-workmaxxing gate next -w <wf-id>
# If investigation just passed:
# → "MANDATORY: Implement the feature, then commit. After commit, run /coderabbit:review."
# If coderabbit_review just passed:
# → "MANDATORY: Cross-reference findings with Linear tickets. List project issues, classify findings, post comment."
```

**Logic:** Look at current stage's required gates. Find the first un-passed gate. Output the directive for that gate.

**Directive templates** (stored in workflow config alongside gate definitions):

```typescript
{
  gateName: "investigation",
  directive: "Implement the feature, then commit. After commit, run /coderabbit:review.",
},
{
  gateName: "coderabbit_review",
  directive: "Cross-reference CodeRabbit findings with Linear tickets. Post a comment classifying each finding as 'Must Fix Now' or 'Covered by Future Tickets'.",
},
// etc.
```

**Enables:** post-gate directives, step-by-step breadcrumbs.

---

## 4. Ticket Validator (`ticket validate <json>`)

Validates ticket creation params against rules. Returns pass/fail with reasons.

```bash
powr-workmaxxing ticket validate --json '{"title":"...","description":"...","parentId":null}'
# → FAIL: Missing fields:
#     - assignee (use "me")
#     - cycle (use "current")
#     - estimate (1-8 points)
#     - description needs 2+ section headings
#     - description needs "## Acceptance Criteria" with checkbox items
```

**Rules:**

| Field | Full Ticket | Sub-Ticket (has parentId) |
|---|---|---|
| assignee | Required | Required |
| cycle | Required | Required |
| project | Required | Optional (inherits) |
| labels | Required (1+) | Required (1+) |
| estimate | Required (>0) | Required (>0) |
| description | 100+ chars, 2+ headings, AC section | Non-empty |

**Enables:** enforce-ticket-fields, enforce-ac-in-description. One primitive replaces two hooks.

---

## 5. Hook Handlers (expand `powr-hook.sh`)

Add handlers to the unified hook runner for the missing features:

```bash
# Production file gating (PreToolUse on Edit|Write)
handle_require_production_gate()
  # Read repo config → get productionPaths
  # Check if edited file matches any production path
  # If yes, check investigation gate in SQLite
  # If not passed, DENY

# Post-commit CodeRabbit trigger (PostToolUse on Bash)
handle_post_commit()
  # Check if command was `git commit`
  # Check if coderabbit_review gate already passed
  # If not, output "MANDATORY: Run /coderabbit:review NOW"

# Comment gate detection (PostToolUse on create_comment)
handle_post_comment()
  # Extract comment body from tool output
  # Run: powr-workmaxxing gate detect --text "<body>"
  # If gate detected, run: powr-workmaxxing gate record <name>
  # Run: powr-workmaxxing gate next (output next directive)

# Ticket validation (PreToolUse on create_issue/update_issue)
handle_validate_ticket()
  # Extract tool_input
  # Run: powr-workmaxxing ticket validate --json '<input>'
  # If fails, DENY with reason

# Merge coordination (PreToolUse on Bash)
handle_merge_coordination()
  # Check if command matches `git merge worktree-*`
  # Compare merge-base with main HEAD
  # If diverged, DENY with rebase instructions

# Context handoff (PreCompact)
handle_context_handoff()
  # Check for active workflow
  # Output: "Post a handoff comment before context compacts"

# Notifications (Stop, Notification)
handle_notification()
  # macOS osascript notification with sound
```

**Enables:** all 14 hook behaviors from the old system, dispatched through one runner.

---

## 6. Repo Lifecycle Commands

Commands for repo-specific operations that the old scripts handled:

```bash
# Dev server restart (called by Stop hook handler)
powr-workmaxxing repo restart
  # Reads restartCommand from repo config
  # Checks if process already running (debounce)
  # Opens in new iTerm tab or Terminal window

# Static analysis (called by /ship skill)
powr-workmaxxing repo analyze
  # Reads analyzeCommand from repo config
  # Runs and returns pass/fail
```

**Enables:** restart-prod.sh, /ship static analysis.

---

## 7. Workflow Introspection (`status --verbose`)

Rich status output that replaces the detect-ticket-work.sh state injection:

```bash
powr-workmaxxing status --verbose -w <wf-id>
# Workflow: "auth overhaul"
# Stage: EXECUTING (ticket POWR-500 in IMPLEMENTING)
#
# Gates for current ticket:
#   ✅ investigation
#   ⬜ code_committed      ← YOU ARE HERE
#   ⬜ coderabbit_review
#   ⬜ findings_crossreferenced
#   ⬜ findings_resolved
#   ⬜ acceptance_criteria
#
# Next: Commit your code, then run /coderabbit:review
#
# Other workflows in this repo:
#   "weight trends" (SPECCING) — STALE (3h ago)
#   "meal planning" (PLANNING)
```

The UserPromptSubmit hook calls `powr-workmaxxing status --verbose` and injects the output as context.

**Enables:** stale workflow soft messages, multi-workflow awareness, next-step injection, "where am I" on every prompt.

---

## Composition Map

How the 7 primitives compose to recreate every old feature:

| Old Feature | Primitives Used |
|---|---|
| Production file gating | Repo Config + Hook Handler (require_production_gate) |
| Comment-based gate detection | Gate Auto-Detection + Hook Handler (post_comment) |
| CodeRabbit auto-trigger | Hook Handler (post_commit) |
| Post-gate directives | Next-Step Directives |
| Ticket field validation | Ticket Validator + Hook Handler (validate_ticket) |
| AC-in-description | Ticket Validator (AC rule) |
| Worktree merge enforcement | Hook Handler (merge_coordination) |
| Context exhaustion handoff | Hook Handler (context_handoff) |
| macOS notifications | Hook Handler (notification) |
| Auto-pass rules | Gate Auto-Detection (baked-in rules) |
| NO_TICKET cleared on In Progress | Hook Handler (post_comment detects state change) |
| Sub-ticket relaxed validation | Ticket Validator (parentId rule) |
| Dev server auto-restart | Repo Lifecycle (restart) |
| Stale workflow soft message | Workflow Introspection (status --verbose) |

**Zero orphan features.** Every behavior from the old system maps to exactly one composition of primitives.
