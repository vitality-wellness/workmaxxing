# powr-workmaxxing

Your dev workflow in 4 words.

```
/spec → /plan → /execute → /ship
```

That's it. Say the word, Claude handles the rest.

---

## Setup

```bash
# First time — clone and install the CLI
git clone <repo-url> ~/.powr/src
cd ~/.powr/src && npm install && npm run build && npm link

# Add to any repo
cd ~/my-project
powr-workmaxxing setup       # once — initializes ~/.powr/ database
powr-workmaxxing install     # per repo — adds hooks + skills
```

After the initial clone, `powr-workmaxxing` is globally available. `install` is safe to run on repos that already have `.claude/`.

---

## How it works

You talk to Claude normally. Four slash commands guide the flow:

### `/spec` — "What are we building?"

Claude interviews you, writes a spec doc, moves on.

```
You:    /spec add weight trend analytics
Claude: [asks 5-6 questions]
Claude: "Spec written. Use /plan when ready."
```

### `/plan` — "How are we building it?"

Claude writes an implementation plan, reviews it with you across 5 dimensions, then creates Linear tickets automatically.

```
You:    /plan
Claude: [writes plan, enters review]
Claude: "Issue 1: No error handling at the API boundary..."
        A) Add try/catch with AppError hierarchy (Recommended)
        B) Let it crash and handle at the caller
        C) Do nothing
You:    A
Claude: [continues review... creates tickets]
Claude: "Created 5 tickets. Use /execute to start."
```

### `/execute` — "Build it."

Point it at whatever scope you want. Single ticket runs directly. Batches run in parallel worktrees.

```
/execute POWR-500                 ← one ticket
/execute cycle "Sprint 12"        ← all tickets in cycle, parallel waves
/execute project "MVP Launch"     ← all tickets in project
/execute                          ← next unblocked ticket
```

```
Claude: Execution plan for cycle "Sprint 12" (6 tickets):

          Wave 1 (3 parallel worktrees):
            POWR-500  OAuth provider setup     (High, 3pt)
            POWR-502  Refresh token logic      (Normal, 3pt)
            POWR-505  Auth config migration    (Normal, 1pt)

          Wave 2 (after wave 1):
            POWR-501  Token exchange endpoint  (High, 5pt)
            POWR-503  Flutter login screen     (Normal, 5pt)

        Start wave 1?
You:    yes
Claude: [3 agents launch in isolated worktrees]
Claude: Wave 1 complete. Merging → main. Starting wave 2...
```

### `/ship` — "We're done."

Final checks, static analysis, close it out.

```
You:    /ship
Claude: "All 5 tickets done. dart analyze clean. Workflow complete."
```

---

## The mental model

> **Every feature follows the same 4 steps. Always.**

```
         You say              What happens
         ───────              ────────────
Step 1   /spec                Interview → spec document
Step 2   /plan                Plan → review → Linear tickets
Step 3   /execute             Build tickets (one, a cycle, or a whole project)
Step 4   /ship                Verify → done
```

You never need to remember gate names, stage names, or CLI flags. Claude knows them.

---

## Parallel terminals

Open 9 terminals. Run `/spec` in each one. They don't interfere.

Claude tracks each workflow's ID internally. You never see it, copy it, or think about it.

```
Terminal 1:  /spec auth overhaul       → working on auth
Terminal 2:  /spec weight trends       → working on weight, unaware of Terminal 1
Terminal 3:  /spec meal planning       → same deal
```

Terminal 1 can be in `/execute` while Terminal 3 is still in `/spec`. No shared state, no conflicts.

---

## Escape hatches

```bash
powr-workmaxxing bypass           # skip the workflow, just code
powr-workmaxxing status           # where am I?
powr-workmaxxing audit log        # what happened?
powr-workmaxxing session cleanup  # something stuck? clean up
```

---

## Quick reference

| You want to... | Say |
|---|---|
| Start a new feature | `/spec` |
| Plan and create tickets | `/plan` |
| Build one ticket | `/execute POWR-500` |
| Build a whole cycle | `/execute cycle "Sprint 12"` |
| Build a whole project | `/execute project "MVP"` |
| Build next unblocked | `/execute` |
| Finish up | `/ship` |
| Skip the workflow | `powr-workmaxxing bypass` |
| Check status | `powr-workmaxxing status` |
| Install in a new repo | `powr-workmaxxing install /path/to/repo` |

---

# Deep Dive

Everything below is how the system works under the hood. You don't need any of it to use the 4 slash commands — but it explains what's enforcing quality, how parallel execution works, and how every piece fits together.

---

## Quality gates

