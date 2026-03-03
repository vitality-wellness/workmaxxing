---
name: powr
description: Development workflow engine. Handles the full lifecycle — spec, plan, execute, ship. Use when the user says "/powr" followed by a subcommand (spec, plan, execute, ship) or when they want to start, plan, build, or ship a feature.
argument-hint: <spec | plan | execute | ship> [args]
allowed-tools: Bash, AskUserQuestion, Write, Read, Edit, Grep, Glob, Agent, EnterPlanMode, ExitPlanMode, mcp__plugin_linear_linear__save_issue, mcp__plugin_linear_linear__list_issues, mcp__plugin_linear_linear__get_issue, mcp__plugin_linear_linear__create_comment, mcp__plugin_linear_linear__list_projects, Skill
---

# /powr — Development Workflow Engine

## Decision Tree

```
/powr spec <description>     → Spec phase (interview, scope, spec doc)
/powr plan                   → Plan phase (plan, review, create tickets)
/powr execute [target]       → Execute phase (build tickets with quality gates)
/powr ship                   → Ship phase (verify, analyze, close out)
/powr status                 → Show current workflow state
/powr bypass                 → Skip workflow enforcement
```

Parse the user's subcommand and follow the corresponding section below.

---

## Global Rule: User Responses Must Be Real

Every AskUserQuestion in this workflow **requires a real, non-empty user response**. If a response comes back empty, blank, or with no selections made:
- **Do NOT proceed** as if the user approved or answered.
- **Do NOT infer** what the user would have said.
- **Do NOT retry AskUserQuestion** — it will fail again (likely bypass permissions is on).
- Instead, **immediately ask the same question in plain chat text** so the user can respond normally.

This applies to all phases: spec interviews, review approvals, scope decisions, and ticket creation.

---

## /powr spec

Interview the user to understand what they want to build.

### 1. Start the workflow

```bash
powr-workmaxxing start "<feature-name>" --repo "$CLAUDE_PROJECT_DIR"
```

### 2. Check what already exists

Before interviewing, search Linear for existing work:

```
mcp__plugin_linear_linear__list_issues({ query: "<feature keywords>", team: "POWR", limit: 30 })
mcp__plugin_linear_linear__list_projects({ team: "POWR" })
```

Look for tickets in **every status** — not just open ones:
- **Done** → already built. Tell the user: "POWR-342 'Add OAuth support' is already done. Is this an extension, or do you need something different?"
- **In Progress / In Review** → someone's actively working on it. Flag immediately to avoid duplicate effort.
- **Todo / Backlog** → planned but not started. Could extend instead of creating new scope.
- **Canceled** → previous attempt failed. Learn why before re-attempting.
- **Related projects** this might belong under.

If you find overlap in any status, tell the user immediately and ask how to proceed before continuing the interview.

Don't skip this. The user may not know what's already in Linear.

### 3. Interview

Use AskUserQuestion to have a conversation. Adapt your questions — don't robotically go through a checklist. Cover:

- **What problem does this solve?** Why does this matter?
- **Who uses it?** End user, developer, internal tooling?
- **What does success look like?** Concrete, measurable outcomes.
- **What are the constraints?** Performance targets, platform, backward compatibility, deadlines.
- **What's explicitly out of scope?**
- **Explore the codebase** to find related code, then share what you found to validate understanding.

Ask follow-ups. Dig into vague answers. **If any response comes back empty or with no selections, re-ask — do NOT proceed without real user input.** The spec depends entirely on understanding the user's intent.

### 4. Determine scope

Based on the interview, figure out the right granularity:

| What they described | Linear structure |
|---|---|
| A small fix or tweak | Single ticket |
| A focused feature with a few parts | Ticket with sub-tickets |
| Multi-part feature across several areas | Multiple tickets with dependencies |
| Large initiative with phases | Project with milestones + tickets |

Confirm with the user before proceeding.

### 5. Write the spec

Save to `.claude/specs/<feature-name>.md`:

```markdown
# Feature: <name>

## Problem
## Users
## Success Criteria
- [ ] <criterion>
## Scope
### In Scope
### Out of Scope
## Constraints
## Existing Code Impact
## Open Questions
```

### 6. Record and advance

```bash
powr-workmaxxing gate record spec_document_written --evidence '{"path":".claude/specs/<name>.md"}'
powr-workmaxxing advance
```

Tell the user: "Spec complete. Use `/powr plan` to create an implementation plan."

---

## /powr plan

Create an implementation plan, review it, then decompose into Linear tickets.

### Phase 1: Plan Creation

