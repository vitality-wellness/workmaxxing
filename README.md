# workmaxxing

Your dev workflow in 4 words.

```
/powr spec → /powr plan → /powr execute → /powr ship
```

That's it. Say the word, Claude handles the rest.

## Why this exists

AI coding agents are fast but sloppy. Left unchecked, Claude will skip investigation, write code without understanding context, commit without review, and mark tickets done with half the acceptance criteria unverified. Telling it "please be thorough" in a system prompt doesn't work — it agrees, then cuts corners anyway. And you shouldn't have to paste the same 20-line prompt every session reminding it to investigate before coding, run code review after committing, and cross-reference findings with existing tickets.

workmaxxing fixes this with **gates** — hard checkpoints that mechanically block progress until real work is done. Not instructions. Not suggestions. Actual PreToolUse hooks that deny tool calls if gates aren't passed. Claude can't mark a ticket Done without passing all 7 gates. It can't edit production code without investigating first. It can't skip code review. The enforcement lives in hooks and SQLite, not in prose.

## Why Linear

Linear gives Claude context beyond the current session. Instead of starting cold every time — reading files, guessing at project structure, not knowing what was already built — it can check the ticket graph. What's done, what's in progress, what's planned, what was tried and canceled. That context helps it avoid duplicate work, understand where a feature fits, and make more informed decisions when planning and architecting.

It also gives you a paper trail. Every investigation, code review, and verification gets posted as a Linear comment tied to a real ticket. When something goes wrong or you want to understand what Claude actually did, it's all there — not buried in a chat transcript you already closed.

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
git clone https://github.com/vitality-wellness/workmaxxing.git ~/.powr/src
cd ~/.powr/src && npm install && npm run build && npm link
powr-workmaxxing setup
```

Then in any repo:

```bash
cd ~/my-project
powr-workmaxxing install
```

---

## Walkthrough

Here's what a real session looks like, start to finish.

### Step 1: `/powr spec` — tell Claude what you want to build

```
You:    /powr spec add weight trend analytics
```

Claude starts a conversation. It'll ask what problem you're solving, who uses it, what success looks like, what's in and out of scope. It's not a form — it's a back-and-forth. Give vague answers and it'll push for specifics. Every question requires a real response — if your answer comes through empty (e.g., permissions auto-skip), Claude stops and re-asks instead of making things up.

While you're talking, Claude searches Linear for anything that overlaps — in **every status**: done, in progress, in review, todo, backlog, canceled. If something was already built, is actively being worked on, or was attempted and canceled, it'll tell you before you waste time re-speccing it.

It also explores the codebase to understand what code is involved, then asks follow-up questions based on what it finds.

Based on everything, Claude figures out the right scope:

| What you described | What gets created |
|---|---|
| Small fix or tweak | Single ticket |
| Focused feature | Ticket with sub-tickets |
| Multi-part feature | Multiple tickets with dependencies |
| Large initiative | Project with milestones + tickets |

It confirms with you, then writes a spec doc and saves it.

**When it's done, Claude tells you.** It'll say something like "Spec complete. Type `/powr plan` when you're ready to plan the implementation."

You don't have to do it immediately. Come back tomorrow. The spec is saved.

### Step 2: `/powr plan` — plan, review, create tickets

```
You:    /powr plan
```

Claude picks up the spec you wrote, checks what's already planned in Linear, explores the codebase, and writes a step-by-step implementation plan.

Then it walks you through a 5-section review:

1. **Architecture** — component boundaries right?
2. **Code quality** — DRY violations, missing error handling, edge cases?
3. **Tests** — what's not covered?
4. **Performance** — N+1 queries, memory, caching?
5. **Ticket decomposition** — do the steps break into clean tickets?

For each issue it finds, it gives you options and a recommendation. You pick. After all 5 sections pass, it creates Linear tickets automatically — with dependencies, estimates, labels, and acceptance criteria. A ticket is **always** created, even for small single-ticket features. No skipping, no placeholder IDs.

Before creating each ticket, it checks Linear across **all statuses** — done, in progress, in review, todo, backlog, canceled. No duplicates, no re-doing finished work.

After tickets are created, the spec file is cleaned up — it's been fully absorbed into the plan and tickets.

**When it's done:** "Tickets created. Type `/powr execute` to start building."

### Step 3: `/powr execute` — build the tickets

```
You:    /powr execute                          ← next unblocked ticket
You:    /powr execute POWR-500                 ← specific ticket
You:    /powr execute cycle "Sprint 12"        ← all tickets in a cycle
You:    /powr execute project "MVP Launch"     ← all tickets in a project
```

**Single ticket:** Claude sets the ticket to In Progress (auto-records the `ticket_in_progress` gate), investigates the codebase, implements, commits (auto-records `code_committed` with the real SHA), runs code review, cross-references findings against ALL existing tickets (every project, backlog, future — not just current cycle), fixes issues, verifies acceptance criteria, notes what it unblocks, and marks it done. Seven quality gates per ticket — it can't skip any of them.

**Batch:** Claude builds a dependency graph, groups independent tickets into waves, and runs each wave in parallel worktrees. It shows you the plan:

```
Wave 1 (3 parallel worktrees):
  POWR-500  OAuth provider setup     (High, 3pt)
  POWR-502  Refresh token logic      (Normal, 3pt)
  POWR-505  Config migration         (Normal, 1pt)

