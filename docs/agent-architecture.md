# /powr Agent Architecture — Cost-Optimized Multi-Model Design

> Architecture reference for the /powr multi-agent system. The design has been fully implemented. This document reflects the actual implementation.

---

## Problem

The original `/powr` system was a single 600-line SKILL.md (~8K tokens) that loaded into every invocation. All work ran in the main conversation model (typically Opus). This wasted money on tasks that don't need top-tier reasoning: formatting Linear comments, creating tickets from structured data, running review checklists, and simple codebase searches.

## Goal

Minimize cost and context usage while preserving quality where it matters. The solution:
1. A lightweight orchestrator SKILL.md (~280 lines) that only routes
2. Specialized subagents in `.claude/agents/` with per-task model selection
3. File-based handoffs so no content passes through the orchestrator
4. Standardized Linear Document + Comment output format for all phases
5. Dynamic model selection based on task complexity signals read via `powr-workmaxxing model-signals`

---

## Architecture Overview

```
User → /powr <subcommand>
         │
         ▼
   ┌─────────────┐
   │  SKILL.md    │  inherit (runs at user's model)
   │ Orchestrator │  ~280 lines, routing + state management
   └──────┬──────┘
          │ spawns subagents via Agent tool
          │ passes file paths + ticket IDs (not content)
          │ reads signals via: powr-workmaxxing model-signals
          │
    ┌─────┼─────┬──────────┬──────────────┐
    ▼     ▼     ▼          ▼              ▼
  spec  plan  review   tickets    execute chain
 (Opus) (Opus) (Sonnet) (Haiku)   (varies per ticket)
                                     │
                              ┌──────┴──────────┐
                              │                 │
                         single ticket      batch mode
                         (chained agents)   (powr-batch-worker
                                             per ticket, worktree)
```

### Key Constraints

- **Subagents cannot spawn other subagents.** The orchestrator (SKILL.md, running in the main conversation) manages all chaining.
- **Subagents get their own context window.** Intermediate results don't bloat the main conversation.
- **The `model` parameter on the Agent tool overrides the subagent's default.** This enables dynamic model selection at spawn time.
- **File-based handoffs** are the communication mechanism. Agent A writes to a file, orchestrator tells Agent B the file path. No content transits the orchestrator.
- **`powr-batch-worker` is self-contained.** It cannot spawn sub-subagents, so it runs the full investigate → implement → review → document chain internally.

---

## Subagent Definitions

All subagent files live in `.claude/agents/`.

### Model Tier Reference

| Model | Input / 1M tokens | Output / 1M tokens | Relative Cost |
|-------|-------------------|--------------------|--------------|
| Opus 4 | $15.00 | $75.00 | 1x (baseline) |
| Sonnet 4 | $3.00 | $15.00 | ~5x cheaper |
| Haiku 3.5 | $0.80 | $4.00 | ~19x cheaper |

### Agent Inventory

| Agent | Default Model | Purpose | Tools |
|-------|--------------|---------|-------|
| `powr-spec` | opus | Interview user, write spec | Read, Write, Glob, Grep, AskUserQuestion, Bash, Linear MCP |
| `powr-plan` | opus | Explore codebase, write implementation plan | Read, Write, Glob, Grep, Bash, Linear MCP |
| `powr-review` | sonnet | 5-section plan review, user approval | Read, AskUserQuestion, Bash |
| `powr-tickets` | haiku | Create Linear tickets from plan | Read, Bash, Linear MCP |
| `powr-investigate` | sonnet | Ticket investigation, codebase exploration; writes `.claude/handoffs/investigate-<id>.md` | Read, Glob, Grep, Bash, Linear MCP |
| `powr-implement` | sonnet | Code implementation for Simple-complexity tickets | Read, Write, Edit, Bash, Glob, Grep |
| `powr-implement-complex` | inherit | Code implementation for Moderate/Complex tickets; runs at user's model | Read, Write, Edit, Bash, Glob, Grep |
| `powr-code-review` | sonnet | Review code changes against quality checklist | Read, Glob, Grep, Bash |
| `powr-linear-writer` | haiku | Create Linear Documents, post timeline comments | Read, Linear MCP |
| `powr-ship-verify` | sonnet | Ship verification, gate audit, landscape check | Read, Bash, Linear MCP |
| `powr-batch-worker` | inherit | End-to-end ticket execution in isolated worktree (investigate → implement → review → document) | Read, Write, Edit, Bash, Glob, Grep, Linear MCP |