1. Check workflow state:
   ```bash
   powr-workmaxxing status --repo "$CLAUDE_PROJECT_DIR"
   ```

2. Read the spec (if exists) from `.claude/specs/`

3. **Survey the ticket landscape** before planning:
   ```
   mcp__plugin_linear_linear__list_issues({ project: "<project>", team: "POWR" })
   mcp__plugin_linear_linear__list_issues({ team: "POWR", state: "backlog" })
   ```
   Look for:
   - Upcoming tickets touching the same code — don't plan work that conflicts
   - Completed tickets that established patterns — follow them
   - Planned refactors — don't over-build if one is coming

   Shape the plan around what exists. Reference specific tickets.

4. Enter plan mode (EnterPlanMode) and explore the codebase

5. Write the plan to `.claude/plans/<feature-name>.md` with numbered steps, substeps, dependencies, and acceptance criteria

6. Record gate:
   ```bash
   powr-workmaxxing gate record plan_written --evidence '{"path":".claude/plans/<name>.md"}'
   ```

### Phase 2: Interactive Review

**CRITICAL: You MUST actually review the plan with the user. Do NOT self-approve. Do NOT batch-record all gates.**

Present all 5 review sections in a **single message**. For each section, analyze the plan and present your findings (issues, concerns, or "no issues found"). Then ask the user to approve all at once or flag specific sections for discussion.

**Section 1: Architecture** — Component boundaries, coupling, data flow, security

**Section 2: Code Quality** — DRY violations, error handling, edge cases, over/under-engineering

**Section 3: Tests** — Coverage gaps, assertion quality, failure modes

**Section 4: Performance** — N+1 queries, memory, caching, complexity

**Section 5: Ticket Decomposition** — Clean boundaries, dependency ordering, AC clarity, scope

After presenting all 5, ask: "Approve all sections, or flag any for discussion?"

- If the user approves all, record all 5 gates:
  ```bash
  powr-workmaxxing gate record review_architecture --evidence '{"approved":true}' && \
  powr-workmaxxing gate record review_code_quality --evidence '{"approved":true}' && \
  powr-workmaxxing gate record review_tests --evidence '{"approved":true}' && \
  powr-workmaxxing gate record review_performance --evidence '{"approved":true}' && \
  powr-workmaxxing gate record review_ticket_decomposition --evidence '{"approved":true}'
  ```
- If the user flags specific sections, discuss those sections, then record gates for the approved ones. Repeat until all 5 are approved.

### Phase 3: Ticket Creation

**Always create a Linear ticket** — even for small, single-ticket features. Every well-justified piece of scope deserves a ticket for tracking, history, and cross-referencing. Never skip ticket creation or use placeholder IDs like "no-ticket".

After all reviews pass:
```bash
powr-workmaxxing advance  # REVIEWING → TICKETING
powr-workmaxxing tickets preview .claude/plans/<name>.md --json
```

**Before creating each ticket**, check for duplicates across **all statuses** (done, in progress, in review, todo, backlog, canceled):
```
mcp__plugin_linear_linear__list_issues({ query: "<title keywords>", team: "POWR", limit: 10 })
```
- **Done** → already built. Don't re-create. Ask user if this is an extension or revision.
- **In Progress / In Review** → active work. Flag to user — extend that ticket or wait?
- **Todo / Backlog** → already planned. Link or extend instead of duplicating.
- **Canceled** → ask why before re-creating.
- Partial overlap → ask user: extend existing or create new?

For each ticket from the plan:
1. Check Linear for duplicates (all statuses) using the query above
2. Call `mcp__plugin_linear_linear__save_issue` with all required fields (title, team, description with ACs, labels, estimates, priority)
3. Collect the returned ticket identifier (e.g., "POWR-500")
4. Set dependencies between tickets using `blocks`/`blockedBy` fields

Record the gate with **real ticket IDs** from Linear (not placeholders):
```bash
powr-workmaxxing gate record tickets_created --evidence '{"ticketIds":["POWR-500","POWR-501"]}'
```

**Clean up the spec file** — it's been fully absorbed into the plan and then into tickets. Delete it so stale artifacts don't accumulate:
```bash
rm .claude/specs/<name>.md
```

```bash
powr-workmaxxing advance  # TICKETING → EXECUTING
```

### STOP — /powr plan is complete

**You are DONE. Do NOT continue to execution.**

Tell the user:
> "Tickets created. Type `/powr execute` to start building."

Then STOP. Do not proceed to the execute phase. Do not call any more tools. Do not start working on tickets. The user must explicitly invoke `/powr execute`.

---

## /powr execute