Wave 2 (after wave 1):
  POWR-501  Token exchange endpoint  (High, 5pt)
  POWR-503  Flutter login screen     (Normal, 5pt)

Start wave 1?
```

You approve. It launches. Wave 1 finishes, merges to main, wave 2 starts. You approve each wave.

**When it's done:** "All tickets complete. Type `/powr ship` to wrap up."

### Step 4: `/powr ship` — verify and close

```
You:    /powr ship
```

Claude verifies **every ticket passed through all 7 gates** — ticket in progress, investigation, code committed, code review, cross-reference, fix findings, verify ACs. If any ticket skipped a gate or isn't in DONE, it stops and tells you what's missing. Nothing ships until everything checks out.

Then it audits the ticket landscape — orphaned tickets, open sub-issues, in-progress work that should have been completed, planned vs actually built. It runs static analysis, verifies everything is committed, and gives you a summary.

The plan file is cleaned up after shipping — tickets are the historical record.

**When it's done:** "Workflow complete." That's it. Start the next one whenever you want.

---

## Other commands

```
/powr status    Show current stage, gate progress, next action
/powr bypass    Skip workflow enforcement for this session (just code)
```

```bash
powr-workmaxxing audit log        # what happened?
powr-workmaxxing session cleanup  # something stuck?
```

---

## Parallel terminals

Open as many terminals as you want. Each gets its own isolated workflow. They don't interfere.

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
      { "matcher": "mcp__plugin_linear_linear__save_issue", "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/powr-hook.sh enforce-gates" }] },
      { "matcher": "mcp__plugin_linear_linear__save_issue", "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/powr-hook.sh validate-ticket" }] },
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/powr-hook.sh merge-coordination" }] }
    ],
    "PostToolUse": [
      { "matcher": "Bash", "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/powr-hook.sh post-commit" }] },
      { "matcher": "mcp__plugin_linear_linear__save_issue", "hooks": [{ "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/powr-hook.sh auto-record-status" }] },
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

Every ticket goes through 7 mandatory gates, scoped per-ticket:

```
IN PROGRESS → INVESTIGATE → IMPLEMENT → CODE REVIEW → CROSS-REF → FIX → VERIFY ACs → DONE
```

| Gate | What happens | Enforced by |
|---|---|---|
| **Ticket in progress** | Set ticket to In Progress in Linear | **Auto-records** via `auto-record-status` hook |
| **Investigation** | Explore codebase, post findings | Edit/Write blocked on production files until posted |
| **Code committed** | Implement + commit | **Auto-records** via `post-commit` hook with real SHA |
| **Code review** | CodeRabbit review (or Claude self-review if CodeRabbit not installed) | Post-commit hook repeats until satisfied |
| **Cross-reference** | Classify findings vs ALL existing tickets | Comment auto-records gate (ticket-scoped) |
| **Fix findings** | Address "Must Fix Now" items | Auto-passes if none exist |
| **Acceptance criteria** | Verify each AC | Auto-passes if no explicit ACs |

Gates are **ticket-scoped** — ticket A's gates don't satisfy ticket B's Done check. Evidence is validated: spec/plan gates require real file paths, `code_committed` requires a valid commit SHA, `all_tickets_done` checks that every ticket_workflow is in DONE.

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
| **Spec start** | All statuses: done (already built?), in progress (active work?), todo/backlog (planned?), canceled (why?). |
| **Plan start** | Upcoming tickets in same area. Established patterns. Planned refactors. |
| **Ticket creation** | All statuses: duplicates, done work, active work, planned work. Extend or link instead of duplicating. |
| **Investigation** | Project context. What was just built. What's coming next. |
| **Implementation** | Future tickets touching same files. Parallel worktree conflicts. |
| **Cross-reference** | ALL tickets (every project, backlog, future) for existing coverage. |
| **Completion** | What this unblocks. |
| **Ship** | All gates passed per ticket. Orphaned tickets. Unresolved sub-tickets. Skipped reviews. Planned vs built. |

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
         └── Hooks (powr-hook.sh, 12 handlers)
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
| `enforce-gates` | PreToolUse save_issue | Block Done without all ticket-scoped gates |
| `auto-record-status` | PostToolUse save_issue | Auto-record `ticket_in_progress` on In Progress |
| `post-commit` | PostToolUse Bash | Auto-record `code_committed` with SHA + trigger code review |
| `post-comment` | PostToolUse create_comment | Auto-detect gates from comments (ticket-scoped) |
| `validate-ticket` | PreToolUse save_issue | Validate fields + ACs |
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

  gate record <name> [--ticket] [--evidence]  Record a gate (ticket-scoped)
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
