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

Point it at whatever scope you want — a single ticket, a cycle, a project, or nothing (picks the next unblocked ticket). Claude sorts by dependencies, shows you the plan, and works through them one at a time with quality gates.

```
You:    /execute                          ← next unblocked ticket
You:    /execute POWR-500                 ← one specific ticket
You:    /execute cycle "Sprint 12"        ← every ticket in the cycle
You:    /execute project "MVP Launch"     ← every ticket in the project
```

```
Claude: Ready to execute 5 tickets:
          1. POWR-500  OAuth provider setup     (High, 3pt, unblocked)
          2. POWR-501  Token exchange            (High, 5pt, after POWR-500)
          3. POWR-502  Refresh logic             (Normal, 3pt, after POWR-500)
          ...
        Start with POWR-500?
You:    yes
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
Step 3   /execute             Build tickets (one, a cycle, or a whole project)
Step 4   /ship                Verify → done
```

You never need to remember gate names, stage names, or CLI flags. Claude knows them. You just say the word.

---

## Parallel terminals

Open 9 terminals. Run `/spec` in each one. They don't interfere.

Each `/spec` creates an isolated workflow with its own ID. Claude tracks the ID internally and passes it to every command — you never see it, copy it, or think about it.

```
Terminal 1:  /spec auth overhaul       → Claude works on auth
Terminal 2:  /spec weight trends       → Claude works on weight, unaware of Terminal 1
Terminal 3:  /spec meal planning       → same deal
```

No shared state, no conflicts. Terminal 1 can be in `/execute` while Terminal 3 is still in `/spec`.

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

**Workflow isolation.** Each `start` creates a workflow with a UUID. Claude passes `-w <id>` to every command so multiple workflows in the same repo never touch each other's state. If you're running CLI commands manually (outside of Claude), set `export POWR_WF=<id>` to scope your terminal.

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
| View audit trail | `powr-workmaxxing audit log` |
| Clean up stale state | `powr-workmaxxing session cleanup` |
| Preview tickets from a plan | `powr-workmaxxing tickets preview plan.md` |
