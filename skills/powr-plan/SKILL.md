---
name: powr-plan
description: Create an implementation plan, review it across 5 dimensions, then decompose into Linear tickets. Use when the user wants to plan how to build a feature. Triggers on "/plan", "create a plan", "plan this out".
allowed-tools: Bash, AskUserQuestion, Write, Read, Grep, Glob, Agent, EnterPlanMode, ExitPlanMode, mcp__plugin_linear_linear__save_issue, mcp__plugin_linear_linear__list_issues
---

# /plan — Plan Creation + Review + Ticket Decomposition

## Instructions

You are creating an implementation plan and decomposing it into Linear tickets.

### Phase 1: Plan Creation

1. **Check workflow state:**
   ```bash
   powr-workmaxxing status --repo "$CLAUDE_PROJECT_DIR"
   ```

2. **Read the spec** (if exists) from `.claude/specs/`

3. **Survey the ticket landscape** before planning:
   ```
   mcp__plugin_linear_linear__list_issues({ project: "<project>", team: "POWR" })
   mcp__plugin_linear_linear__list_issues({ team: "POWR", state: "backlog" })
   ```
   Look for:
   - **Upcoming tickets** touching the same code — don't plan work that conflicts
   - **Completed tickets** that established patterns — follow them
   - **Blocked tickets** that this work might unblock — note the dependency
   - **Planned refactors** — don't over-build if a refactor is coming

   Shape the plan around what exists. Reference specific tickets: "Step 3 follows the pattern from POWR-400. Step 5 should be done before POWR-450 starts."

4. **Enter plan mode** (EnterPlanMode) and explore the codebase

5. **Write the plan** to `.claude/plans/<feature-name>.md` with numbered steps, substeps, dependencies, and acceptance criteria

5. **Record gate:**
   ```bash
   powr-workmaxxing gate record plan_written --evidence '{"path":".claude/plans/<name>.md"}'
   ```

### Phase 2: Interactive Review

Before ExitPlanMode, review the plan across 5 sections. For each section:
- NUMBER issues (1, 2, 3...)
- Give LETTERS for options (A, B, C) with recommended option first
- Use AskUserQuestion for each section

**Sections:**
1. Architecture — component boundaries, coupling, data flow, security
2. Code Quality — DRY violations, error handling, edge cases, over/under-engineering
3. Tests — coverage gaps, assertion quality, untested failure modes
4. Performance — N+1 queries, memory, caching, complexity
5. Ticket Decomposition — clean ticket boundaries, dependency ordering, AC clarity, scope

After each section approved, record the gate:
```bash
powr-workmaxxing gate record review_architecture --evidence '{"approved":true}'
# ... repeat for all 5
```

### Phase 3: Ticket Creation

After all reviews pass:
```bash
powr-workmaxxing advance  # REVIEWING → TICKETING
powr-workmaxxing tickets preview .claude/plans/<name>.md --json
```

This outputs structured JSON with ticket specs. **Before creating each ticket**, check for duplicates:

```
mcp__plugin_linear_linear__list_issues({ query: "<ticket title keywords>", team: "POWR", limit: 10 })
```

- If an existing ticket covers the same scope, **link to it** instead of creating a duplicate
- If an existing ticket covers part of the scope, ask the user: extend it or create new?
- Only create genuinely new tickets

For each new spec, use the **Linear MCP** to create tickets:

```
mcp__plugin_linear_linear__save_issue({
  title: spec.title,
  description: spec.description,
  team: "POWR",
  project: "<project-name>",
  priority: spec.priority,
  estimate: spec.estimate,
  labels: spec.labels
})
```

For sub-tickets, set `parentId` to the parent issue ID. For dependencies, set `blockedBy` using the created issue identifiers.

After all tickets created:
```bash
powr-workmaxxing gate record tickets_created --evidence '{"ticketIds":["POWR-XXX","POWR-YYY"]}'
powr-workmaxxing advance  # TICKETING → EXECUTING
```

Tell the user: "Plan reviewed and tickets created. Use `/execute` to start working through them."
