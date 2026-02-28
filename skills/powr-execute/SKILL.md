---
name: powr-execute
description: Execute tickets with quality gates. Supports single tickets, cycles, projects, or milestones. Batches run in parallel worktrees by dependency wave. Triggers on "/execute", "execute POWR-500", "execute cycle", "execute project".
argument-hint: [POWR-500 | cycle "name" | project "name"]
allowed-tools: Bash, Write, Edit, Read, Grep, Glob, Agent, mcp__plugin_linear_linear__get_issue, mcp__plugin_linear_linear__list_issues, mcp__plugin_linear_linear__save_issue, mcp__plugin_linear_linear__create_comment, Skill
---

# /execute — Execute Tickets, Cycles, or Projects

## Resolving what to execute

Parse the user's intent and fetch the right ticket list from Linear MCP:

| User says | What to do |
|---|---|
| `/execute POWR-500` | Execute that single ticket (no worktree needed) |
| `/execute` | Next unblocked ticket in current workflow |
| `/execute cycle "Sprint 12"` | All tickets in that cycle — parallel worktrees |
| `/execute project "MVP Launch"` | All tickets in that project — parallel worktrees |
| `/execute milestone "Auth Overhaul"` | All tickets under that milestone — parallel worktrees |

### Fetching ticket lists

**Single ticket:**
```
mcp__plugin_linear_linear__get_issue({ id: "POWR-500", includeRelations: true })
```

**Batch (cycle/project/milestone):**
```
mcp__plugin_linear_linear__list_issues({ cycle: "Sprint 12", state: "unstarted", team: "POWR" })
```
For each ticket, also fetch relations to build the dependency graph:
```
mcp__plugin_linear_linear__get_issue({ id: "<issue-id>", includeRelations: true })
```

## Execution modes

### Single ticket → direct execution (no worktree)

If the user specified one ticket, execute it in the current session using the per-ticket workflow below.

### Batch → wave-based parallel worktrees

If the user specified a cycle, project, or milestone:

**1. Build the dependency graph**

From the fetched tickets and their `blockedBy`/`blocks` relations, construct a DAG.

**2. Compute waves**

Topologically sort tickets into waves — groups that can run in parallel:

```
Wave 1: [POWR-500, POWR-502, POWR-505]  ← no dependencies, all run simultaneously
Wave 2: [POWR-501, POWR-503]             ← unblocked after wave 1
Wave 3: [POWR-504]                        ← unblocked after wave 2
```

**3. Present the execution plan**

```
Execution plan for cycle "Sprint 12" (6 tickets):

  Wave 1 (parallel):
    POWR-500  OAuth provider setup     (High, 3pt)
    POWR-502  Refresh token logic      (Normal, 3pt)
    POWR-505  Auth config migration    (Normal, 1pt)

  Wave 2 (after wave 1):
    POWR-501  Token exchange endpoint  (High, 5pt)
    POWR-503  Flutter login screen     (Normal, 5pt)

  Wave 3 (after wave 2):
    POWR-504  E2E auth tests           (Normal, 3pt)

Start wave 1? (3 parallel worktrees)
```

**4. Execute each wave**

For each wave, launch all tickets simultaneously as background agents in worktrees:

```
Agent(
  description: "Execute POWR-500",
  subagent_type: "general-purpose",
  isolation: "worktree",
  run_in_background: true,
  prompt: "Execute ticket POWR-500 following the per-ticket workflow:
    1. Read ticket from Linear (mcp__plugin_linear_linear__get_issue)
    2. INVESTIGATE: explore codebase, post investigation comment
    3. IMPLEMENT: write code, commit
    4. CODE_REVIEW: run /coderabbit:review
    5. CROSS_REF: classify findings, post comment
    6. FIX: fix must-fix items, post comment
    7. VERIFY_ACS: verify each AC, post comment
    8. Mark Done in Linear
    Record each gate: powr-workmaxxing gate record <name> -w <workflow-id> --evidence '...'
  "
)
```

Launch ALL tickets in the wave as parallel background agents. Each gets its own worktree so code changes don't conflict.

**5. Wait for wave completion**

All agents in a wave must complete before starting the next wave. As each agent finishes, report its status:

```
Wave 1 progress:
  ✅ POWR-500  OAuth provider setup     — done (worktree merged)
  ✅ POWR-502  Refresh token logic      — done (worktree merged)
  🔄 POWR-505  Auth config migration   — implementing...
```

**6. Merge worktrees between waves**

After a wave completes, all worktrees need to be merged into main before the next wave starts (next wave's code may depend on previous wave's changes):

```bash
# For each completed worktree (smallest diff first):
git rebase main <worktree-branch>
git checkout main
git merge --ff-only <worktree-branch>
dart analyze  # or go vet, npm run build — catch semantic conflicts
```

If a merge has conflicts, stop and ask the user before continuing.

**7. Start next wave**

Repeat steps 4-6 for each wave until all tickets are done.

## Per-ticket workflow (used by both single and batch modes)

### 1. INVESTIGATING
- Read the ticket description and ACs from Linear
- **Check the big picture** — fetch all tickets in the project + dependency chain:
  ```
  mcp__plugin_linear_linear__list_issues({ project: "<project>", team: "POWR" })
  mcp__plugin_linear_linear__get_issue({ id: "<id>", includeRelations: true })
  ```
  Understand: where does this ticket fit? What was just built? What's coming next? What patterns were established?
- Explore codebase: answer 5 questions (similar features, types/interfaces, utilities, state management, constraints)
- Include project context in the investigation comment: "This is ticket 3/7 in Auth Overhaul. POWR-500 established the provider pattern — following it."
- Post investigation comment to the Linear ticket
- Record: `powr-workmaxxing gate record investigation -w <wf-id> --evidence '{"commentUrl":"..."}'`

### 2. IMPLEMENTING
- Write code following investigation findings
- Commit changes
- Record: `powr-workmaxxing gate record code_committed -w <wf-id> --evidence '{"commitSha":"..."}'`

### 3. CODE_REVIEWING
- Run `/coderabbit:review`
- Record: `powr-workmaxxing gate record coderabbit_review -w <wf-id> --evidence '{"reviewUrl":"..."}'`

### 4. CROSS_REFING
- **Search ALL tickets** — not just current cycle or project:
  ```
  mcp__plugin_linear_linear__list_issues({ query: "<finding keywords>", team: "POWR", limit: 50 })
  mcp__plugin_linear_linear__list_issues({ project: "<project>", team: "POWR" })
  mcp__plugin_linear_linear__list_issues({ state: "backlog", team: "POWR" })
  ```
- For each CodeRabbit finding, check if ANY existing ticket (any project, any cycle, backlog, future) covers it
- Classify findings:
  - "Must Fix Now" — genuinely new issue with no existing ticket
  - "Covered by POWR-450 (next sprint)" — existing future ticket handles it
  - "Recurring — also found in POWR-300, POWR-350 reviews. Consider cross-cutting ticket." — pattern across reviews
- Post cross-reference comment
- Record: `powr-workmaxxing gate record findings_crossreferenced -w <wf-id> --evidence '{"commentUrl":"..."}'`

### 5. FIXING
- Fix all "Must Fix Now" items
- Post resolution comment
- Record: `powr-workmaxxing gate record findings_resolved -w <wf-id> --evidence '{"commentUrl":"..."}'`

### 6. VERIFYING_ACS
- Extract ACs from ticket description
- Verify each AC passes
- Post verification comment
- Record: `powr-workmaxxing gate record acceptance_criteria -w <wf-id> --evidence '{"commentUrl":"..."}'`

### 7. DONE
- **Check what this unblocks:**
  ```
  mcp__plugin_linear_linear__get_issue({ id: "<id>", includeRelations: true })
  ```
  Note in the completion comment: "Completing this unblocks POWR-503 and POWR-504."
- Mark ticket as Done in Linear:
  ```
  mcp__plugin_linear_linear__save_issue({ id: "<issue-id>", state: "Done" })
  ```

## Completion

When all tickets in the batch are done:
```bash
powr-workmaxxing advance -w <wf-id>  # EXECUTING → SHIPPING
```
Output: EXECUTE_TICKET_DONE

If executing a single ticket (not a batch), just mark it done and report back — don't advance the workflow stage.
