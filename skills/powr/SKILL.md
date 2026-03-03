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

**CRITICAL: You MUST actually review the plan with the user. Do NOT self-approve. Do NOT batch-record all gates. Each section requires a real conversation.**

Go through 5 sections, one at a time. For each section:
1. Analyze the plan for issues in that area
2. Present findings with numbered issues and lettered options (recommended first)
3. Use AskUserQuestion to get the user's choice
4. Only after the user approves that section, record the gate

**Section 1: Architecture**
- Component boundaries, coupling, data flow, security
- Present issues → user picks options → then record:
  ```bash
  powr-workmaxxing gate record review_architecture --evidence '{"approved":true}'
  ```

**Section 2: Code Quality**
- DRY violations, error handling, edge cases, over/under-engineering
- Present issues → user picks → then record:
  ```bash
  powr-workmaxxing gate record review_code_quality --evidence '{"approved":true}'
  ```

**Section 3: Tests**
- Coverage gaps, assertion quality, failure modes
- Present issues → user picks → then record:
  ```bash
  powr-workmaxxing gate record review_tests --evidence '{"approved":true}'
  ```

**Section 4: Performance**
- N+1 queries, memory, caching, complexity
- Present issues → user picks → then record:
  ```bash
  powr-workmaxxing gate record review_performance --evidence '{"approved":true}'
  ```

**Section 5: Ticket Decomposition**
- Clean boundaries, dependency ordering, AC clarity, scope
- Present issues → user picks → then record:
  ```bash
  powr-workmaxxing gate record review_ticket_decomposition --evidence '{"approved":true}'
  ```

**If a section has no issues:** still present it to the user — "Section 3 (Tests): No issues found. The plan includes tests for X, Y, Z. Approve?" Then record after they confirm.

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
5. **Do NOT mark ticket as Done** — hooks will block this
6. **Post a summary comment** on the ticket listing what was implemented
7. **Tell the user:**
   > "Changes staged on branch `feat/<ticket-id>-<short-description>`. Please review the diff, commit, and create a PR. Mark the ticket as Done when merged."

In review mode, skip CodeRabbit review (requires a commit), cross-referencing, and findings resolution. The human's PR review replaces these gates.

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
- If /coderabbit:review skill is available, run it. Otherwise, perform a thorough self-review:
  read every changed file, check for bugs, edge cases, security issues, style violations.
- Post review comment on ticket
- Record gate:
  powr-workmaxxing gate record coderabbit_review -w {WORKFLOW_ID} --ticket {TICKET_ID} --evidence '{"reviewUrl":"<url>"}'

## Step 5: CROSS_REFING
- Search ALL tickets for related work:
  mcp__plugin_linear_linear__list_issues({ query: "<finding keywords>", team: "POWR", limit: 50 })
  mcp__plugin_linear_linear__list_issues({ state: "backlog", team: "POWR" })
- Classify findings: "Must Fix Now" vs "Covered by existing ticket" vs "Recurring pattern"
- Post cross-reference comment on ticket
- Record gate:
  powr-workmaxxing gate record findings_crossreferenced -w {WORKFLOW_ID} --ticket {TICKET_ID} --evidence '{"commentUrl":"<url>"}'

## Step 6: FIXING
- Fix all "Must Fix Now" items from cross-referencing
- Post resolution comment on ticket
- Record gate:
  powr-workmaxxing gate record findings_resolved -w {WORKFLOW_ID} --ticket {TICKET_ID} --evidence '{"commentUrl":"<url>"}'

## Step 7: VERIFYING_ACS
- Extract ACs from ticket description
- Verify each AC against the implementation
- Post verification comment on ticket
- Record gate:
  powr-workmaxxing gate record acceptance_criteria -w {WORKFLOW_ID} --ticket {TICKET_ID} --evidence '{"commentUrl":"<url>"}'

## Completion
- Mark ticket Done in Linear:
  mcp__plugin_linear_linear__save_issue({ id: "{TICKET_ID}", state: "Done" })