Execute tickets with quality gates. Supports single tickets or batches.

### Review Mode Check

Before executing, check if review mode is enabled:
```bash
powr-workmaxxing repo info --repo "$CLAUDE_PROJECT_DIR" --json
```

If `reviewMode` is `true`, the workflow changes:
1. **Create a feature branch** at the start:
   ```bash
   git checkout -b feat/<ticket-id>-<short-description>
   ```
2. Do investigation as normal (post findings to Linear)
3. Write code as normal
4. **Stage changes** (`git add`) but do NOT commit — hooks will block this
5. Set ticket to **"In Review"** in Linear, run CodeRabbit review on staged changes, fix issues
6. Set ticket to **"In Human Review"** in Linear
7. **Tell the user:**
   > "Changes staged on branch `feat/<ticket-id>-<short-description>`. CodeRabbit review complete. Please review the diff, commit, and create a PR."

In review mode, the human reviews on top of CodeRabbit's automated review, then commits and creates a PR.

### Resolving scope

| User says | What to do |
|---|---|
| `/powr execute POWR-500` | Single ticket, run directly |
| `/powr execute` | Next unblocked ticket in current workflow |
| `/powr execute cycle "Sprint 12"` | All tickets in cycle — parallel waves |
| `/powr execute project "MVP"` | All tickets in project — parallel waves |

### Single ticket: direct execution

Run the per-ticket workflow below in the current session.

### Batch: wave-based parallel worktrees

#### Step 1 — Resolve tickets

Fetch all tickets for the cycle/project via Linear MCP. For each, call `get_issue` with `includeRelations: true` to capture blockers.

#### Step 2 — Build dependency DAG + waves

Group tickets into waves:
- **Wave 1**: tickets with no unresolved blockers
- **Wave 2**: tickets that depend only on Wave 1 completions
- etc.

#### Step 3 — Present wave plan

Show the user the wave breakdown. Wait for approval before launching.

#### Step 4 — Launch wave

For each ticket in the wave, spawn a parallel Agent with `isolation: "worktree"`. Each agent receives the self-contained prompt template below. All agents in a wave run concurrently.

**Agent prompt template** (substitute `{TICKET_ID}`, `{WORKFLOW_ID}`, `{TICKET_DESCRIPTION}`, `{ACCEPTANCE_CRITERIA}`, `{PROJECT_NAME}`):

```
You are executing ticket {TICKET_ID} in an isolated worktree.

Workflow ID: {WORKFLOW_ID}
Ticket: {TICKET_ID}
Description: {TICKET_DESCRIPTION}
Acceptance Criteria: {ACCEPTANCE_CRITERIA}
Project: {PROJECT_NAME}

IMPORTANT: You are in a worktree — always pass `-w {WORKFLOW_ID}` on every powr-workmaxxing command.

IMPORTANT: If at any point you determine this ticket requires a non-code human action you cannot perform
(e.g., obtaining an API key, configuring an external service, physical setup), post a comment explaining
what's needed, set the ticket to "Blocked: Manual Action", and output: "TICKET_BLOCKED: {TICKET_ID}".

## Step 1: Mark In Progress
mcp__plugin_linear_linear__save_issue({ id: "{TICKET_ID}", state: "In Progress" })
powr-workmaxxing gate record ticket_in_progress -w {WORKFLOW_ID} --ticket {TICKET_ID} --evidence '{}'

## Step 2: INVESTIGATING
- Read ticket description and ACs from Linear
- Fetch all project tickets for context:
  mcp__plugin_linear_linear__list_issues({ project: "{PROJECT_NAME}", team: "POWR" })
  mcp__plugin_linear_linear__get_issue({ id: "{TICKET_ID}", includeRelations: true })
- Explore codebase: similar features, types, utilities, state, constraints
- Post investigation comment on the ticket via Linear MCP
- Record gate:
  powr-workmaxxing gate record investigation -w {WORKFLOW_ID} --ticket {TICKET_ID} --evidence '{"commentUrl":"<url>"}'

## Step 3: IMPLEMENTING
- Write code following investigation findings
- Commit changes (include meaningful commit message)
- Record gate:
  powr-workmaxxing gate record code_committed -w {WORKFLOW_ID} --ticket {TICKET_ID} --evidence '{"commitSha":"<sha>"}'

## Step 4: CODE_REVIEWING
- Set ticket to "In Review" in Linear:
  mcp__plugin_linear_linear__save_issue({ id: "{TICKET_ID}", state: "In Review" })
- If /coderabbit:review skill is available, run it. Otherwise, perform a thorough self-review:
  read every changed file, check for bugs, edge cases, security issues, style violations.
- Post review comment on ticket
- Record gate:
  powr-workmaxxing gate record coderabbit_review -w {WORKFLOW_ID} --ticket {TICKET_ID} --evidence '{"reviewUrl":"<url>"}'

## Completion
- Set ticket to "In Human Review" in Linear (NOT Done — the human will review and mark Done during shipping):
  mcp__plugin_linear_linear__save_issue({ id: "{TICKET_ID}", state: "In Human Review" })
- Output: "TICKET_DONE: {TICKET_ID}"
```

