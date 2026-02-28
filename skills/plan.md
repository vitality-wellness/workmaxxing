# /plan — Plan Creation + Review + Ticket Decomposition

Trigger: user says "/plan" or "create a plan", "plan this out"

## Instructions

You are creating an implementation plan and decomposing it into Linear tickets.

### Phase 1: Plan Creation

1. **Check workflow state:**
   ```bash
   powr-workflow status --repo "$CLAUDE_PROJECT_DIR"
   ```

2. **Read the spec** (if exists) from `.claude/specs/`

3. **Enter plan mode** (EnterPlanMode) and explore the codebase

4. **Write the plan** to `.claude/plans/<feature-name>.md` with numbered steps, substeps, dependencies, and acceptance criteria

5. **Record gate:**
   ```bash
   powr-workflow gate record plan_written --evidence '{"path":".claude/plans/<name>.md"}'
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
powr-workflow gate record review_architecture --evidence '{"approved":true}'
# ... repeat for all 5
```

### Phase 3: Ticket Creation

After all reviews pass:
```bash
powr-workflow advance  # REVIEWING → TICKETING
powr-workflow tickets preview .claude/plans/<name>.md
```

Show the preview to the user. After approval:
```bash
powr-workflow tickets create-from-plan .claude/plans/<name>.md --team <TEAM_ID> --project <PROJECT_ID>
powr-workflow advance  # TICKETING → EXECUTING
```

Tell the user: "Plan reviewed and tickets created. Use `/execute` to start working through them."
