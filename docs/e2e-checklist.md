# /powr Manual E2E Test Checklist

Use this checklist to manually validate the full `/powr` workflow end-to-end after significant changes. It covers all phases, both single-ticket and batch execute modes, model selection logging, and ship.

For automated state machine validation, run `scripts/smoke-test.sh` first.

---

## Pre-flight

- [ ] `powr-workmaxxing status` runs without error
- [ ] `powr-workmaxxing model-signals --help` shows the command (confirms CLI has model-signals)
- [ ] At least one Linear project exists with a team slug
- [ ] jq is installed (`jq --version`)

---

## Phase 1: /powr spec

**Trigger:** `/powr spec "Add user notification preferences"`

| # | What to verify | Pass / Fail |
|---|----------------|-------------|
| 1 | `powr-workmaxxing start` is called; workflow ID is logged | |
| 2 | `powr-spec` (Opus) is spawned | |
| 3 | Agent asks at least one clarifying question via AskUserQuestion | |
| 4 | Agent explores Linear for related issues | |
| 5 | Agent writes `.claude/specs/<name>.md` — file exists with content | |
| 6 | `gate record spec_document_written` is called with the file path | |
| 7 | `advance` is called; stage moves to PLANNING | |
| 8 | Orchestrator tells user to run `/powr plan` and STOPS | |

**Success criteria:** Spec file written, stage = PLANNING, no additional tools called after advance.

---

## Phase 2: /powr plan

**Trigger:** `/powr plan`

| # | What to verify | Pass / Fail |
|---|----------------|-------------|
| 1 | `powr-workmaxxing status` shows PLANNING | |
| 2 | `powr-plan` (Opus) is spawned with spec path | |
| 3 | Agent reads the spec file | |
| 4 | Agent explores the codebase (multiple Read/Glob/Grep calls) | |
| 5 | Agent writes `.claude/plans/<name>.md` — file exists with sections | |
| 6 | `gate record plan_written` is called | |
| 7 | `powr-review` (Sonnet) is spawned with plan path | |
| 8 | Review agent presents 5 sections and asks for approval | |
| 9 | All 5 `review_*` gates are recorded after approval | |
| 10 | `advance` moves to TICKETING | |
| 11 | `powr-tickets` (Haiku) is spawned; creates tickets in Linear | |
| 12 | `.claude/ticket-summaries/<name>.json` is written with ticket data | |
| 13 | `gate record tickets_created` is called with real ticket IDs | |
| 14 | `advance` moves to EXECUTING | |
| 15 | Orchestrator tells user to run `/powr execute` and STOPS | |

**Success criteria:** Tickets created in Linear, JSON cache written, stage = EXECUTING.

---

## Phase 3a: /powr execute (single ticket — Simple)

**Setup:** Use a 1-point bug-fix ticket.

**Trigger:** `/powr execute PROJ-123`

| # | What to verify | Pass / Fail |
|---|----------------|-------------|
| 1 | `powr-workmaxxing model-signals PROJ-123` is called | |
| 2 | Log shows "Model selection for powr-investigate: haiku -- estimate is 1" (or bug-fix reason) | |
| 3 | `powr-investigate` is spawned with `model="haiku"` | |
| 4 | Handoff written to `.claude/handoffs/investigate-PROJ-123.md` | |
| 5 | `gate record investigation` is called with `--ticket PROJ-123` | |
| 6 | `powr-linear-writer` posts investigation doc to Linear | |
| 7 | `model-signals` is called again (post-investigation) | |
| 8 | Log shows "Implementation routing: powr-implement -- complexity is Simple" | |
| 9 | `powr-implement` (Sonnet) is spawned (NOT powr-implement-complex) | |
| 10 | Code is committed; handoff written to `.claude/handoffs/implement-PROJ-123.md` | |
| 11 | `gate record code_committed` is called with real commit SHA | |
| 12 | `model-signals --diff` is called | |
| 13 | Log shows "Model selection for powr-code-review: haiku -- single file with N changed lines" | |
| 14 | `powr-code-review` is spawned with `model="haiku"` | |
| 15 | Review verdict posted to Linear; gate recorded | |
| 16 | Ticket status set to "In Human Review" in Linear | |
| 17 | If review mode: feature branch created, user told to review and create PR | |

**Success criteria:** Code committed, all ticket gates passed, ticket in "In Human Review".

---

## Phase 3b: /powr execute (single ticket — Complex)

**Setup:** Use a 3+ point feature ticket.

**Trigger:** `/powr execute PROJ-456`

