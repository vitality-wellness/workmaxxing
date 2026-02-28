# powr-workmaxxing

Your dev workflow in 4 words.

```
/spec → /plan → /execute → /ship
```

That's it. Say the word, Claude handles the rest.

---

## Setup

```bash
git clone <repo-url> ~/.powr/src
cd ~/.powr/src && npm install && npm run build && npm link
powr-workmaxxing setup
```

Then in any repo you want to use it:

```bash
cd ~/my-project
powr-workmaxxing install
```

---

## How it works

### `/powr:spec` — "What are we building?"

Claude asks you what problem you're solving, who it's for, what success looks like, what's in scope and out of scope. Explores the codebase to understand what existing code it touches. Writes a spec doc and saves it.

### `/powr:plan` — "How are we building it?"

Claude reads the spec, explores the codebase, and writes a step-by-step implementation plan. Before you see it, it goes through a 5-section review with you:

1. **Architecture** — are the component boundaries right?
2. **Code quality** — DRY violations, missing error handling, edge cases?
3. **Tests** — what's not covered?
4. **Performance** — N+1 queries, memory issues, caching opportunities?
5. **Ticket decomposition** — do the steps break into clean tickets?

For each issue found, you pick from options. After all 5 sections pass, the plan gets decomposed into Linear tickets with dependencies, estimates, labels, and acceptance criteria.

### `/powr:execute` — "Build it."

```
/powr:execute POWR-500              ← one ticket
/powr:execute cycle "Sprint 12"     ← all tickets in cycle
/powr:execute project "MVP Launch"  ← all tickets in project
/powr:execute                       ← next unblocked ticket
```

**Single ticket:** Claude reads the ticket, investigates the codebase, implements, commits, runs CodeRabbit review, cross-references findings with existing tickets, fixes issues, verifies acceptance criteria, and marks it done. Six quality gates — can't skip any.

**Batch:** Claude builds a dependency graph, groups independent tickets into waves, and runs each wave in parallel worktrees. Wave 1 finishes, merges to main, wave 2 starts. You approve each wave before it launches.

### `/powr:ship` — "We're done."

Claude verifies all tickets are done, runs static analysis (`dart analyze`, `go vet`, or `npm run build` depending on the repo), checks everything is committed, and closes out the workflow with a summary.

---

## Parallel terminals

Open 9 terminals. Each gets its own isolated workflow. They don't interfere.

---

## Escape hatches

```bash
powr-workmaxxing bypass           # skip the workflow, just code
powr-workmaxxing status           # where am I?
powr-workmaxxing audit log        # what happened?
powr-workmaxxing session cleanup  # something stuck?
```

---

# Deep Dive

Everything below is how the system works. You don't need it to use the slash commands.

---

## Setup details

`powr-workmaxxing install` does two things in your repo:

1. Symlinks `.claude/hooks/powr-hook.sh` — the unified hook runner
2. Symlinks `.claude/skills/powr-*/` — the 4 workflow skills

