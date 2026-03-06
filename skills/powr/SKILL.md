---
name: powr
description: Development workflow engine. Handles the full lifecycle — spec, plan, execute, revise, ship. Use when the user says "/powr" followed by a subcommand (spec, plan, execute, revise, ship) or when they want to start, plan, build, fix, or ship a feature.
argument-hint: <spec | plan | execute | revise | ship> [args]
allowed-tools: Bash, Agent, Read, Write, AskUserQuestion, mcp__plugin_linear_linear__save_issue, mcp__plugin_linear_linear__list_issues, mcp__plugin_linear_linear__get_issue, mcp__plugin_linear_linear__get_document, mcp__plugin_linear_linear__list_projects, mcp__plugin_linear_linear__create_document
---

# /powr — Orchestrator

Manages the workflow lifecycle by spawning specialized subagents. Each subagent creates a Linear Document with its findings and posts a short linking comment on the ticket timeline. Only ticket IDs and brief summaries flow through here.

## Decision Tree

```
/powr spec <description>     → Spec phase
/powr plan                   → Plan + review + ticket creation
/powr execute [target]       → Execute tickets with quality gates
/powr revise <ticket-id>     → Human review found issues → re-investigate → fix → review
/powr ship                   → Verify and close out
/powr status                 → Show workflow state
/powr bypass                 → Skip workflow enforcement
```

Parse the user's subcommand and follow the corresponding section below.

---

## Global Rules

### Empty Responses
Every AskUserQuestion requires a real, non-empty response. If empty/blank: do NOT proceed, do NOT infer, do NOT retry AskUserQuestion. Ask the same question in plain chat text instead.

### Linear Status Changes
Make direct calls for simple status updates (`save_issue` state changes). Subagents create Linear Documents for their findings and post short linking comments on the ticket timeline.

### Handoffs
Spec and plan documents are stored as Linear Documents. Pass document IDs (not content) to the next subagent.
- Spec → Linear Document ID from powr-spec
- Plan → Linear Document ID from powr-plan
- Tickets → Linear issues with full descriptions including impl_steps