#### Step 5 — Post-wave verification

After all agents in a wave complete, verify every ticket passed all gates:

```bash
powr-workmaxxing gate check-ticket {TICKET_ID} -w {WORKFLOW_ID} --json
```

Run this for each ticket in the wave.
- **Blocked tickets** (output "TICKET_BLOCKED"): report to the user which tickets need manual action and why. These are excluded from merge — the human handles them separately.
- **Failed tickets** (missing gates): report which tickets failed and which gates are missing. Ask the user how to proceed (retry, skip, or abort).
- Do NOT merge until the user decides on any failures.

#### Step 6 — Merge verified worktrees

For each verified worktree:
```bash
cd <worktree-path> && git rebase main && cd <main-repo> && git merge --ff-only <worktree-branch>
```

#### Step 7 — Static analysis after merge

```bash
powr-workmaxxing repo analyze
```

If critical issues found, stop and report before proceeding to the next wave.

#### Step 8 — Next wave / completion

Repeat Steps 4-7 for each remaining wave.

After the final wave, record the batch completion gate and advance:

```bash
powr-workmaxxing gate record all_tickets_done -w {WORKFLOW_ID} --evidence '{}'
powr-workmaxxing advance -w {WORKFLOW_ID}
```

The advance command will print a stop directive. STOP. Tell the user: "All tickets executed. Type `/powr ship` to verify and ship." Do not call any more tools.

### Per-ticket workflow

**Immediately** mark the ticket In Progress in Linear (the `ticket_in_progress` gate auto-records via hook):

```
mcp__plugin_linear_linear__save_issue({ id: "<ticket-id>", state: "In Progress" })
```

**If review mode is ON**, follow the shortened flow below. Otherwise, follow the full flow.

#### Review mode: per-ticket flow

1. **Create a feature branch** (if not already on one):
   ```bash
   git checkout -b feat/<ticket-id>-<short-description>
   ```

2. **INVESTIGATING** — same as normal:
   - Read ticket description and ACs from Linear
   - Explore codebase: 5 questions (similar features, types, utilities, state, constraints)
   - Post investigation comment on the ticket
   - Record: `powr-workmaxxing gate record investigation --ticket <ticket-id> --evidence '{"commentUrl":"..."}'`

3. **IMPLEMENTING** — write code but do NOT commit:
   - Write code following investigation findings
   - Stage changes with `git add` (hooks block `git commit` in review mode)
   - Record gate manually with HEAD (no commit to auto-record from):
     `powr-workmaxxing gate record code_committed --ticket <ticket-id> --evidence '{"commitSha":"'$(git rev-parse HEAD)'"}'`

4. **CODE_REVIEWING** — set ticket to "In Review", run `/coderabbit:review` on the staged changes. Post review comment on ticket. Fix any issues found, re-stage.
   - Record: `powr-workmaxxing gate record coderabbit_review --ticket <ticket-id> --evidence '{"reviewUrl":"..."}'`

5. **Set ticket to "In Human Review"** in Linear:
   ```
   mcp__plugin_linear_linear__save_issue({ id: "<ticket-id>", state: "In Human Review" })
   ```

6. **Tell the user:**
   > "Changes staged on branch `feat/<ticket-id>-<short-description>`. CodeRabbit review complete. Please review the diff, commit, and create a PR."

7. **STOP** — do not commit. The human reviews, commits, creates a PR, and merges.

#### Blocked: Manual Action

At any point during a ticket — investigation, implementation, or review — if you determine the ticket **requires a non-code human action** that you cannot perform (e.g., obtaining an API key from a third-party website, configuring an external dashboard, signing up for a service, physical device setup), do the following:

1. **Post a comment** on the ticket explaining exactly what manual action is needed, with step-by-step instructions if possible
2. **Set the ticket to "Blocked: Manual Action"**:
   ```
   mcp__plugin_linear_linear__save_issue({ id: "<ticket-id>", state: "Blocked: Manual Action" })
   ```
3. **Move on to the next ticket** — do not wait. The human will complete the manual action and move the ticket back to "Todo" or "In Progress" when ready.