- Output: "TICKET_DONE: {TICKET_ID}"
```

#### Step 5 — Post-wave verification

After all agents in a wave complete, verify every ticket passed all gates:

```bash
powr-workmaxxing gate check-ticket {TICKET_ID} -w {WORKFLOW_ID} --json
```

Run this for each ticket in the wave. If any ticket has missing gates:
1. Report which tickets failed and which gates are missing
2. Ask the user how to proceed (retry, skip, or abort)
3. Do NOT merge until the user decides

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

#### Review mode: shortened per-ticket flow

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

4. **Post summary comment** on the ticket listing what was implemented and where

5. **Tell the user:**
   > "Changes staged on branch `feat/<ticket-id>-<short-description>`. Please review the diff, commit, and create a PR. Mark the ticket as Done when merged."

6. **STOP** — do not mark Done, do not run CodeRabbit, do not cross-reference. The human's PR review replaces these gates.

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
- Run `/coderabbit:review`
- Record: `powr-workmaxxing gate record coderabbit_review --ticket <ticket-id> --evidence '{"reviewUrl":"..."}'`

#### 4. CROSS_REFING
- **Search ALL tickets** — every project, every cycle, backlog, future:
  ```
  mcp__plugin_linear_linear__list_issues({ query: "<finding keywords>", team: "POWR", limit: 50 })
  mcp__plugin_linear_linear__list_issues({ state: "backlog", team: "POWR" })
  ```
- For each finding, check if ANY existing ticket covers it
- Classify: "Must Fix Now" (no coverage) vs "Covered by POWR-450 (future)" vs "Recurring pattern"
- Post cross-reference comment
- Record: `powr-workmaxxing gate record findings_crossreferenced --ticket <ticket-id> --evidence '{"commentUrl":"..."}'`

#### 5. FIXING
- Fix all "Must Fix Now" items
- Post resolution comment
- Record: `powr-workmaxxing gate record findings_resolved --ticket <ticket-id> --evidence '{"commentUrl":"..."}'`

#### 6. VERIFYING_ACS
- Extract ACs from ticket
- Verify each AC
- Post verification comment
- Record: `powr-workmaxxing gate record acceptance_criteria --ticket <ticket-id> --evidence '{"commentUrl":"..."}'`

#### 7. DONE
- **Check what this unblocks:**
  ```
  mcp__plugin_linear_linear__get_issue({ id: "<id>", includeRelations: true })
  ```
  Note in completion comment: "Unblocks POWR-503, POWR-504."
- Mark ticket Done in Linear

### Completion

All tickets done:
```bash
powr-workmaxxing advance -w <wf-id>  # EXECUTING → SHIPPING
```
Output: EXECUTE_TICKET_DONE

---

## /powr ship

Final verification and workflow completion. **Nothing ships until everything checks out.**

### 1. Verify every ticket completed all gates

```bash
powr-workmaxxing status --repo "$CLAUDE_PROJECT_DIR" --json
```

For **each ticket** in the workflow, verify it passed through every stage:
- `investigation` — codebase explored, questions answered
- `code_committed` — implementation committed
- `coderabbit_review` — CodeRabbit review ran
- `findings_crossreferenced` — findings cross-referenced with existing Linear tickets
- `findings_resolved` — "Must Fix Now" items resolved
- `acceptance_criteria` — ACs verified against the ticket

If any ticket is **not in DONE** or skipped a gate, stop and flag it to the user. Don't proceed until resolved — either complete the missing work or get explicit user approval to ship without it.

### 2. Audit the ticket landscape

```
mcp__plugin_linear_linear__list_issues({ project: "<project>", team: "POWR" })
```
Check for:
- **Orphaned tickets** — created during planning but never executed
- **Open sub-tickets** — from CodeRabbit findings or cross-referencing that weren't resolved
- **In Review / In Progress tickets** — anything still mid-flight that should have been completed
- **Planned vs actually built** — compare the original plan against what was delivered

Report all findings before proceeding. The user decides what to do with gaps.

### 3. Run static analysis

```bash
powr-workmaxxing repo analyze
```

### 4. Verify all changes committed

No uncommitted or unstaged work. Run `git status` and confirm clean.

### 5. Post summary

- What was built (link to tickets)
- Planned vs completed — anything deferred?
- Open questions or follow-up work
- Deferred items (create backlog tickets if needed)

### 6. Clean up the plan file

The feature is shipped, tickets are the historical record:
```bash
rm .claude/plans/<name>.md
```

### 7. Complete

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