Every ticket goes through 6 mandatory gates. You can't skip them — hooks enforce this at the tool level.

```
INVESTIGATE → IMPLEMENT → CODE REVIEW → CROSS-REF → FIX → VERIFY ACs → DONE
```

| Gate | What happens | How it's enforced |
|---|---|---|
| **Investigation** | Explore codebase, answer 5 questions, post findings comment | Edit/Write on production files blocked until investigation posted |
| **Code committed** | Write code, commit | CodeRabbit auto-triggered after every `git commit` until review gate passes |
| **CodeRabbit review** | Automated code review | Post-commit hook repeats "MANDATORY: Run /coderabbit:review" until satisfied |
| **Cross-reference** | Classify findings vs existing tickets | Comment with "Code Review Findings (CodeRabbit)" auto-records gate |
| **Fix findings** | Address "Must Fix Now" items | Auto-passes if no "Must Fix Now" items exist |
| **Acceptance criteria** | Verify each AC passes | Comment with "ALL CRITERIA PASSED" auto-records gate. Auto-passes if ticket has no explicit ACs |

### Auto-detection

Gates are recorded automatically when you post Linear comments with specific headings — you don't need to run CLI commands manually:

| Comment contains | Gate recorded |
|---|---|
| "Investigation Findings" | `investigation` |
| "Code Review Findings (CodeRabbit)" | `findings_crossreferenced` |
| "Code Review Findings" + "Resolved" | `findings_resolved` |
| "Acceptance Criteria Verification" + "ALL CRITERIA PASSED" | `acceptance_criteria` |

### Auto-pass rules

Some gates pass automatically when conditions are met:

- **No "Must Fix Now" items** in cross-reference → `findings_resolved` auto-passes (skips the fix step entirely)
- **No explicit ACs** in ticket description → `acceptance_criteria` auto-passes (Claude generates and verifies them from the implementation)

---

## Ticket validation

Every ticket created through Linear MCP is validated before creation. This catches incomplete tickets before they exist.

**Full tickets require:**
- Title, assignee, cycle, project, labels (1+), estimate (>0)
- Description: 100+ characters, 2+ section headings, "## Acceptance Criteria" heading with checkbox items

**Sub-tickets (have a parentId) get relaxed rules:**
- Project is optional (inherits from parent)
- Description just needs to be non-empty (no length/heading requirements)

If validation fails, the hook blocks the `create_issue` call with a detailed error listing every missing field.

---

## Production file gating

Not all files are gated — only production code. The system knows which paths matter per repo:

| Repo | Production paths | Analyze command |
|---|---|---|
| powr-frontend | `lib/`, `ios/` | `dart analyze` |
| powr-api | `internal/`, `cmd/` | `go vet ./...` |
| website | `src/` | `npm run build` |

Editing a test file, config file, or doc? No gate. Editing `lib/screens/auth/login.dart`? Investigation must be posted first.

Configured in `~/.powr/repos.json` — auto-created with defaults on first use.

---

## Plan review

When Claude creates a plan and tries to exit plan mode, the review hook intercepts and forces a 5-section interactive review:

1. **Architecture** — component boundaries, coupling, data flow, security
2. **Code Quality** — DRY violations, error handling, edge cases
3. **Tests** — coverage gaps, assertion strength, failure modes
4. **Performance** — N+1 queries, memory, caching, complexity
5. **Ticket Decomposition** — clean boundaries, dependency ordering, AC clarity

For each issue found, Claude presents numbered options (recommended first) and waits for your choice. Only after all 5 sections are approved does the plan proceed to ticket creation.

---

## Wave-based parallel execution

When you `/execute` a batch (cycle, project, milestone), Claude doesn't go one-by-one. It builds a dependency graph and runs tickets in parallel waves:

```
1. Fetch all tickets + their blockedBy/blocks relations
2. Topologically sort into waves (independent tickets group together)
3. Launch each wave as parallel agents in isolated worktrees
4. Wait for wave to complete
5. Merge all worktrees into main (rebase + fast-forward, smallest diff first)
6. Run static analysis after merge
7. Start next wave
```

### Merge coordination

Worktree merges are enforced by a hook:

- `git merge worktree-*` is **blocked** if the branch has diverged from main
- You must rebase first: `git rebase main <branch>`, then `git merge --ff-only <branch>`
- This prevents cascading merge conflicts when multiple agents finish simultaneously

---

## Context exhaustion

If Claude's context window fills up mid-workflow, the system handles it:

1. **PreCompact hook fires** — reminds Claude to post a handoff comment to the Linear ticket
2. **Handoff comment** includes: current step, completed work, in-progress work, remaining steps, key decisions
3. **Next session** picks up from the handoff comment — reads state from SQLite (not the old transcript)