During batch execution, tickets set to "Blocked: Manual Action" are excluded from the `all_tickets_done` check — they're handled separately by the human.

#### Full per-ticket flow (review mode OFF)

#### 1. INVESTIGATING
- Read ticket description and ACs from Linear
- **Check the big picture** — fetch all project tickets + dependency chain:
  ```
  mcp__plugin_linear_linear__list_issues({ project: "<project>", team: "POWR" })
  mcp__plugin_linear_linear__get_issue({ id: "<id>", includeRelations: true })
  ```
  Understand where this fits. What was just built. What's coming next.
- Explore codebase: 5 questions (similar features, types, utilities, state, constraints)
- Post investigation comment with project context
- Record: `powr-workmaxxing gate record investigation --ticket <ticket-id> --evidence '{"commentUrl":"..."}'`

#### 2. IMPLEMENTING
- Write code following investigation findings
- Commit changes (the `code_committed` gate auto-records via post-commit hook with the real SHA)

#### 3. CODE_REVIEWING
- Set ticket to "In Review":
  `mcp__plugin_linear_linear__save_issue({ id: "<ticket-id>", state: "In Review" })`
- Run `/coderabbit:review`
- Record: `powr-workmaxxing gate record coderabbit_review --ticket <ticket-id> --evidence '{"reviewUrl":"..."}'`

#### 4. HAND OFF TO HUMAN
- **Check what this unblocks:**
  ```
  mcp__plugin_linear_linear__get_issue({ id: "<id>", includeRelations: true })
  ```
  Note in completion comment: "Unblocks POWR-503, POWR-504."
- Set ticket to **"In Human Review"** in Linear (NOT Done):
  ```
  mcp__plugin_linear_linear__save_issue({ id: "<ticket-id>", state: "In Human Review" })
  ```
- The human will cross-reference findings, verify ACs, and mark Done during the shipping phase

### Completion

All tickets done:
```bash
powr-workmaxxing advance -w <wf-id>  # EXECUTING → SHIPPING
```
Output: EXECUTE_TICKET_DONE

---

## /powr ship

Final verification, marking tickets Done, and workflow completion. **Nothing ships until everything checks out.**

### 1. Verify every ticket completed all gates

```bash
powr-workmaxxing status --repo "$CLAUDE_PROJECT_DIR" --json
```

For **each ticket** in the workflow, verify it passed through every stage:
- `ticket_in_progress` — ticket marked In Progress
- `investigation` — codebase explored, questions answered
- `code_committed` — implementation committed
- `coderabbit_review` — CodeRabbit review ran

Tickets should be in "In Human Review" status in Linear. If any ticket skipped a gate, stop and flag it to the user. Don't proceed until resolved — either complete the missing work or get explicit user approval to ship without it.

Tickets in **"Blocked: Manual Action"** are reported separately — they need human intervention before they can ship.

### 2. Audit the ticket landscape

```
mcp__plugin_linear_linear__list_issues({ project: "<project>", team: "POWR" })
```
Check for:
- **Blocked tickets** — anything in "Blocked: Manual Action" that still needs human intervention
- **Orphaned tickets** — created during planning but never executed
- **In Progress tickets** — anything still mid-flight that should have been completed
- **Planned vs actually built** — compare the original plan against what was delivered

Report all findings before proceeding. The user decides what to do with gaps.

### 3. Run static analysis

```bash
powr-workmaxxing repo analyze
```

### 4. Verify all changes committed

No uncommitted or unstaged work. Run `git status` and confirm clean.

### 5. Mark all tickets as Done

For **each ticket** in the workflow that is currently "In Human Review":
```
mcp__plugin_linear_linear__save_issue({ id: "<ticket-id>", state: "Done" })
```

This is when tickets officially close — after the human has had a chance to review them.

### 6. Post summary

- What was built (link to tickets)
- Planned vs completed — anything deferred?
- Open questions or follow-up work
- Deferred items (create backlog tickets if needed)

### 7. Clean up the plan file

The feature is shipped, tickets are the historical record:
```bash
rm .claude/plans/<name>.md
```

### 8. Complete

```bash
powr-workmaxxing gate record ship_verified --evidence '{"verified":true}'
powr-workmaxxing advance  # SHIPPING → IDLE
```

---

## /powr status

Shortcut:
```bash
powr-workmaxxing status --repo "$CLAUDE_PROJECT_DIR"
```

## /powr bypass

Shortcut:
```bash
powr-workmaxxing bypass --repo "$CLAUDE_PROJECT_DIR"
```
