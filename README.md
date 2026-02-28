# powr-workmaxxing

Your dev workflow in 4 words.

```
/spec → /plan → /execute → /ship
```

That's it. Say the word, Claude handles the rest.

---

## Setup (once, 2 minutes)

```bash
# 1. Install
cd ~/Dev/vitality/powr-workmaxxing
npm install && npm run build && npm link

# 2. Verify
powr-workmaxxing status
# → "No active workflow."
```

Done. Works from any repo, any terminal.

---

## How it works

You talk to Claude normally. Four slash commands guide the flow:

### `/spec` — "What are we building?"

Claude interviews you, writes a spec doc, moves on.

```
You:    /spec add weight trend analytics
Claude: [asks 5-6 questions]
Claude: "Spec written to .claude/specs/weight-trends.md. Use /plan when ready."
```

### `/plan` — "How are we building it?"

Claude writes an implementation plan, then reviews it with you across 5 dimensions (architecture, code quality, tests, performance, ticket breakdown). After you approve, it creates Linear tickets automatically.

```
You:    /plan
Claude: [writes plan, enters review]
Claude: "Issue 1: Your plan has no error handling for the API boundary..."
        A) Add try/catch with AppError hierarchy (Recommended)
        B) Let it crash and handle at the caller
        C) Do nothing
You:    A
Claude: [continues review... creates tickets]
Claude: "Created 5 tickets. Use /execute to start."
```

### `/execute` — "Build it."

Claude works through tickets one at a time. Each ticket goes through investigation → implementation → code review → verification. Gates enforce quality — you can't skip steps.

```
You:    /execute
Claude: [shows ticket list, starts first unblocked ticket]
Claude: [investigates, implements, reviews, verifies ACs]
Claude: "POWR-500 done. Starting POWR-501..."
```

### `/ship` — "We're done."

Claude runs final checks (static analysis, all tickets done, all committed) and closes out the workflow.

```
You:    /ship
Claude: "All 5 tickets done. dart analyze clean. Workflow complete."
```

---

## The mental model

There's only one thing to remember:

> **Every feature follows the same 4 steps. Always.**

```
         You say              What happens
         ───────              ────────────
Step 1   /spec                Interview → spec document
Step 2   /plan                Plan → review → Linear tickets
Step 3   /execute             Build each ticket with quality gates
Step 4   /ship                Verify → done
```

You never need to remember gate names, stage names, or CLI flags. Claude knows them. You just say the word.

---

## Parallel terminals

Open as many terminals as you want. Each one gets its own isolated workflow.

```bash
# Terminal 1
powr-workmaxxing start "auth overhaul"
# → Workflow started: "auth overhaul"
# → ID: abc-123
# →
# → Set this in your terminal to scope all commands:
# →   export POWR_WF=abc-123

# Terminal 2
powr-workmaxxing start "weight trends"
# → export POWR_WF=def-456

# Terminal 3
powr-workmaxxing start "meal planning"
# → export POWR_WF=ghi-789
```

Each terminal only sees its own workflow. Terminal 1 can advance to PLANNING while terminals 2 and 3 are still in SPECCING. No overlap, no conflicts, no shared state.

**How isolation works:** `POWR_WF` is an env var scoped to your shell session. Every command reads it to know which workflow to operate on. Different terminal = different `POWR_WF` = different workflow.

You can also pass it explicitly: `powr-workmaxxing status -w abc-123`

---

## Escape hatches

Sometimes you just want to code without a workflow.

```bash
# Skip the workflow entirely
powr-workmaxxing bypass

# Check where you are
powr-workmaxxing status

# See what happened
powr-workmaxxing audit log

# Something stuck? Clean up
powr-workmaxxing session cleanup
```

---

## What's actually under the hood

You don't need to know this to use it. But if you're curious:

**State machine.** Every workflow moves through stages with gates between them. You can't advance until gates pass. This replaces the old bash scripts and file markers.

```
Feature:  SPEC → PLAN → REVIEW → TICKETS → EXECUTE → SHIP → IDLE
Ticket:   QUEUE → INVESTIGATE → IMPLEMENT → REVIEW → CROSSREF → FIX → VERIFY → DONE
```

**SQLite.** All state lives in `~/.powr/workflow.db`. WAL mode + 5s busy timeout handles 9 concurrent writers without conflicts. No more `.gates` files, `SESSION_WORKFLOW` markers, or stale state bugs.

**Linear MCP.** Ticket creation and updates go through the Linear MCP plugin you already have. No separate API keys or SDK dependencies.

**CLI.** `powr-workmaxxing` is a TypeScript CLI that Claude calls via `Bash()`. Hooks read SQLite directly. One binary, globally installed.

```
You ←→ Claude Code ←→ powr-workmaxxing CLI (state) + Linear MCP (tickets)
                  ↑
            Skills orchestrate both
```

**Workflow isolation.** Each `start` creates a new workflow with a UUID. The `POWR_WF` env var scopes all commands to that UUID. Multiple workflows can exist for the same repo simultaneously — they never touch each other's state.

---

## Quick reference

| You want to... | Say |
|---|---|
| Start a new feature | `/spec` |
| Plan and create tickets | `/plan` |
| Build the tickets | `/execute` |
| Finish up | `/ship` |
| Skip the workflow | `powr-workmaxxing bypass` |
| Check status | `powr-workmaxxing status` |
| View audit trail | `powr-workmaxxing audit log` |
| Clean up stale state | `powr-workmaxxing session cleanup` |
| Preview tickets from a plan | `powr-workmaxxing tickets preview plan.md` |
| Scope to a specific workflow | `export POWR_WF=<id>` or `-w <id>` |
