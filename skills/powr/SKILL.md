---
name: powr
description: Development workflow engine. Handles the full lifecycle — spec, plan, execute, ship. Use when the user says "/powr" followed by a subcommand (spec, plan, execute, ship) or when they want to start, plan, build, or ship a feature.
argument-hint: <spec | plan | execute | ship> [args]
allowed-tools: Bash, Agent, Read, Write, AskUserQuestion, mcp__plugin_linear_linear__save_issue, mcp__plugin_linear_linear__list_issues, mcp__plugin_linear_linear__get_issue, mcp__plugin_linear_linear__get_document, mcp__plugin_linear_linear__list_projects, mcp__plugin_linear_linear__create_document
---

# /powr — Orchestrator

Manages the workflow lifecycle by spawning specialized subagents. Each subagent creates a Linear Document with its findings and posts a short linking comment on the ticket timeline. Only ticket IDs and brief summaries flow through here.

## Decision Tree

```
/powr spec <description>     → Spec phase
/powr plan                   → Plan + review + ticket creation
/powr execute [target]       → Execute tickets with quality gates
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
- `.claude/ticket-summaries/` — compact JSON ticket data (local file)

### Dynamic Model Selection (Agent File Routing)
Before spawning certain subagents, read ticket signals via `powr-workmaxxing model-signals` and use the decision table below to choose the correct agent file. The model is baked into each agent file's YAML frontmatter — the Claude Code Agent tool does NOT support a runtime `model` parameter. Log each decision so the user sees which agent file was chosen and why.

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
- `selectModel()` in `src/commands/model-select.ts` returns an `agentFile` string — the subagent_type to pass to the Agent tool.
- **Haiku variant** is chosen when the task is bounded and well-understood: small estimates, bug-fix labels, tiny diffs, or simple ship verification. Haiku is ~19x cheaper than Opus.
- **Default (sonnet)** is used for everything else. It handles deep codebase exploration, multi-file review, and complex ship verification without needing Opus-level reasoning.
- **Fallback rule**: when any required signal is null (no estimate, no diff stats, unknown gate status), always use the default (sonnet) file, never haiku. Missing data means unknown scope — over-provision rather than under-deliver.
- **Implement routing is different**: instead of a model variant, we route to a different agent (`powr-implement` vs `powr-implement-complex`). Simple complexity -> `powr-implement` (sonnet). Moderate/Complex/unknown -> `powr-implement-complex` (inherit = user's model).

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
powr-workmaxxing gate record review_architecture --evidence '{"approved":true}' && \
powr-workmaxxing gate record review_code_quality --evidence '{"approved":true}' && \
powr-workmaxxing gate record review_tests --evidence '{"approved":true}' && \
powr-workmaxxing gate record review_performance --evidence '{"approved":true}' && \
powr-workmaxxing gate record review_ticket_decomposition --evidence '{"approved":true}'
```

### 6. Create tickets inline (replaces separate tickets agent)

Parse the `TICKETS_JSON:` block from the plan agent's output. For each ticket:

**a. Check for duplicates:**
```
mcp__plugin_linear_linear__list_issues({ query: "<title keywords>", team: "POWR", limit: 5 })
```
- If duplicate found (Done/In Progress/Todo) → skip, note in summary

**b. Create the ticket:**
```
mcp__plugin_linear_linear__save_issue({
  title: "<title>",
  team: "POWR",
  description: "<description from JSON>",
  priority: <priority>,
  estimate: <estimate>,
  project: "<project>"
})
```

**c. Set dependencies** using `blockedBy` on subsequent `save_issue` calls.

**d. Create per-ticket plan document:**
```
mcp__plugin_linear_linear__create_document({
  title: "Plan: <ticket-id> — <title>",
  content: "# <title>\n\n<description>\n\n## Implementation Steps\n<impl_steps from JSON>"
})
```

**e. Write summary JSON** to `.claude/ticket-summaries/<feature-name>.json`:
```json
{
  "feature": "<feature-name>",
  "tickets": [
    { "id": "POWR-500", "title": "...", "summary": "...", "priority": 2, "estimate": 3, "labels": ["feature"], "deps": [], "status": "created" }
  ],
  "skipped": []
}
```

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

### Review mode check
```bash
powr-workmaxxing repo info --repo "$CLAUDE_PROJECT_DIR" --json
```
Note the `reviewMode` value for per-ticket workflow.

### Resolve scope