---

## Dynamic Model Selection

The orchestrator reads cheap signals and overrides the default model at spawn time. Signal reading is handled by the `powr-workmaxxing model-signals` CLI command (implemented in `src/commands/model-signals.ts`). The routing logic is in `src/commands/model-select.ts`.

### Available Signals

| Signal | Source | Cost |
|--------|--------|------|
| Ticket estimate | Linear API (already fetched in ticket-summaries) | Free |
| Ticket labels | Linear API (already fetched) | Free |
| Diff size | `git diff --stat` (quick bash command) | Free |
| Files in scope | Investigation Report (already produced) | Already paid for |
| Complexity rating | Investigation Report (explicit field) | Already paid for |

### Per-Agent Model Ladder

#### powr-spec

| Haiku | Sonnet | Opus |
|-------|--------|------|
| Never | Never | Always (default) |

**Rationale:** Spec interviews require nuanced understanding of user intent, good follow-up questions, and the ability to synthesize vague requirements into concrete scope. This is Opus territory.

**Exception under consideration:** If the orchestrator detects a single-ticket scope with clear, specific requirements (user provides detailed description up front), Sonnet could handle the spec. This would be a future optimization.

#### powr-plan

| Haiku | Sonnet | Opus |
|-------|--------|------|
| Never | Single ticket that follows existing patterns | Default (architecture decisions) |

**Downgrade criteria:** Ticket estimate ≤ 1 AND scope is a single ticket AND labels include "bug-fix" or "chore".

#### powr-review

| Haiku | Sonnet | Opus |
|-------|--------|------|
| Never | Default | Multi-system feature touching 3+ domains |

**Upgrade criteria:** Plan touches 3+ top-level directories or 3+ distinct subsystems.

#### powr-tickets

| Haiku | Sonnet | Opus |
|-------|--------|------|
| Always (default) | Never | Never |

**Rationale:** Reads a structured plan, transforms it into Linear API calls. Pure data transformation.

#### powr-investigate

| Haiku | Sonnet | Opus |
|-------|--------|------|
| Estimate ≤ 1, or labeled "bug-fix" | Default | Never |

**Rationale:** Simple bug investigations are just "find the file, read it, report." Sonnet handles deeper exploration. Opus never needed — investigation informs decisions but doesn't make architectural ones.

#### powr-implement / powr-implement-complex

Implementation uses **agent routing** rather than model overrides. Two separate agents with different system prompts handle different complexity tiers:

| Agent | Model | When |
|-------|-------|------|
| `powr-implement` | Sonnet (default) | Investigation complexity = "Simple" |
| `powr-implement-complex` | inherit (user's model) | Investigation complexity = "Moderate", "Complex", or null |

**This is the most impactful routing decision.** Implementation is the highest-token phase. Getting simple tickets on Sonnet saves the most money. The null-complexity fallback routes to `powr-implement-complex` (inherit) as a conservative default — better to over-provision than to undermine the implementation on an unknown task.

Logic is in `src/commands/model-select.ts` → `selectImplementAgent()`.

#### powr-code-review

| Haiku | Sonnet | Opus |
|-------|--------|------|
| Diff < 50 lines AND single file | Default | Never |

**Rationale:** Small diffs are just pattern-matching. Sonnet handles larger reviews. Opus adds no value for checklist-based review.

#### powr-linear-writer

| Haiku | Sonnet | Opus |
|-------|--------|------|
| Always (default) | Never | Never |

**Rationale:** Formatting structured data into markdown documents. Cheapest model.

#### powr-ship-verify

| Haiku | Sonnet | Opus |
|-------|--------|------|
| 1-2 tickets, all gates passed | Default | Never |

**Rationale:** Checklist verification. Simple cases are just "read state, confirm all green."

---

## File-Based Handoff Protocol

Agents never pass content through the orchestrator. They read from files and write to files.

### Agent I/O Contract

| Agent | Reads From | Writes To | Returns to Orchestrator |
|-------|-----------|-----------|------------------------|
| powr-spec | Linear (existing tickets), user input | `.claude/specs/<name>.md` | "Spec written to {path}" (~20 tokens) |
| powr-plan | `.claude/specs/<name>.md`, codebase | `.claude/plans/<name>.md` | "Plan written to {path}" (~20 tokens) |
| powr-review | `.claude/plans/<name>.md`, user approval | Nothing (approval state only) | "All sections approved" or "Sections X,Y need revision" (~30 tokens) |
| powr-tickets | `.claude/plans/<name>.md` | Linear tickets + `.claude/ticket-summaries/<name>.json` | Ticket IDs (~50 tokens) |
| powr-investigate | Linear ticket, codebase | `.claude/handoffs/investigate-<ticket-id>.md` | "Handoff written to {path}, complexity: {Simple\|Moderate\|Complex}" (~30 tokens) |
| powr-implement | Linear ticket, `.claude/handoffs/investigate-<id>.md`, codebase | Git commits + `.claude/handoffs/implement-<id>.md` | "Handoff written to {path}" (~20 tokens) |
| powr-implement-complex | Linear ticket, `.claude/handoffs/investigate-<id>.md`, codebase | Git commits + `.claude/handoffs/implement-<id>.md` | "Handoff written to {path}" (~20 tokens) |
| powr-code-review | Git diff, `.claude/handoffs/implement-<id>.md` | `.claude/handoffs/review-<ticket-id>.md` | "Handoff written to {path}, verdict: {Approved\|Changes requested}" (~30 tokens) |
| powr-linear-writer | `.claude/handoffs/<type>-<ticket-id>.md` | Linear Document + Comment | Document URL (~30 tokens) |
| powr-ship-verify | `.claude/ticket-summaries/<name>.json`, gate check results | `.claude/handoffs/ship-<feature>.md` | "Handoff written to {path}" (~20 tokens) |
| powr-batch-worker | Linear ticket, codebase | Git commits in worktree + all handoff files | Ticket completion summary (~100 tokens) |

### Ticket Summary Cache

After `/powr plan` creates tickets, the `powr-tickets` agent writes a compact summary file:

```json
// .claude/ticket-summaries/<name>.json
[
  {
    "id": "POWR-500",
    "title": "Add OAuth provider",
    "summary": "Integrate OAuth2 with Google/GitHub providers",
    "estimate": 3,
    "labels": ["feature", "auth"],
    "deps": []
  },
  {
    "id": "POWR-501",
    "title": "Session management",
    "summary": "JWT-based sessions with refresh tokens",
    "estimate": 2,
    "labels": ["feature", "auth"],
    "deps": ["POWR-500"]
  }
]
```

This is ~200 tokens for 10 tickets vs ~5000 tokens if you fetch full descriptions from Linear. The execute orchestrator reads this file to:
1. Build the wave dependency DAG
2. Determine model selection per ticket (from estimate + labels)
3. Pass only the ticket ID to each execute agent (the agent fetches full details from Linear)

---

## Standardized Linear Output Formats

Every phase transition produces:
1. A **Linear Document** attached to the ticket with full details
2. A **Linear Comment** with a one-line timeline marker linking to the document

This keeps the comment thread scannable while preserving all detail.

### Document Templates

#### Investigation Report

Created by `powr-linear-writer` after `powr-investigate` returns findings.

```markdown
# Investigation: {TICKET_ID} — {Title}

## Codebase Findings
- {What exists, relevant files and modules, patterns found}
- {Related tickets and their established patterns}

## Affected Files
| File | Impact |
|------|--------|
| `src/auth/handler.ts` | Extend with OAuth flow |
| `src/types.ts` | Add OAuthSession type |

## Recommended Approach
1. {Step with rationale}
2. {Step with rationale}

## Risks & Dependencies
- {Risk or dependency, with mitigation if applicable}

## Complexity Assessment
{Simple | Moderate | Complex} — {one-line justification}
```

#### Implementation Summary

Created by `powr-linear-writer` after `powr-implement` returns changes.

```markdown
# Implementation: {TICKET_ID} — {Title}

## Changes
| File | Change |
|------|--------|
| `src/auth/handler.ts` | Added OAuth flow with PKCE |
| `src/types.ts` | Added OAuthSession, OAuthProvider types |

## Commits
- `abc1234` — Add OAuth provider integration
- `def5678` — Add provider configuration

## Decisions Made
- {Decision}: {Rationale}
- {Decision}: {Rationale}

## Acceptance Criteria
- [x] {AC 1}
- [x] {AC 2}
- [ ] {AC 3 — if not met, explain why}
```

#### Review Report

Created by `powr-linear-writer` after `powr-code-review` returns findings.

```markdown
# Review: {TICKET_ID} — {Title}

## Verdict
{Approved | Approved with suggestions | Changes requested}

## Issues

### Critical
- {Issue description, file:line, suggested fix}

### Warnings
- {Issue description, file:line, suggested fix}

### Suggestions
- {Improvement idea, rationale}

## Deferred Items
| Ticket | Description | Rationale |
|--------|-------------|-----------|
| POWR-510 | Refactor auth module | Planned for next sprint, not blocking |
```

#### Ship Report

One per workflow (not per ticket). Created by `powr-linear-writer` after `powr-ship-verify` returns results.

```markdown
# Ship Report: {Feature Name}

## Tickets
| Ticket | Title | Status |
|--------|-------|--------|
| POWR-500 | Add OAuth Provider | Done |
| POWR-501 | Session Management | Done |

## Verification
- Gates: {all passed / N missing — list which}
- Static analysis: {clean / N issues — list critical ones}
- Working tree: {clean / uncommitted changes — list files}

## Planned vs Delivered
- {What was in the plan but deferred}
- {What was added beyond the plan}

## Deferred Items
| Ticket | Description | Status |
|--------|-------------|--------|
| POWR-510 | Auth module refactor | Backlog |

## Open Questions
- {Anything needing follow-up}
```

### Comment Templates (Timeline Markers)

These are the one-liners posted as comments. Each links to the corresponding document.

**After investigation:**
```
**Investigation complete.** See [Investigation Report]({doc-url}).
Complexity: {Simple|Moderate|Complex}
```

**After implementation:**
```
**Implementation complete.** See [Implementation Summary]({doc-url}).
Commits: `abc1234`, `def5678`
```

**After code review:**
```
**Review complete: {Approved}.** See [Review Report]({doc-url}).
{N} items deferred.
```

**After ship:**
```
**Shipped.** See [Ship Report]({doc-url}).
All {N} tickets verified and closed.
```

### Document Creation Flow

The `powr-linear-writer` (Haiku) agent handles ALL document creation. The pattern:

1. **Phase agent** (investigate, implement, review, ship-verify) does the work
2. Phase agent returns structured findings to the orchestrator as a brief summary (~300-500 tokens)
3. **Orchestrator** spawns `powr-linear-writer` with: findings, template name, ticket ID
4. **powr-linear-writer** creates the Linear Document (`create_document`), attaches it to the ticket, posts a timeline comment with the link

Phase agents never touch Linear directly (except reading tickets and status changes). They return data; Haiku formats and posts it.

---

## Workflow Sequences

### /powr spec

```
Orchestrator                          Subagents
    │
    ├─ powr-workmaxxing start
    ├─ spawn powr-spec ──────────────► [Opus] Interview user
    │                                   ├─ Check Linear for existing work
    │                                   ├─ AskUserQuestion (interactive)
    │                                   ├─ Explore codebase
    │                                   ├─ Determine scope
    │                                   └─ Write .claude/specs/<name>.md
    │◄──── "Spec written to {path}" ──┘
    ├─ gate record spec_document_written
    ├─ advance
    └─ Tell user: "run /powr plan"
```

### /powr plan

```
Orchestrator                          Subagents
    │
    ├─ powr-workmaxxing status
    ├─ spawn powr-plan ─────────────► [Opus] Create plan
    │                                   ├─ Read .claude/specs/<name>.md
    │                                   ├─ Survey Linear ticket landscape
    │                                   ├─ Explore codebase deeply
    │                                   └─ Write .claude/plans/<name>.md
    │◄──── "Plan written to {path}" ─┘
    ├─ gate record plan_written
    │
    ├─ spawn powr-review ───────────► [Sonnet] Review plan
    │                                   ├─ Read .claude/plans/<name>.md
    │                                   ├─ Review 5 sections
    │                                   └─ AskUserQuestion for approval
    │◄──── "All sections approved" ──┘
    ├─ gate record review_* (x5)
    │
    ├─ advance (REVIEWING → TICKETING)
    ├─ spawn powr-tickets ──────────► [Haiku] Create tickets
    │                                   ├─ Read .claude/plans/<name>.md
    │                                   ├─ Check for duplicates per ticket
    │                                   ├─ Create tickets via Linear MCP
    │                                   ├─ Create detailed Document per ticket
    │                                   └─ Write .claude/ticket-summaries/<name>.json
    │◄──── ticket IDs ───────────────┘
    ├─ gate record tickets_created
    ├─ rm .claude/specs/<name>.md
    ├─ advance (TICKETING → EXECUTING)
    └─ Tell user: "run /powr execute"
```

### /powr execute (single ticket)

```
Orchestrator                          Subagents / CLI
    │
    ├─ gate record ticket_in_progress
    ├─ save_issue({ state: "In Progress" })
    │
    ├─ powr-workmaxxing model-signals <id>          ← Step 3: pre-investigation signals
    │   Parse estimate + labels → choose investigate model
    │   Log: "Model selection for powr-investigate: <model> -- <reason>"
    │
    ├─ spawn powr-investigate ──────► [Haiku|Sonnet] Investigate
    │   model override from step 3      ├─ Read ticket from Linear
    │                                   ├─ Explore codebase
    │                                   └─ Write .claude/handoffs/investigate-<id>.md
    │◄──── "Handoff written to {path}, complexity: {rating}" (~30 tokens)
    ├─ gate record investigation
    │
    ├─ spawn powr-linear-writer ────► [Haiku] Post investigation doc
    │   pass handoff file path          ├─ Read handoff file
    │                                   ├─ Create Linear Document
    │                                   └─ Post timeline comment
    │◄──── doc URL ──────────────────┘
    │
    ├─ powr-workmaxxing model-signals <id>          ← Step 6: post-investigation signals
    │   Parse complexity from handoff → route implement agent
    │   Log: "Implementation routing: <agent> -- <reason>"
    │   Simple → powr-implement (sonnet)
    │   Moderate/Complex/null → powr-implement-complex (inherit)
    │
    ├─ spawn <chosen-agent> ────────► [Sonnet|inherit] Implement
    │                                   ├─ Read ticket from Linear
    │                                   ├─ Read investigation handoff
    │                                   ├─ Write code
    │                                   ├─ Commit
    │                                   └─ Write .claude/handoffs/implement-<id>.md
    │◄──── "Handoff written to {path}" (~20 tokens)
    ├─ gate record code_committed
    │
    ├─ spawn powr-linear-writer ────► [Haiku] Post implementation doc
    │◄──── doc URL ──────────────────┘
    │
    ├─ save_issue({ state: "In Review" })
    │
    ├─ powr-workmaxxing model-signals <id> --diff   ← Step 9: diff signals
    │   Parse diffStats → choose code-review model
    │   Log: "Model selection for powr-code-review: <model> -- <reason>"
    │
    ├─ spawn powr-code-review ──────► [Haiku|Sonnet] Review
    │   model override from step 9      ├─ Read implement handoff
    │                                   ├─ Read git diff
    │                                   ├─ Apply review checklist
    │                                   └─ Write .claude/handoffs/review-<id>.md
    │◄──── "Handoff written to {path}, verdict: {Approved|...}" (~30 tokens)
    ├─ gate record coderabbit_review
    │
    ├─ spawn powr-linear-writer ────► [Haiku] Post review doc
    │◄──── doc URL ──────────────────┘
    │
    ├─ save_issue({ state: "In Human Review" })
    └─ Tell user: "Ticket complete, ready for human review"
```

### /powr execute (batch — wave-based parallel)

```
Orchestrator                          Subagents
    │
    ├─ Read ticket-summaries JSON
    ├─ Fetch relations for all tickets
    ├─ Build dependency DAG → waves
    ├─ Present wave plan to user
    │
    ├─ For each wave:
    │   ├─ For each ticket in wave (parallel):
    │   │   └─ spawn powr-batch-worker ► [inherit] in isolated worktree
    │   │       Self-contained: runs the full per-ticket chain internally
    │   │       (investigate → implement → review → document creation)
    │   │       Model selected per-ticket from ticket summary signals
    │   │
    │   ├─ Wait for all agents in wave
    │   ├─ Verify gates per ticket (powr-workmaxxing gate check-ticket)
    │   ├─ Handle blocked/failed tickets
    │   ├─ Merge verified worktrees
    │   └─ Run static analysis (powr-workmaxxing repo analyze)
    │
    └─ advance → tell user "run /powr ship"
```

Note: In batch mode, `powr-batch-worker` runs the full per-ticket chain internally because subagents cannot spawn sub-subagents. It receives a self-contained prompt with all context needed for investigate → implement → review → document creation. It posts directly to Linear without going through the orchestrator.

### /powr ship

```
Orchestrator                          Subagents
    │
    ├─ spawn powr-ship-verify ──────► [Sonnet] Verify everything
    │                                   ├─ Check all ticket gates
    │                                   ├─ Audit ticket landscape
    │                                   ├─ Run static analysis
    │                                   ├─ Check git status
    │                                   └─ Return verification results
    │◄──── results ──────────────────┘
    │
    ├─ Report findings to user
    ├─ Mark all tickets Done
    │
    ├─ spawn powr-linear-writer ────► [Haiku] Post ship report
    │   (pass verification results)     ├─ Create Ship Report Document
    │                                   └─ Post comment on each ticket
    │◄──── doc URL ──────────────────┘
    │
    ├─ rm .claude/plans/<name>.md
    ├─ gate record ship_verified
    ├─ advance (SHIPPING → IDLE)
    └─ Tell user: "Shipped!"
```

---

## Cost Analysis

### Pricing (per million tokens)

| Model | Input | Output |
|-------|-------|--------|
| Opus 4 | $15.00 | $75.00 |
| Sonnet 4 | $3.00 | $15.00 |
| Haiku 3.5 | $0.80 | $4.00 |

### Scenario: 5-Ticket Feature

Assume: 2 bug-fixes (simple, est ≤ 1), 1 moderate enhancement (est 2), 2 complex features (est ≥ 3).

#### Before: Everything in Opus (Current)

| Phase | Input Tokens | Output Tokens | Cost |
|-------|-------------|---------------|------|
| Spec (interview, explore, write) | ~25K | ~8K | $0.98 |
| Plan (explore codebase, write plan) | ~35K | ~12K | $1.43 |
| Review (5 sections, user interaction) | ~20K | ~6K | $0.75 |
| Ticket creation (5 tickets, dupe checks) | ~15K | ~8K | $0.83 |
| Execute x5 (investigate + implement + review + comments) | ~200K | ~60K | $7.50 |
| Ship (verify, audit, summaries) | ~20K | ~8K | $0.90 |
| **Total** | **~315K** | **~102K** | **$12.39** |

#### After: Dynamic Model Selection

| Phase | Agent | Model | Input | Output | Cost |
|-------|-------|-------|-------|--------|------|
| Spec | powr-spec | Opus | 25K | 8K | $0.98 |
| Plan | powr-plan | Opus | 35K | 12K | $1.43 |
| Review | powr-review | Sonnet | 20K | 6K | $0.15 |
| Tickets x5 | powr-tickets | Haiku | 12K | 6K | $0.03 |
| Ticket docs x5 | powr-linear-writer | Haiku | 10K | 8K | $0.04 |
| Investigate (2 bugs) | powr-investigate | Haiku | 12K | 3K | $0.02 |
| Investigate (3 features) | powr-investigate | Sonnet | 24K | 6K | $0.16 |
| Investigation docs x5 | powr-linear-writer | Haiku | 8K | 6K | $0.03 |
| Implement (2 bugs) | powr-implement | Sonnet | 30K | 8K | $0.21 |
| Implement (1 moderate) | powr-implement | Sonnet | 20K | 6K | $0.15 |
| Implement (2 complex) | powr-implement | Opus | 50K | 15K | $1.88 |
| Impl docs x5 | powr-linear-writer | Haiku | 8K | 6K | $0.03 |
| Code review (2 small) | powr-code-review | Haiku | 8K | 3K | $0.02 |
| Code review (3 larger) | powr-code-review | Sonnet | 24K | 6K | $0.16 |
| Review docs x5 | powr-linear-writer | Haiku | 8K | 6K | $0.03 |
| Ship verify | powr-ship-verify | Sonnet | 15K | 5K | $0.12 |
| Ship doc | powr-linear-writer | Haiku | 3K | 2K | $0.01 |
| Orchestrator overhead | SKILL.md | Sonnet | 15K | 3K | $0.09 |
| **Total** | | | **~367K** | **~121K** | **$5.54** |

#### Comparison

| Approach | 5-Ticket Feature | 15-Ticket Project | Savings |
|----------|-----------------|-------------------|---------|
| All Opus (current) | $12.39 | ~$32.00 | — |
| Hardcoded models (static) | $5.28 | ~$12.20 | 62% |
| Dynamic model selection | $5.54 | ~$10.38 | 68% |
| Dynamic + simple-mode spec/plan | ~$4.50 | ~$7.50 | 77% |

Note: Dynamic selection has slightly higher total tokens (agent overhead, document creation) but dramatically lower cost-per-token because most tokens run on cheap models.

### Where Savings Come From

| Optimization | Mechanism | Savings |
|-------------|-----------|---------|
| Investigation off Opus | Sonnet/Haiku for codebase grep-read-reason | 5-19x per token |
| All Linear writing → Haiku | Formatting structured data into markdown | 19x per token |
| Code review off Opus | Checklist-based pattern matching | 5x per token |
| Simple implementation → Sonnet | Bug fixes, small features | 5x per token |
| Reduced orchestrator context | 2K tokens loaded instead of 8K | Less waste |
| File-based handoffs | No content in orchestrator context | Less context bloat |

### Where Savings Do NOT Apply

| Phase | Why It Stays Opus |
|-------|------------------|
| Spec interview | Nuanced understanding of user intent, good follow-up questions |
| Plan creation | Deep architectural reasoning, dependency analysis, codebase understanding |
| Complex implementation | Architecture decisions, writing non-trivial code |

### Break-Even Point

- 1 simple ticket: savings are marginal (~$1.50 → ~$1.20)
- 3+ tickets: optimization pays off clearly
- 10+ tickets: proportionally better with scale

---

## File Layout

```
skills/powr/
  SKILL.md                        # ~280 lines, orchestrator + routing + state management

.claude/agents/
  powr-spec.md                    # Opus — interview + spec writing
  powr-plan.md                    # Opus — codebase exploration + plan creation
  powr-review.md                  # Sonnet — 5-section plan review
  powr-tickets.md                 # Haiku — plan → Linear tickets + summaries
  powr-investigate.md             # Sonnet — ticket investigation, writes handoff file
  powr-implement.md               # Sonnet — code implementation (Simple complexity)
  powr-implement-complex.md       # inherit — code implementation (Moderate/Complex)
  powr-code-review.md             # Sonnet — review code changes
  powr-linear-writer.md           # Haiku — create Linear Documents + comments
  powr-ship-verify.md             # Sonnet — ship verification
  powr-batch-worker.md            # inherit — end-to-end ticket in isolated worktree

.claude/specs/                    # Spec outputs (deleted after plan absorbs them)
.claude/plans/                    # Plan outputs (deleted after ship)
.claude/ticket-summaries/         # Compact ticket summaries for wave planning
.claude/handoffs/                 # Temporary reports between agents (deleted after ship)

src/commands/
  model-signals.ts                # CLI command: read estimate, labels, complexity, diff stats
  model-select.ts                 # Routing logic: selectModel(), selectImplementAgent()
```

### What the Orchestrator SKILL.md Contains

1. Decision tree (subcommand → phase routing)
2. State management (`powr-workmaxxing` CLI calls: start, gate record, advance, status)
3. Agent spawning sequences per phase
4. Dynamic model selection logic (read signals → pick model or route agent)
5. Global rules (empty response handling, file-based handoff protocol)
6. Wave parallelism logic for batch execute
7. Review mode branching (feature branch creation when reviewMode is true)

It does NOT contain:
- Detailed phase instructions (those live in agent system prompts)
- Document templates (those live in `powr-linear-writer` system prompt)
- Review checklists (those live in `powr-review` and `powr-code-review` prompts)
- Model selection thresholds (those live in `src/commands/model-select.ts`)

---

## Future Optimizations

### Simple-Mode Spec/Plan

If the user describes a straightforward fix, the orchestrator can ask:

> "This sounds like a single-ticket fix. Use streamlined mode (Sonnet, faster + cheaper) or full mode (Opus, deeper analysis)?"

Or auto-detect from scope determination: if the spec resolves to "single ticket" with estimate ≤ 2, downgrade both spec and plan to Sonnet. Saves ~$1.93 per simple feature.

### Agent Memory

Per the Claude Code docs, agents can have persistent memory across sessions:

```yaml
memory: project  # or user, local
```

Candidates for memory:
- `powr-investigate`: Remember codebase patterns, file locations, architecture decisions
- `powr-code-review`: Remember recurring issues, team conventions, past findings
- `powr-plan`: Remember architectural decisions, dependency patterns

This reduces re-exploration across sessions.

### Ticket Summary Compression

For very large projects (20+ tickets), even the summary JSON gets large. Could add a "batch summary" that groups tickets by subsystem:

```json
{
  "auth": { "tickets": 4, "total_estimate": 8, "deps_resolved": true },
  "payments": { "tickets": 3, "total_estimate": 12, "deps_resolved": false }
}
```

The orchestrator only needs this level of detail for wave planning.

---

## Implementation Status

All phases are complete:

1. **SKILL.md slimmed down** — phase instructions extracted into agent prompts, only routing remains
2. **Agent definitions created** — 11 `.md` files in `.claude/agents/`
3. **Document templates embedded** — in `powr-linear-writer` system prompt
4. **Dynamic model selection implemented** — `src/commands/model-signals.ts` + `src/commands/model-select.ts`
5. **Ticket summary cache implemented** — `powr-tickets` writes JSON, execute phase reads it
6. **State machine implemented** — `src/engine/workflow-config.ts` + `src/engine/state-machine.ts`
7. **CLI commands implemented** — `start`, `advance`, `gate`, `status`, `model-signals`, `bypass`, `repo`