### Context Exhaustion Handoff
If context is running low during execution (you sense compression is imminent or you're processing many tickets), you MUST output a structured handoff message to the user BEFORE context runs out. This is critical — without it, the user has no idea where to resume.

Output the handoff message to the user:
```
---
EXECUTION PAUSED — context limit reached.

Progress:
| Ticket   | Status              |
|----------|---------------------|
| POWR-500 | Done (all gates)    |
| POWR-501 | In Review (code review pending) |
| POWR-502 | Not started         |

Resume command (copy-paste this):
  /powr execute POWR-501 POWR-502

Or re-run the full scope (completed tickets auto-skip):
  /powr execute project "MVP Launch"

Workflow: <workflow-id>
Feature: <feature-name>
---
```

The resume command lists only incomplete tickets explicitly by ID so it works without any prior context. The full-scope command also works because the resume check skips completed tickets. No local state is needed — Linear and the CLI database are the sources of truth, and the resume check queries them fresh.

This also applies when:
- A batch wave completes but more waves remain
- A single ticket finishes but there are more tickets in scope
- Any unexpected interruption during execution

### Dynamic Model Selection (Inline Routing)
Use the pre-fetched ticket data (estimate, labels, complexity) to choose agent files inline. Do NOT call `powr-workmaxxing model-signals` for investigate or implement routing — the data is already available. Only call `model-signals --diff` for code-review routing (diff stats aren't available until after implementation).

Log each decision so the user sees which agent file was chosen and why.

**Decision table** (ground truth in `src/commands/model-select.ts`):

| Base Agent | Haiku Variant (agent file) | When Haiku | When Sonnet (default file) | Fallback (missing data) |
|------------|---------------------------|------------|---------------------------|------------------------|
| powr-investigate | powr-investigate-haiku | estimate <= 1 OR "bug-fix" label | estimate > 1 and no bug-fix | default (sonnet) |
| powr-code-review | powr-code-review-haiku | 1 file AND < 50 changed lines | multi-file OR >= 50 lines | default (sonnet) |
| powr-ship-verify | powr-ship-verify-haiku | 1-2 tickets AND all gates passed | 3+ tickets OR failed gates | default (sonnet) |
| powr-implement | N/A (always sonnet via agent default) | N/A | N/A | N/A |
| powr-implement-complex | N/A (always inherit via agent default) | N/A | N/A | N/A |

**How it works:**
- Each agent that supports dynamic model selection has two files: a default (sonnet) and a `-haiku` variant. Both share the same prompt body; only the `model:` frontmatter differs.
- **Investigate routing**: use pre-fetched `estimate` and `labels` directly. If `estimate <= 1` OR `labels` includes `"bug-fix"` → haiku. Otherwise → sonnet.
- **Implement routing**: use the `Complexity` returned by the investigate agent. `Simple` → `powr-implement` (sonnet). `Moderate/Complex/null` → `powr-implement-complex` (inherit).
- **Code-review routing**: this is the ONE case where you must call `model-signals --diff` because diff stats only exist after implementation.
- **Ship-verify routing**: use ticket count from pre-fetched data + gate check results. Both are already available.
- **Fallback rule**: when any required signal is null, always use the default (sonnet) file. Missing data means unknown scope.

---

## /powr spec

### 1. Start workflow
```bash
powr-workmaxxing start "<feature-name>" --repo "$CLAUDE_PROJECT_DIR"
```

### 2. Spawn spec agent
```
Agent(subagent_type="powr-spec", prompt="
  Feature: <description from user>
  Repo: $CLAUDE_PROJECT_DIR
  Team: POWR
")
```
The agent interviews the user, explores Linear and the codebase, and writes a spec as a Linear Document. It returns `SPEC_COMPLETE: <document-id>`.

### 3. Record and advance
```bash
powr-workmaxxing gate record spec_document_written --evidence '{"documentId":"<document-id>"}'
powr-workmaxxing advance
```

Tell user: "Spec complete. Use `/powr plan` to create an implementation plan."

---

## /powr plan

### 1. Check state
```bash
powr-workmaxxing status --repo "$CLAUDE_PROJECT_DIR"
```

### 2. Spawn plan agent
```
Agent(subagent_type="powr-plan", prompt="
  Spec document ID: <spec-document-id>
  Repo: $CLAUDE_PROJECT_DIR
  Team: POWR
  Project: <project-name>
")
```
Returns three blocks: `PLAN_COMPLETE: <document-id>`, `SELF_REVIEW:`, and `TICKETS_JSON:`.

### 3. Record plan gate
```bash
powr-workmaxxing gate record plan_written --evidence '{"documentId":"<plan-document-id>"}'
```

### 4. Present self-review to user (replaces separate review agent)

Parse the `SELF_REVIEW:` block from the plan agent's output. Present all 5 sections to the user using `AskUserQuestion`:

```
Plan self-review:
- Architecture: <finding>
- Code Quality: <finding>
- Tests: <finding>
- Performance: <finding>
- Ticket Decomposition: <finding>

Approve all sections, or flag any for revision?
```

- **If user approves** → continue to step 5
- **If user requests revisions** → spawn `powr-plan` again with feedback, go back to step 3
- **If user wants a deep review** → spawn `powr-review` agent as a fallback:
  ```
  Agent(subagent_type="powr-review", prompt="
    Plan document ID: <plan-document-id>
  ")
  ```

### 5. Record review gates
```bash
powr-workmaxxing gate record-batch review_architecture,review_code_quality,review_tests,review_performance,review_ticket_decomposition --evidence '{"approved":true}'
```

### 6. Create tickets inline (replaces separate tickets agent)

Parse the `TICKETS_JSON:` block from the plan agent's output. Use parallel API calls where possible.

**a. Parallel duplicate checks:**
Launch ALL duplicate checks simultaneously:
```
# All in parallel:
mcp__plugin_linear_linear__list_issues({ query: "<title keywords for ticket 1>", team: "POWR", limit: 5 })
mcp__plugin_linear_linear__list_issues({ query: "<title keywords for ticket 2>", team: "POWR", limit: 5 })
...
```
- If duplicate found (Done/In Progress/Todo) → mark as skip

**b. Create non-duplicate tickets:**
For tickets without dependencies on each other, create in parallel. Include `impl_steps` directly in the ticket description so all data lives in Linear:
```
mcp__plugin_linear_linear__save_issue({
  title: "<title>",
  team: "POWR",
  description: "<description from JSON>\n\n## Implementation Steps\n<impl_steps from JSON>",
  priority: <priority>,
  estimate: <estimate>,
  project: "<project>"
})
```

For tickets with `blockedBy` dependencies, create sequentially (need the ID of the blocking ticket first).

### 7. Record and advance
```bash
powr-workmaxxing gate record tickets_created --evidence '{"ticketIds":["POWR-500","POWR-501"]}'
powr-workmaxxing advance  # REVIEWING → TICKETING
powr-workmaxxing advance  # TICKETING → EXECUTING
```

### STOP
Tell user: "Tickets created. Type `/powr execute` to start building." Do NOT continue to execution.

---

## /powr execute

### Dry-run mode

If the user passes `--dry-run` (e.g., `/powr execute --dry-run` or `/powr execute project "MVP" --dry-run`), do NOT spawn any agents or modify any state. Instead:

1. Resolve scope (same as normal)
2. Pre-fetch ticket details (same as normal)
3. Run resume check — show which tickets would be skipped
4. Classify tickets — show fast-path vs normal
5. Build dependency waves — show wave breakdown
6. Show routing decisions per ticket:
   ```
   Dry-run execution plan:
   | Ticket   | Type      | Investigate Agent | Implement Agent       | Route    |
   |----------|-----------|-------------------|-----------------------|----------|
   | POWR-500 | normal    | powr-investigate  | powr-implement-complex| wave 1   |
   | POWR-501 | fast-path | (skip)            | powr-implement        | wave 1   |
   | POWR-502 | normal    | powr-investigate-haiku | powr-implement   | wave 1   |

   Execution mode: batch (1 wave, all independent)
   Estimated agents: 8
   ```
7. STOP. Do not execute.

### Review mode check
```bash
powr-workmaxxing repo info --repo "$CLAUDE_PROJECT_DIR" --json
```
Note the `reviewMode` value for per-ticket workflow.

### Resolve scope

| Input | Action |
|---|---|
| `/powr execute POWR-500` | Single ticket |
| `/powr execute POWR-500 POWR-501 POWR-502` | Multiple specific tickets (used for resume) |
| `/powr execute` | Next unblocked ticket in current workflow |
| `/powr execute cycle "Sprint 12"` | Batch — all tickets in cycle |
| `/powr execute project "MVP"` | Batch — all tickets in project |

### Pre-fetch ticket details

For ALL tickets in scope, pre-fetch full details upfront:
```
mcp__plugin_linear_linear__get_issue({ id: "<ticket-id>", includeRelations: true })
```
Store for each: `title`, `description`, `acceptance_criteria`, `labels`, `estimate`, `dependencies`, `uuid`.

**IMPORTANT:** The `uuid` (internal Linear ID) must be passed to every subagent prompt so they can post comments without re-fetching the ticket.

Also fetch project context once (shared across all agents):
```
mcp__plugin_linear_linear__list_issues({ project: "<project>", team: "POWR" })
```
Summarize as `project_context`: a compact list of recent/upcoming ticket titles and statuses.

The `impl_steps` are included in each ticket's description (added during plan phase) — no separate file or document needed.

### Resume check (skip completed tickets)

Before executing, check each ticket's gate status to support resuming after failures:
```bash
powr-workmaxxing gate check-ticket <ticket-id> -w <workflow-id> --json
```

- If all gates passed (`allPassed: true`) → skip this ticket, log "Ticket <id>: already complete, skipping"
- If `coderabbit_review` passed but not all gates → partial completion, investigate what's missing
- If no gates passed → normal execution

This allows `/powr execute` to resume seamlessly after a crash, context limit, or partial failure.

### Classify tickets

For each ticket, check fast-path eligibility:
- **Fast-path**: `estimate <= 1` AND `labels` includes `"bug-fix"` → skip investigation entirely
- **Normal**: everything else → full investigate → implement flow

Log: "Ticket <id>: <fast-path|normal>"

### Single ticket execution

If only one ticket in scope, follow the **Execute one ticket** procedure below, then hand off.

### Multi-ticket execution (auto-route)

When executing 2+ tickets, choose between **batch worktrees** (parallel) and **pipelined** (sequential) based on dependencies.

**Routing:**

1. Build dependency waves from the pre-fetched ticket data:
   - Wave 1: tickets with no unresolved blockers among the current batch
   - Wave 2: tickets depending only on Wave 1 tickets
   - etc.
2. **If all tickets fit in a single wave** (no inter-dependencies) → use **Batch: wave-based parallel worktrees** (below). This is the fast path — all tickets execute concurrently.
3. **If multiple waves exist** (tickets depend on each other) → use **Pipelined execution** (below) for tickets within waves that have only one ticket, and batch worktrees for waves with 2+ tickets.

Log: "Dependency analysis: <N> wave(s). Routing to <batch|pipelined|mixed>."

### Shared codebase context (multi-ticket only)

When executing 2+ tickets, accumulate a `codebase_context` string that carries forward discoveries from previous investigations. After each investigation completes, extract key findings (files, patterns, types) and append them to `codebase_context`. Pass this to the next investigate agent so it doesn't rediscover the same patterns.

Format:
```
Previous investigations found:
- <ticket-id>: key files: <paths>. Patterns: <patterns>. Types: <types>.
- <ticket-id>: ...
```

Keep it compact (< 500 tokens). Only include structural discoveries, not implementation details.

### Pipelined execution (for dependent tickets)

Use when tickets must execute sequentially due to dependencies.

**Flow:**

```
T1: investigate → implement
T1+T2: code-review(T1) ‖ investigate(T2)  ← parallel
T2: implement
T2+T3: code-review(T2) ‖ investigate(T3)  ← parallel
...
T_last: implement → code-review
```

**Algorithm:**

1. Execute the first ticket through investigate → implement (see "Execute one ticket" below, stopping after implement).
2. For each subsequent ticket T_next:
   a. Launch in **parallel**:
      - code-review for the **previous** ticket
      - investigate (or fast-path prep) for T_next
   b. Wait for both to complete.
   c. Handle code-review result for previous ticket:
      - "Approved" → record gates, hand off
      - "Changes requested" → re-implement + re-review (T_next's investigation is already done, no time wasted)
   d. Implement T_next using the completed investigation.
3. After the last ticket's implementation, run code-review alone (no next ticket to overlap with).
4. Hand off the last ticket.

---

### Execute one ticket (shared procedure)

Used by both single-ticket and multi-ticket flows.

#### 1. Branch (if review mode)
```bash
git checkout -b feat/<ticket-id>-<short-description>
```

#### 2. Mark In Progress
```
mcp__plugin_linear_linear__save_issue({ id: "<ticket-id>", state: "In Progress" })
```
```bash
powr-workmaxxing gate record ticket_in_progress --ticket <ticket-id> --evidence '{}'
```

#### 3. Investigate (skip if fast-path)

**Fast-path tickets:** Skip investigation. Record the gate and go to step 5.
```bash
powr-workmaxxing gate record investigation --ticket <ticket-id> --evidence '{"documented":true,"fastPath":true}'
```

**Normal tickets:** Choose investigate agent from pre-fetched data (no CLI call needed):
- **powr-investigate-haiku** if `estimate <= 1` OR `labels` includes `"bug-fix"`
- **powr-investigate** (default, sonnet) otherwise

```
Agent(subagent_type="<chosen-agent-file>", prompt="
  Ticket: <ticket-id>
  UUID: <uuid>
  Title: <title>
  Description: <description>
  Acceptance criteria: <ACs>
  Labels: <labels>
  Estimate: <estimate>
  Dependencies: <deps>
  Project: <project>
  Project context: <project_context>
  Codebase context: <codebase_context or 'none — first ticket'>
")
```

```bash
powr-workmaxxing gate record investigation --ticket <ticket-id> --evidence '{"documented":true}'
```

#### 4. Route implementation agent (inline — no CLI call)
Use the `Complexity` value from the investigate agent's output:
- **Simple** complexity → `powr-implement`
- **Moderate/Complex/null** → `powr-implement-complex`
- **Fast-path** tickets → `powr-implement` (simple by definition)

#### 5. Implement
```
Agent(subagent_type="<chosen-agent>", prompt="
  Ticket: <ticket-id>
  UUID: <uuid>
  Title: <title>
  Description: <description>
  Acceptance criteria: <ACs>
  Labels: <labels>
  Estimate: <estimate>
  Review mode: <on|off>
  Fast path: <true|false>
")
```

```bash
powr-workmaxxing gate record code_committed --ticket <ticket-id> --evidence '{"commitSha":"<sha>"}'
```

#### 6. Run tests

```bash
powr-workmaxxing repo test --repo "$CLAUDE_PROJECT_DIR"
```

If tests pass:
```bash
powr-workmaxxing gate record tests_passed --ticket <ticket-id> --evidence '{"testCommand":"<command>"}'
```

If tests fail: pass the failure output back to the implement agent for a targeted fix, then re-run tests. Do not proceed to code review until tests pass.

#### 7. Code review
```
mcp__plugin_linear_linear__save_issue({ id: "<ticket-id>", state: "In Review" })
```

Read diff stats:
```bash
powr-workmaxxing model-signals <ticket-id> --repo "$CLAUDE_PROJECT_DIR" --diff
```
Choose agent file per decision table:
- **powr-code-review-haiku** if 1 file AND < 50 changed lines
- **powr-code-review** (default, sonnet) otherwise

```
Agent(subagent_type="<chosen-agent-file>", prompt="
  Ticket: <ticket-id>
  UUID: <uuid>
  Title: <title>
  Description: <description>
  Acceptance criteria: <ACs>
  Review mode: <on|off>
")
```

**If verdict is "Changes requested":** Do NOT re-spawn the full implement agent. Instead, spawn a targeted fix:
```
Agent(subagent_type="powr-implement", prompt="
  Ticket: <ticket-id>
  UUID: <uuid>
  Title: <title>
  Mode: targeted-fix
  Review feedback: <specific issues from review verdict>
  Files to fix: <file:line references from review>
  Review mode: <on|off>
")
```
Then re-run tests (step 6) and re-review. Maximum 2 retry cycles — if still failing, hand off with issues noted.

```bash
powr-workmaxxing gate record coderabbit_review --ticket <ticket-id> --evidence '{"documented":true}'
```

#### 8. Hand off
Try "In Human Review" first, fall back to "In Review":
```
mcp__plugin_linear_linear__save_issue({ id: "<ticket-id>", state: "In Human Review" })
```

If review mode: tell user "Changes staged on branch `feat/<ticket-id>-<desc>`."

Tell user: "Test on device. If issues found, use `/powr revise <ticket-id>` with your feedback."

#### 9. Next-ticket message (MANDATORY)

After handing off each ticket, ALWAYS tell the user what comes next:

- **More tickets remaining in scope:** "Ticket <id> complete (`<N>/<total>`). Moving to <next-ticket-id>: <title>."
- **Last ticket in current wave (batch mode, more waves):** "Wave <N> complete (`<passed>/<count>` tickets). Starting wave <N+1>: <ticket-ids>."
- **All tickets done:** Print the execution summary table (below).
- **Context running low:** Output the Context Exhaustion Handoff (see Global Rules) with explicit resume command BEFORE continuing. Do NOT silently run out of context.

Never silently finish a ticket without stating what happens next.

#### Blocked: Manual Action
If a ticket requires non-code human action: the agent posts a comment explaining what's needed. Set to "Blocked: Manual Action", move on to next ticket.

### Batch: wave-based parallel worktrees

#### Step 1: Fetch tickets
Get all tickets for cycle/project via Linear MCP. Call `get_issue` with `includeRelations: true` for each.

#### Step 2: Build waves
- Wave 1: tickets with no unresolved blockers
- Wave 2: tickets depending only on Wave 1
- etc.

#### Step 3: Present wave plan
Show user the wave breakdown. Wait for approval before launching.

#### Step 4: Launch wave
For each ticket in the wave, spawn a parallel agent in a worktree:
```
Agent(subagent_type="powr-batch-worker", prompt="
  Workflow: <workflow-id>
  Ticket: <ticket-id>
  UUID: <uuid>
  Description: <description>
  Acceptance Criteria: <ACs>
  Project: <project>
")
```
All agents in a wave run concurrently.

#### Step 5: Post-wave verification
For each ticket in the wave:
```bash
powr-workmaxxing gate check-ticket <ticket-id> -w <workflow-id> --json
```
- **Blocked tickets**: report to user
- **Failed tickets**: report missing gates, ask user how to proceed
- Do NOT merge until user decides on failures

#### Step 6: Merge worktrees
```bash
cd <worktree> && git rebase main && cd <main-repo> && git merge --ff-only <branch>
```

#### Step 7: Static analysis
```bash
powr-workmaxxing repo analyze
```
Stop and report if critical issues found.

#### Step 8: Next wave
Tell user: "Wave <N> complete. <passed>/<total> tickets passed. Starting wave <N+1> with <count> tickets: <ids>."

If context is running low, output the Context Exhaustion Handoff (see Global Rules) before starting the next wave. The resume check will pick up where you left off.

Repeat Steps 4-7 for remaining waves.

After final wave:
```bash
powr-workmaxxing gate record all_tickets_done --evidence '{}'
powr-workmaxxing advance
```

### Execution summary

After ALL tickets complete (single, pipelined, or batch), print a summary table:

```
Execution complete.

| Ticket   | Title              | Status         | Route      | Gates              |
|----------|--------------------|----------------|------------|--------------------|
| POWR-500 | Add OAuth flow     | In Human Review| pipelined  | 5/5 passed         |
| POWR-501 | Fix login bug      | In Human Review| fast-path  | 5/5 passed         |
| POWR-502 | Refactor auth      | Blocked        | batch      | 3/5 (tests failed) |

Completed: 2/3 | Blocked: 1/3
```

Tell user: "All tickets executed. Use `/powr ship` to verify and ship, or `/powr revise <ticket-id>` if something needs fixing after testing."

---

## /powr revise

Human review found issues with an executed ticket. Re-enters the structured workflow with the user's feedback as the primary new input.

### 1. Collect feedback

The user's message IS the feedback — their text, screenshots, and observations about what's wrong. Do NOT ask them to re-explain. Capture everything they provided as `user_feedback`.

If the user only gave a ticket ID with no feedback, ask once:
```
What's wrong with <ticket-id>? Screenshots, error descriptions, or behavioral observations all help.
```

### 2. Pre-fetch ticket details

```
mcp__plugin_linear_linear__get_issue({ id: "<ticket-id>", includeRelations: true })
```

Also get the previous implementation context:
```bash
git log --oneline --grep="<ticket-id>" | head -10
```

### 3. Check revision count

Check how many revision cycles this ticket has been through by counting previous revision comments on the ticket timeline:
```
mcp__plugin_linear_linear__list_comments({ issueId: "<uuid>" })
```
Count comments containing "Revision #". If this would be revision #3+, warn the user:
```
This ticket has been revised <N> times. The approach may need rethinking.
Consider `/powr plan` to re-plan, or continue with `/powr revise` for another attempt.
```
Wait for user confirmation before proceeding.

### 4. Set ticket back to In Progress

```
mcp__plugin_linear_linear__save_issue({ id: "<ticket-id>", state: "In Progress" })
```

### 5. Investigate (revision mode)

Always use `powr-investigate` (sonnet) for revisions — understanding what went wrong requires reasoning depth regardless of estimate.

```
Agent(subagent_type="powr-investigate", prompt="
  Mode: revision
  Revision #: <N>
  Ticket: <ticket-id>
  UUID: <uuid>
  Title: <title>
  Description: <description>
  Acceptance criteria: <ACs>
  Labels: <labels>
  Estimate: <estimate>
  Project: <project>

  User feedback (THIS IS THE PRIMARY INPUT — what the human found wrong):
  <user_feedback — include full text and reference any screenshots>

  Previous implementation commits:
  <git log output for this ticket>

  Focus on: what specifically is broken based on the user's feedback, why the previous implementation didn't work, and what needs to change. Do NOT re-explore the entire codebase — focus on the delta.
")
```

```bash
powr-workmaxxing gate record investigation --ticket <ticket-id> --evidence '{"documented":true,"revision":<N>}'
```

### 6. Implement (revision mode)

Always use `powr-implement-complex` (inherit) for revisions — fixing existing code with user feedback context is inherently complex.

```
Agent(subagent_type="powr-implement-complex", prompt="
  Mode: revision
  Revision #: <N>
  Ticket: <ticket-id>
  UUID: <uuid>
  Title: <title>
  Description: <description>
  Acceptance criteria: <ACs>
  Review mode: <on|off>

  User feedback:
  <user_feedback>

  Previous implementation commits:
  <git log output>

  Build on the existing implementation. Fix what's broken based on the investigation findings. Do NOT rewrite from scratch unless the investigation explicitly calls for it.
")
```

```bash
powr-workmaxxing gate record code_committed --ticket <ticket-id> --evidence '{"commitSha":"<sha>","revision":<N>}'
```

### 7. Code review + hand off

Follow the same steps as execute (steps 6-8 from "Execute one ticket"):
- Run tests
- Code review (use diff-based model routing as normal)
- Hand off to "In Human Review"

Post a revision comment on the ticket timeline:
```
mcp__plugin_linear_linear__save_comment({
  issueId: "<uuid>",
  body: "**Revision #<N> complete.** Changes based on human review feedback:\n<1-sentence summary of what was fixed>"
})
```

Tell user: "Revision complete. Test again and use `/powr revise <ticket-id>` if more fixes needed, or `/powr ship` when ready."

---

## /powr ship

### 1. Read signals and spawn ship verification agent

Determine the agent file for ship verification:
1. Query Linear for the project's tickets to get the count and details:
   ```
   mcp__plugin_linear_linear__list_issues({ project: "<project>", team: "POWR" })
   ```
2. Check gate status for each ticket:
   ```bash
   powr-workmaxxing gate check-ticket <ticket-id> -w <workflow-id> --json
   ```
3. Apply the decision table:
   - **powr-ship-verify-haiku** if ticket count is 1-2 AND all tickets have all gates passed — verification is "read state, confirm green, format report"; no reasoning needed
   - **powr-ship-verify** (default, sonnet) if 3+ tickets — larger surface area; Sonnet provides thoroughness on multi-ticket ships
   - **powr-ship-verify** (default, sonnet) if any gates failed — failed gates require investigation: which gate, which ticket, why; Sonnet has the reasoning depth
   - **powr-ship-verify** (default, sonnet) if count or gate status is unknown — cannot confirm the happy path without complete data

Log the decision: "Agent file for ship verification: <agentFile> -- <reason>"

```
Agent(subagent_type="<chosen-agent-file>", prompt="
  Workflow: <workflow-id>
  Repo: $CLAUDE_PROJECT_DIR
  Project: <project>
  Tickets: <ticket-id-1>, <ticket-id-2>, ...
")
```

### 2. Handle issues
If issues > 0, present findings to user. Wait for resolution.
If blocked tickets exist, report them separately.

The ship-verify agent creates a Linear Document with the ship report and posts linking comments on each ticket.

### 3. Mark tickets Done
For each ticket currently "In Human Review" or "In Review":
```
mcp__plugin_linear_linear__save_issue({ id: "<ticket-id>", state: "Done" })
```

### 4. Session recap

Before closing out, print a short plain-English summary of what was accomplished. Use the pre-fetched ticket data and the ship-verify agent's output to compile it.

Format:

```
Session recap:
- <ticket-id>: <1-sentence description of what was actually done>
- <ticket-id>: <1-sentence description of what was actually done>
...
<total> ticket(s) shipped.
```

Each line should describe the concrete work — not just the ticket title. For example:
- "POWR-500: Added Google OAuth provider with token refresh and login UI"
- "POWR-501: Fixed race condition in session cleanup that caused stale tokens"

Use the ticket title, description, and acceptance criteria from the pre-fetched Linear data to write each line. Keep it to one sentence per ticket.

### 5. Complete
```bash
powr-workmaxxing gate record ship_verified --evidence '{"verified":true}'
powr-workmaxxing advance  # SHIPPING → IDLE
```

---

## /powr status
```bash
powr-workmaxxing status --repo "$CLAUDE_PROJECT_DIR"
```

## /powr bypass
```bash
powr-workmaxxing bypass --repo "$CLAUDE_PROJECT_DIR"
```