| Input | Action |
|---|---|
| `/powr execute POWR-500` | Single ticket |
| `/powr execute` | Next unblocked ticket in current workflow |
| `/powr execute cycle "Sprint 12"` | Batch — all tickets in cycle |
| `/powr execute project "MVP"` | Batch — all tickets in project |

### Pre-fetch ticket details

For ALL tickets in scope, pre-fetch full details upfront:
```
mcp__plugin_linear_linear__get_issue({ id: "<ticket-id>", includeRelations: true })
```
Store for each: `title`, `description`, `acceptance_criteria`, `labels`, `estimate`, `dependencies`, `uuid`.

Also fetch project context once (shared across all agents):
```
mcp__plugin_linear_linear__list_issues({ project: "<project>", team: "POWR" })
```
Summarize as `project_context`: a compact list of recent/upcoming ticket titles and statuses.

Read the ticket summaries JSON for `impl_steps` per ticket (from the plan):
```
Read(".claude/ticket-summaries/<feature>.json")
```

### Classify tickets

For each ticket, check fast-path eligibility:
- **Fast-path**: `estimate <= 1` AND `labels` includes `"bug-fix"` → skip investigation entirely
- **Normal**: everything else → full investigate → implement flow

Log: "Ticket <id>: <fast-path|normal>"

### Single ticket execution

If only one ticket in scope, follow the **Execute one ticket** procedure below, then hand off.

### Multi-ticket execution (pipelined)

When executing 2+ tickets, use pipeline parallelism to overlap code-review with the next ticket's investigation.

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

**Normal tickets:** Read model signals and spawn investigate agent:
```bash
powr-workmaxxing model-signals <ticket-id> --repo "$CLAUDE_PROJECT_DIR"
```
Choose agent file per decision table:
- **powr-investigate-haiku** if `estimate <= 1` OR `labels` includes `"bug-fix"`
- **powr-investigate** (default, sonnet) otherwise

```
Agent(subagent_type="<chosen-agent-file>", prompt="
  Ticket: <ticket-id>
  Title: <title>
  Description: <description>
  Acceptance criteria: <ACs>
  Labels: <labels>
  Estimate: <estimate>
  Dependencies: <deps>
  Project: <project>
  Project context: <project_context>
")
```

```bash
powr-workmaxxing gate record investigation --ticket <ticket-id> --evidence '{"documented":true}'
```

#### 4. Route implementation agent
```bash
powr-workmaxxing model-signals <ticket-id> --repo "$CLAUDE_PROJECT_DIR"
```
- **Simple** complexity → `powr-implement`
- **Moderate/Complex/null** → `powr-implement-complex`
- **Fast-path** tickets → `powr-implement` (simple by definition)

#### 5. Implement
```
Agent(subagent_type="<chosen-agent>", prompt="
  Ticket: <ticket-id>
  Title: <title>
  Description: <description>
  Acceptance criteria: <ACs>
  Labels: <labels>
  Estimate: <estimate>
  Review mode: <on|off>
  Fast path: <true|false>
  Impl steps: <impl_steps from ticket summaries>
")
```

```bash
powr-workmaxxing gate record code_committed --ticket <ticket-id> --evidence '{"commitSha":"<sha>"}'
```

#### 6. Code review
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
  Title: <title>
  Description: <description>
  Acceptance criteria: <ACs>
  Review mode: <on|off>
")
```

If verdict is "Changes requested": re-implement with feedback, then re-review.

```bash
powr-workmaxxing gate record coderabbit_review --ticket <ticket-id> --evidence '{"documented":true}'
```

#### 7. Hand off
Try "In Human Review" first, fall back to "In Review":
```
mcp__plugin_linear_linear__save_issue({ id: "<ticket-id>", state: "In Human Review" })
```

If review mode: tell user "Changes staged on branch `feat/<ticket-id>-<desc>`."

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
Repeat Steps 4-7 for remaining waves.

After final wave:
```bash
powr-workmaxxing gate record all_tickets_done --evidence '{}'
powr-workmaxxing advance
```
Tell user: "All tickets executed. Type `/powr ship` to verify and ship."

---

## /powr ship

### 1. Read signals and spawn ship verification agent

Determine the agent file for ship verification:
1. Read the ticket-summaries JSON to count the number of tickets.
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
  Ticket summaries: .claude/ticket-summaries/<name>.json
  Workflow: <workflow-id>
  Repo: $CLAUDE_PROJECT_DIR
  Project: <project>
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

### 4. Complete
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