This means context resets don't lose workflow progress. The database remembers where you are.

---

## Notifications

macOS desktop notifications keep you in the loop:

- **Task complete** (Stop event) — Glass sound
- **Attention needed** (Notification event — questions, permissions) — Bottle sound

Requires macOS with `osascript`. Silently skipped on other platforms.

---

## Stale workflow detection

If a workflow hasn't been touched in 2+ hours, the prompt injection switches from a hard "ACTIVE WORKFLOW" directive to a soft warning:

```
STALE WORKFLOW: "auth overhaul" (EXECUTING) — last activity 3h ago.
Use `powr-workmaxxing status` to check, or `powr-workmaxxing bypass` to skip.
```

This prevents the old problem where stale state from a previous session blocks a new session.

---

## Architecture

```
You
 ↕ natural language
Claude Code
 ├── Skills (/spec, /plan, /execute, /ship)
 │     └── Bash(powr-workmaxxing <command>)  — state operations
 │     └── Linear MCP                        — ticket operations
 └── Hooks (powr-hook.sh — single runner, 11 handlers)
       └── sqlite3 ~/.powr/workflow.db       — state checks (<50ms)
```

### State machine

Two levels of state machines, both defined declaratively in config (adding a stage = adding config, not code):

```
Feature workflow:
  SPECCING → PLANNING → REVIEWING → TICKETING → EXECUTING → SHIPPING → IDLE

Per-ticket sub-workflow:
  QUEUED → INVESTIGATING → IMPLEMENTING → CODE_REVIEWING → CROSS_REFING → FIXING → VERIFYING_ACS → DONE
```

Each stage has named gates that must pass before advancing. Gates have typed evidence (Zod schemas) and transitions are validated — you can't skip stages or go backwards.

### SQLite

All state lives in `~/.powr/workflow.db`:

| Table | Purpose |
|---|---|
| `workflows` | Feature-level workflows (stage, repo, name) |
| `ticket_workflows` | Per-ticket sub-workflows |
| `gates` | Passed gates with evidence (JSON) |
| `sessions` | Claude sessions (linked to workflows, bypass tracking) |
| `audit_log` | Every state change, gate recording, session event |

WAL mode for concurrent reads from hooks. 5-second busy timeout for 9 concurrent writers. Indexes on active+repo for fast hook queries.

### Hook system

One shell script (`hooks/powr-hook.sh`) handles all 11 hook events:

| Handler | Event | Matcher | What it does |
|---|---|---|---|
| `require-ticket` | PreToolUse | Edit\|Write | Block production edits without investigation |
| `detect-work` | UserPromptSubmit | — | Inject workflow status + next directive |
| `lifecycle` | Stop | — | Block premature stop during active workflow |
| `review-plan` | PreToolUse | ExitPlanMode | Force 5-section plan review |
| `enforce-gates` | PreToolUse | update_issue | Block Done without all gates |
| `post-commit` | PostToolUse | Bash | Trigger CodeRabbit after git commit |
| `post-comment` | PostToolUse | create_comment | Auto-detect gates from comment text |
| `validate-ticket` | PreToolUse | create_issue | Validate fields + ACs |
| `merge-coordination` | PreToolUse | Bash | Enforce rebase-before-merge for worktrees |
| `context-handoff` | PreCompact | — | Remind to post handoff comment |
| `notification` | Stop/Notification | — | macOS desktop notification |

### Workflow isolation

Each `start` creates a workflow with a UUID. Claude passes `-w <id>` to every subsequent command. Multiple workflows in the same repo never touch each other's state.

If running CLI manually (outside Claude): `export POWR_WF=<id>` to scope your terminal.

---

## CLI reference

```
powr-workmaxxing
  status [-w <id>] [--json]           Where am I?
  start <name> [--repo <path>]        Begin new workflow
  advance [-w <id>]                   Advance stage (gate-checked)
  bypass                              Skip workflow enforcement

  gate record <name> [--evidence]     Record a gate
  gate check <name>                   Check if gate passed (exit code)
  gate list [-w <id>] [--json]        List gates for current stage
  gate detect --text "..."            Auto-detect gates from comment
  gate next                           Show next mandatory action

  session start                       Register Claude session
  session cleanup                     Clean stale sessions
  session info                        Show session details

  tickets preview <plan.md> [--json]  Preview tickets from a plan
  tickets validate --json '{...}'     Validate ticket fields

  repo analyze                        Run static analysis
  repo info                           Show repo configuration

  audit log [--limit N]               View recent events
```