| # | What to verify | Pass / Fail |
|---|----------------|-------------|
| 1 | Pre-investigation model-signals: estimate > 1, no bug-fix label | |
| 2 | Log shows "Model selection for powr-investigate: sonnet" | |
| 3 | `powr-investigate` spawned with `model="sonnet"` | |
| 4 | Handoff written with complexity = "Moderate" or "Complex" | |
| 5 | Post-investigation model-signals reads complexity from handoff | |
| 6 | Log shows "Implementation routing: powr-implement-complex -- complexity is Moderate/Complex" | |
| 7 | `powr-implement-complex` is spawned (NOT powr-implement) | |
| 8 | Diff is multi-file or >= 50 lines | |
| 9 | Log shows "Model selection for powr-code-review: sonnet" | |
| 10 | `powr-code-review` spawned with `model="sonnet"` | |

**Success criteria:** Correct agent routing at each decision point.

---

## Phase 3c: /powr execute batch (wave-based)

**Setup:** Use a cycle with 3+ tickets having dependency relationships.

**Trigger:** `/powr execute cycle "Sprint 12"` (or similar)

| # | What to verify | Pass / Fail |
|---|----------------|-------------|
| 1 | All ticket relations are fetched | |
| 2 | Wave plan is presented to user (Wave 1: unblocked, Wave 2: depends on Wave 1, etc.) | |
| 3 | User is asked to confirm before launch | |
| 4 | Wave 1 tickets each spawn `powr-batch-worker` in parallel | |
| 5 | Each batch worker runs full chain: investigate → implement → review → linear-writer | |
| 6 | `gate check-ticket <id>` passes for each completed ticket | |
| 7 | Worktrees are merged after wave completes | |
| 8 | Static analysis runs between waves | |
| 9 | Wave 2 starts after Wave 1 is verified | |
| 10 | `gate record all_tickets_done` after final wave | |
| 11 | `advance` moves to SHIPPING | |

**Success criteria:** All tickets done, stage = SHIPPING, no conflicts on merge.

---

## Phase 4: /powr ship

**Setup:** Use workflow with 1-2 tickets (to test haiku selection) or 3+ (sonnet).

**Trigger:** `/powr ship`

| # | What to verify | Pass / Fail |
|---|----------------|-------------|
| 1 | Ticket-summaries JSON is read to count tickets | |
| 2 | `gate check-ticket` is called for each ticket | |
| 3 | **1-2 tickets, all gates passed:** log shows "Model selection for powr-ship-verify: haiku" | |
| 4 | **3+ tickets:** log shows "Model selection for powr-ship-verify: sonnet" | |
| 5 | **Any failed gate:** log shows sonnet (not haiku) regardless of count | |
| 6 | `powr-ship-verify` runs with correct model | |
| 7 | Verification results presented: gate audit, static analysis, git status | |
| 8 | `powr-linear-writer` posts ship report to each ticket | |
| 9 | All tickets marked "Done" in Linear | |
| 10 | `gate record ship_verified` is called | |
| 11 | `advance` moves to IDLE | |
| 12 | Plans file and handoffs directory are cleaned up | |

**Success criteria:** All tickets Done in Linear, stage = IDLE, ship report posted.

---

## Model Selection Logging Verification

Run `/powr execute` on a single ticket and verify all five log lines appear in the conversation:

| Log line pattern | Expected example |
|-----------------|-----------------|
| `Model selection for powr-investigate: <model> -- <reason>` | "haiku -- estimate is 1, using haiku" |
| `Implementation routing: <agent> -- <reason>` | "powr-implement -- complexity is Simple" |
| `Model selection for powr-code-review: <model> -- <reason>` | "sonnet -- 3 files changed, using sonnet" |
| `Model selection for powr-ship-verify: <model> -- <reason>` | "haiku -- 1 ticket(s) with all gates passed" |

| # | What to verify | Pass / Fail |
|---|----------------|-------------|
| 1 | All four log lines appear | |
| 2 | Haiku is chosen for investigate when estimate <= 1 | |
| 3 | Sonnet is chosen for investigate when estimate > 1 | |
| 4 | `powr-implement` (not powr-implement-complex) for Simple complexity | |
| 5 | `powr-implement-complex` (not powr-implement) for Moderate/Complex | |
| 6 | Haiku for code-review when single file + < 50 lines | |
| 7 | Sonnet for code-review when multi-file | |
| 8 | Haiku for ship-verify when 1-2 tickets + all gates green | |
| 9 | Sonnet for ship-verify when 3+ tickets | |

---

## State Machine Invariants

| # | Invariant to verify | Pass / Fail |
|---|---------------------|-------------|
| 1 | Cannot advance SPECCING without `spec_document_written` gate | |
| 2 | Cannot advance REVIEWING with < 5 review gates | |
| 3 | Cannot `gate record all_tickets_done` if any ticket not DONE | |
| 4 | Stage only advances forward (never backward) | |
| 5 | `powr-workmaxxing status --json` returns current stage correctly at each phase | |
| 6 | `gate check-ticket` returns `allPassed: true` after all ticket gates recorded | |

---

## Automated Verification

Run before manual testing to catch state machine regressions:

```bash
./scripts/smoke-test.sh
```

Expected: 45 tests pass, 0 failed.