You also need to add hooks to your `.claude/settings.local.json`. This tells Claude Code which events to route to the hook runner:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/powr-hook.sh detect-work" }] }
    ],
    "PreToolUse": [
      { "matcher": "Edit|Write", "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/powr-hook.sh require-ticket" }] },
      { "matcher": "ExitPlanMode", "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/powr-hook.sh review-plan" }] },
      { "matcher": "mcp__plugin_linear_linear__update_issue", "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/powr-hook.sh enforce-gates" }] },
      { "matcher": "mcp__plugin_linear_linear__create_issue|mcp__plugin_linear_linear__update_issue", "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/powr-hook.sh validate-ticket" }] },
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/powr-hook.sh merge-coordination" }] }
    ],
    "PostToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/powr-hook.sh post-commit" }] },
      { "matcher": "mcp__plugin_linear_linear__create_comment", "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/powr-hook.sh post-comment" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/powr-hook.sh notification stop" }] },
      { "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/powr-hook.sh lifecycle" }] }
    ],
    "Notification": [
      { "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/powr-hook.sh notification attention" }] }
    ],
    "PreCompact": [
      { "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/powr-hook.sh context-handoff" }] }
    ]
  }
}
```

All 11 hooks route through one file (`powr-hook.sh`) with different handler arguments.

---

## Quality gates

Every ticket goes through 6 mandatory gates. Hooks enforce them — you can't skip steps.

```
INVESTIGATE → IMPLEMENT → CODE REVIEW → CROSS-REF → FIX → VERIFY ACs → DONE
```

| Gate | What happens | How it's enforced |
|---|---|---|
| **Investigation** | Explore codebase, answer 5 questions, post findings | Edit/Write on production files blocked until posted |
| **Code committed** | Write code, commit | CodeRabbit auto-triggered after every `git commit` |
| **CodeRabbit review** | Automated code review | Post-commit hook repeats until satisfied |
| **Cross-reference** | Classify findings vs existing tickets | Comment auto-records gate |
| **Fix findings** | Address "Must Fix Now" items | Auto-passes if none exist |
| **Acceptance criteria** | Verify each AC passes | Auto-passes if ticket has no explicit ACs |

### Auto-detection

Gates record automatically from Linear comment headings:

| Comment contains | Gate |
|---|---|
| "Investigation Findings" | `investigation` |
| "Code Review Findings (CodeRabbit)" | `findings_crossreferenced` |
| "Code Review Findings" + "Resolved" | `findings_resolved` |
| "Acceptance Criteria Verification" + "ALL CRITERIA PASSED" | `acceptance_criteria` |

### Auto-pass rules

- No "Must Fix Now" items → `findings_resolved` auto-passes
- No explicit ACs in description → `acceptance_criteria` auto-passes

---

## Ticket validation

Every ticket is validated before creation:

**Full tickets:** title, assignee, cycle, project, labels (1+), estimate (>0), description (100+ chars, 2+ headings, AC section with checkboxes)

**Sub-tickets:** project optional, description just needs to be non-empty

---

## Production file gating

Only production code is gated:

| Repo | Gated paths | Static analysis |
|---|---|---|
| powr-frontend | `lib/`, `ios/` | `dart analyze` |
| powr-api | `internal/`, `cmd/` | `go vet ./...` |
| website | `src/` | `npm run build` |

Config files, tests, docs — no gate. Configured in `~/.powr/repos.json`.

---

## Plan review

ExitPlanMode triggers a 5-section interactive review:

1. **Architecture** — boundaries, coupling, data flow, security
2. **Code Quality** — DRY, error handling, edge cases
3. **Tests** — coverage gaps, failure modes
4. **Performance** — N+1, memory, caching
5. **Ticket Decomposition** — boundaries, dependencies, AC clarity

Each issue gets numbered options (recommended first). All 5 sections must be approved before ticket creation.

---

## Wave-based parallel execution

Batches run in dependency waves:

1. Build dependency DAG from ticket relations
2. Group independent tickets into waves
3. Launch each wave as parallel worktree agents
4. Merge worktrees into main between waves (rebase + fast-forward)
5. Run static analysis after merge
6. Next wave

Merge hook blocks `git merge worktree-*` if the branch has diverged — must rebase first.

---

## Context exhaustion

If context fills up mid-workflow:

1. PreCompact hook reminds Claude to post a handoff comment
2. Handoff includes: current step, completed work, remaining steps, key decisions
3. Next session reads state from SQLite — no transcript dependency

---

## Notifications

macOS desktop notifications (skipped silently on other platforms):
- **Task complete** — Glass sound
- **Attention needed** — Bottle sound

---

## Stale detection

Workflows untouched for 2+ hours get a soft warning instead of blocking:

```
STALE WORKFLOW: "auth overhaul" (EXECUTING) — last activity 3h ago.
```

---

## Architecture

```
You ←→ Claude Code
         ├── Skills (/powr:spec, /powr:plan, /powr:execute, /powr:ship)
         │     ├── Bash(powr-workmaxxing <command>)  — state
         │     └── Linear MCP                        — tickets
         └── Hooks (powr-hook.sh, 11 handlers)
               └── sqlite3 ~/.powr/workflow.db       — <50ms queries
```

### State machine

```
Feature:  SPECCING → PLANNING → REVIEWING → TICKETING → EXECUTING → SHIPPING → IDLE
Ticket:   QUEUED → INVESTIGATING → IMPLEMENTING → CODE_REVIEWING → CROSS_REFING → FIXING → VERIFYING_ACS → DONE
```

Declarative config. Gates have Zod-typed evidence. Transitions validated — can't skip or go backwards.

### SQLite (`~/.powr/workflow.db`)

| Table | Purpose |
|---|---|
| `workflows` | Feature workflows (stage, repo, name) |
| `ticket_workflows` | Per-ticket sub-workflows |
| `gates` | Passed gates with evidence (JSON) |
| `sessions` | Claude sessions, bypass tracking |
| `audit_log` | Every state change |

WAL mode. 5s busy timeout for concurrent writers.

### Hook handlers

| Handler | Event | What it does |
|---|---|---|
| `require-ticket` | PreToolUse Edit\|Write | Block production edits without investigation |
| `detect-work` | UserPromptSubmit | Inject status + next directive |
| `lifecycle` | Stop | Block premature stop |
| `review-plan` | PreToolUse ExitPlanMode | Force plan review |
| `enforce-gates` | PreToolUse update_issue | Block Done without all gates |
| `post-commit` | PostToolUse Bash | Trigger CodeRabbit after commit |
| `post-comment` | PostToolUse create_comment | Auto-detect gates from comments |
| `validate-ticket` | PreToolUse create_issue | Validate fields + ACs |
| `merge-coordination` | PreToolUse Bash | Enforce rebase-before-merge |
| `context-handoff` | PreCompact | Remind to post handoff |
| `notification` | Stop/Notification | macOS notifications |

### Workflow isolation

Each workflow has a UUID. Claude passes `-w <id>` internally. Multiple workflows per repo, zero overlap.

Manual CLI usage: `export POWR_WF=<id>`.

---

## CLI reference

```
powr-workmaxxing
  setup                               First-time initialization
  install [repo]                      Add to a repo (default: cwd)
  install --all                       Add to all known repos

  status [-w <id>] [--json]           Where am I?
  start <name>                        Begin new workflow
  advance [-w <id>]                   Advance stage (gate-checked)
  bypass                              Skip enforcement

  gate record <name> [--evidence]     Record a gate
  gate check <name>                   Check gate (exit code)
  gate list [--json]                  Gates for current stage
  gate detect --text "..."            Auto-detect from comment
  gate next                           Next mandatory action

  session start                       Register session
  session cleanup                     Clean stale sessions
  session info                        Session details

  tickets preview <plan.md> [--json]  Preview tickets from plan
  tickets validate --json '{...}'     Validate ticket fields

  repo analyze                        Run static analysis
  repo info                           Show repo config

  audit log [--limit N]               Recent events
```
