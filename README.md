# powr-workmaxxing

Your dev workflow in 4 words.

```
/powr spec → /powr plan → /powr execute → /powr ship
```

That's it. Say the word, Claude handles the rest.

---

## Prerequisites

**Required:**
- [Claude Code](https://claude.com/claude-code) — the CLI
- [Linear MCP plugin](https://linear.app) — ticket creation, status updates, comments. The entire workflow runs through Linear.
- Node.js 20+

**Recommended:**
- [CodeRabbit](https://coderabbit.ai) Claude Code plugin — automated code review. If not installed, Claude does a self-review instead (less thorough but still enforced as a gate).

---

## Setup

```bash
git clone <repo-url> ~/.powr/src
cd ~/.powr/src && npm install && npm run build && npm link
powr-workmaxxing setup
```

Then in any repo:

```bash
cd ~/my-project
powr-workmaxxing install
```

---

## Commands

Everything goes through `/powr`:

```
/powr spec <description>              Start here — define what to build
/powr plan                            Plan how to build it, create tickets
/powr execute [target]                Build it
/powr execute POWR-500                Build one ticket
/powr execute cycle "Sprint 12"       Build all tickets in a cycle
/powr execute project "MVP Launch"    Build all tickets in a project
/powr ship                            Verify and close out
/powr status                          Where am I?
/powr bypass                          Skip enforcement, just code
```

---

## What each command does

### `/powr spec` — define

Claude interviews you. Not a checklist — a conversation. It asks what problem you're solving, who it's for, what success looks like, what the constraints are. It explores the codebase to find related code and asks follow-ups based on what it finds.

Before any of that, it searches Linear for existing tickets, projects, and past attempts that overlap with what you're describing. If something already exists, it tells you.

Based on your answers, it determines the right scope:

| What you described | What gets created in Linear |
|---|---|
| Small fix or tweak | Single ticket |
| Focused feature | Ticket with sub-tickets |
| Multi-part feature | Multiple tickets with dependencies |
| Large initiative | Project with milestones + tickets |

Confirms with you, writes a spec doc, moves on.

### `/powr plan` — plan + review + tickets

Claude reads the spec, surveys the ticket landscape (what's planned, what's in progress, what patterns were established), then writes a step-by-step implementation plan.

Before you see it, it goes through a 5-section review with you:

1. **Architecture** — component boundaries right?
2. **Code quality** — DRY violations, missing error handling, edge cases?
3. **Tests** — what's not covered?
4. **Performance** — N+1 queries, memory, caching?
5. **Ticket decomposition** — clean boundaries, dependency ordering, clear ACs?

For each issue, you pick from options. After all 5 pass, the plan gets decomposed into Linear tickets. Before creating each ticket, Claude checks for duplicates — if an existing ticket already covers it, it links instead of creating a new one.

### `/powr execute` — build

**Single ticket:** Claude reads the ticket, checks where it fits in the project, investigates the codebase, implements, commits, runs code review, cross-references findings against ALL existing tickets (every project, backlog, future — not just current cycle), fixes issues, verifies acceptance criteria, notes what it unblocks, and marks it done. Six quality gates, can't skip any.

**Batch (cycle/project):** Claude builds a dependency graph, groups independent tickets into waves, and runs each wave in parallel worktrees. Wave 1 finishes, merges to main, wave 2 starts. You approve each wave before it launches.

### `/powr ship` — verify + close

Claude checks all tickets are done, audits for orphaned tickets and unresolved sub-issues, runs static analysis, verifies everything is committed, and posts a summary (planned vs built, deferred items, open questions).

### `/powr status` — where am I?

Shows current workflow stage, gate progress, and next action.

### `/powr bypass` — skip it

Sometimes you just want to code. Bypass disables workflow enforcement for the current session.

---

## Parallel terminals

Open 9 terminals. Each gets its own isolated workflow. They don't interfere.

---

# Deep Dive

Everything below is how the system works. You don't need it to use `/powr`.

---

## Setup details

`powr-workmaxxing install` symlinks two things into your repo:

1. `.claude/hooks/powr-hook.sh` — the unified hook runner
2. `.claude/skills/powr/` — the workflow skill

You also need hooks in `.claude/settings.local.json`:

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

---

## Quality gates

Every ticket goes through 6 mandatory gates:

```
INVESTIGATE → IMPLEMENT → CODE REVIEW → CROSS-REF → FIX → VERIFY ACs → DONE
```

| Gate | What happens | Enforced by |
|---|---|---|
| **Investigation** | Explore codebase, post findings | Edit/Write blocked on production files until posted |
| **Code committed** | Implement + commit | CodeRabbit auto-triggered after every commit |
| **Code review** | CodeRabbit review (or Claude self-review if CodeRabbit not installed) | Post-commit hook repeats until satisfied |
| **Cross-reference** | Classify findings vs ALL existing tickets | Comment auto-records gate |
| **Fix findings** | Address "Must Fix Now" items | Auto-passes if none exist |
| **Acceptance criteria** | Verify each AC | Auto-passes if no explicit ACs |

### Code review fallback

If CodeRabbit is installed, the code review gate uses it. If not, Claude does a self-review covering:
- Bugs and logic errors
- Style and naming consistency
- Over-abstractions and unnecessary complexity
- Missing tests
- Security concerns

Either way, the gate is enforced — code gets reviewed before proceeding.

### Auto-detection

Gates record automatically from Linear comment headings:

| Comment contains | Gate |
|---|---|
| "Investigation Findings" | `investigation` |
| "Code Review Findings" | `findings_crossreferenced` |
| "Code Review Findings" + "Resolved" | `findings_resolved` |
| "Acceptance Criteria Verification" + "ALL CRITERIA PASSED" | `acceptance_criteria` |

### Auto-pass rules

- No "Must Fix Now" items → `findings_resolved` auto-passes
- No explicit ACs in description → `acceptance_criteria` auto-passes

---

## Ticket awareness

Claude checks the full Linear landscape at 8 points in the workflow:

| When | What it checks |
|---|---|
| **Spec start** | Existing tickets/projects that overlap. Prior attempts. |
| **Plan start** | Upcoming tickets in same area. Established patterns. Planned refactors. |
| **Ticket creation** | Duplicates. Tickets that could be extended instead. |
| **Investigation** | Project context. What was just built. What's coming next. |
| **Implementation** | Future tickets touching same files. Parallel worktree conflicts. |
| **Cross-reference** | ALL tickets (every project, backlog, future) for existing coverage. |
| **Completion** | What this unblocks. |
| **Ship** | Orphaned tickets. Unresolved sub-tickets. Planned vs built. |

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

Configured in `~/.powr/repos.json`.

---

## Wave-based parallel execution

Batches run in dependency waves:

1. Build dependency DAG from ticket relations
2. Group independent tickets into waves
3. Launch each wave as parallel worktree agents
4. Merge worktrees into main between waves (rebase + fast-forward)
5. Run static analysis after merge
6. Next wave

Merge hook blocks `git merge worktree-*` if branch diverged — must rebase first.

---

## Context exhaustion

If context fills up mid-workflow:

1. Hook reminds Claude to post a handoff comment
2. Comment includes: current step, completed work, remaining steps, key decisions
3. Next session reads state from SQLite — no transcript dependency

---

## Stale detection

Workflows untouched for 2+ hours get a soft warning instead of blocking.

---

## Architecture

```
You ←→ Claude Code
         ├── /powr skill (spec, plan, execute, ship, status, bypass)
         │     ├── Bash(powr-workmaxxing <cmd>)  — state machine
         │     └── Linear MCP                    — tickets
         └── Hooks (powr-hook.sh, 11 handlers)
               └── sqlite3 ~/.powr/workflow.db   — <50ms queries
```

### State machine

```
Feature:  SPECCING → PLANNING → REVIEWING → TICKETING → EXECUTING → SHIPPING → IDLE
Ticket:   QUEUED → INVESTIGATING → IMPLEMENTING → CODE_REVIEWING → CROSS_REFING → FIXING → VERIFYING_ACS → DONE
```

Declarative config. Zod-typed gate evidence. Can't skip or go backwards.

### SQLite (`~/.powr/workflow.db`)

| Table | Purpose |
|---|---|
| `workflows` | Feature workflows |
| `ticket_workflows` | Per-ticket sub-workflows |
| `gates` | Passed gates with evidence |
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
| `post-commit` | PostToolUse Bash | Trigger code review after commit |
| `post-comment` | PostToolUse create_comment | Auto-detect gates from comments |
| `validate-ticket` | PreToolUse create_issue | Validate fields + ACs |
| `merge-coordination` | PreToolUse Bash | Enforce rebase-before-merge |
| `context-handoff` | PreCompact | Remind to post handoff |
| `notification` | Stop/Notification | macOS notifications |

### Workflow isolation

Each workflow gets a UUID. Claude passes `-w <id>` internally. Multiple workflows per repo, zero overlap.

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
