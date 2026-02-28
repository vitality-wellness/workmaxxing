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

Look for:
- **Existing tickets** that cover the same thing (full or partial overlap)
- **Related projects** this might belong under
- **Previous attempts** (canceled or completed — learn from them)

If you find overlap, tell the user immediately:
- "There's POWR-342 'Add OAuth support' in MVP Launch. Are you extending that, or is this different?"

Don't skip this. The user may not know what's already in Linear.

### 3. Interview

Use AskUserQuestion to have a conversation. Adapt your questions — don't robotically go through a checklist. Cover:

- **What problem does this solve?** Why does this matter?
- **Who uses it?** End user, developer, internal tooling?
- **What does success look like?** Concrete, measurable outcomes.
- **What are the constraints?** Performance targets, platform, backward compatibility, deadlines.
- **What's explicitly out of scope?**
- **Explore the codebase** to find related code, then share what you found to validate understanding.

Ask follow-ups. Dig into vague answers.

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

Before ExitPlanMode, review the plan across 5 sections. For each:
- NUMBER issues (1, 2, 3...)
- Give LETTERS for options (A, B, C) with recommended first
- Use AskUserQuestion

**Sections:**
1. Architecture — component boundaries, coupling, data flow, security
2. Code Quality — DRY violations, error handling, edge cases
3. Tests — coverage gaps, assertion quality, failure modes
4. Performance — N+1 queries, memory, caching, complexity
5. Ticket Decomposition — clean boundaries, dependency ordering, AC clarity

Record each gate after approval:
```bash
powr-workmaxxing gate record review_architecture --evidence '{"approved":true}'
```

### Phase 3: Ticket Creation

After all reviews pass:
```bash
powr-workmaxxing advance  # REVIEWING → TICKETING
powr-workmaxxing tickets preview .claude/plans/<name>.md --json
```

**Before creating each ticket**, check for duplicates:
```
mcp__plugin_linear_linear__list_issues({ query: "<title keywords>", team: "POWR", limit: 10 })
```
- Existing ticket covers same scope → link instead of duplicate
- Partial overlap → ask user: extend or create new?

Create tickets via Linear MCP. Set dependencies, labels, estimates, ACs.

```bash
powr-workmaxxing gate record tickets_created --evidence '{"ticketIds":["POWR-XXX"]}'
powr-workmaxxing advance  # TICKETING → EXECUTING
```

---

## /powr execute

Execute tickets with quality gates. Supports single tickets or batches.

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

1. Build dependency DAG from ticket relations
2. Group into waves (independent tickets together)
3. Present execution plan, wait for approval
4. Launch each wave as parallel background agents in worktrees
5. Merge worktrees between waves (rebase + ff-only)
6. Run static analysis after merge
7. Next wave

### Per-ticket workflow

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
- Record: `powr-workmaxxing gate record investigation -w <wf-id> --evidence '{"commentUrl":"..."}'`

#### 2. IMPLEMENTING
- Write code following investigation findings
- Commit changes
- Record: `powr-workmaxxing gate record code_committed -w <wf-id> --evidence '{"commitSha":"..."}'`

#### 3. CODE_REVIEWING
- Run `/coderabbit:review`
- Record: `powr-workmaxxing gate record coderabbit_review -w <wf-id> --evidence '{"reviewUrl":"..."}'`

#### 4. CROSS_REFING
- **Search ALL tickets** — every project, every cycle, backlog, future:
  ```
  mcp__plugin_linear_linear__list_issues({ query: "<finding keywords>", team: "POWR", limit: 50 })
  mcp__plugin_linear_linear__list_issues({ state: "backlog", team: "POWR" })
  ```
- For each finding, check if ANY existing ticket covers it
- Classify: "Must Fix Now" (no coverage) vs "Covered by POWR-450 (future)" vs "Recurring pattern"
- Post cross-reference comment
- Record: `powr-workmaxxing gate record findings_crossreferenced -w <wf-id> --evidence '{"commentUrl":"..."}'`

#### 5. FIXING
- Fix all "Must Fix Now" items
- Post resolution comment
- Record: `powr-workmaxxing gate record findings_resolved -w <wf-id> --evidence '{"commentUrl":"..."}'`

#### 6. VERIFYING_ACS
- Extract ACs from ticket
- Verify each AC
- Post verification comment
- Record: `powr-workmaxxing gate record acceptance_criteria -w <wf-id> --evidence '{"commentUrl":"..."}'`

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

Final verification and workflow completion.

1. Check all tickets done:
   ```bash
   powr-workmaxxing status --repo "$CLAUDE_PROJECT_DIR" --json
   ```

2. **Audit the ticket landscape:**
   ```
   mcp__plugin_linear_linear__list_issues({ project: "<project>", team: "POWR" })
   ```
   - Orphaned tickets (created but never executed)?
   - Open sub-tickets from CodeRabbit findings?
   - Planned vs actually built?
   Report findings before proceeding.

3. Run static analysis:
   ```bash
   powr-workmaxxing repo analyze
   ```

4. Verify all changes committed

5. Post summary: what was built, planned vs completed, deferred items, open questions

6. Complete:
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
