---
name: powr
description: Development workflow engine. Handles the full lifecycle — spec, plan, execute, ship. Use when the user says "/powr" followed by a subcommand (spec, plan, execute, ship) or when they want to start, plan, build, or ship a feature.
argument-hint: <spec | plan | execute | ship> [args]
allowed-tools: Bash, Agent, Read, Write, AskUserQuestion, mcp__plugin_linear_linear__save_issue, mcp__plugin_linear_linear__list_issues, mcp__plugin_linear_linear__get_issue, mcp__plugin_linear_linear__list_projects
---

# /powr — Orchestrator

Manages the workflow lifecycle by spawning specialized subagents. Each subagent posts its own findings directly to Linear as comments. Only ticket IDs and brief summaries flow through here.

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
Make direct calls for simple status updates (`save_issue` state changes). Subagents post their own findings directly to Linear as comments — no separate writer step needed.

### File-Based Handoffs
Some subagents write outputs to files. Pass file paths (not content) to the next subagent.
- `.claude/specs/` — spec documents
- `.claude/plans/` — implementation plans
- `.claude/ticket-summaries/` — compact JSON ticket data

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
The agent interviews the user, explores Linear and the codebase, and writes a spec. It returns the spec file path.

### 3. Record and advance
```bash
powr-workmaxxing gate record spec_document_written --evidence '{"path":"<spec-path>"}'
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
  Spec: <spec-path>
  Repo: $CLAUDE_PROJECT_DIR
  Team: POWR
")
```
Returns the plan file path.

### 3. Record plan gate
```bash
powr-workmaxxing gate record plan_written --evidence '{"path":"<plan-path>"}'
```

### 4. Spawn review agent
```
Agent(subagent_type="powr-review", prompt="
  Plan: <plan-path>
")
```
Returns approval or revision request.

**If revisions needed:** Spawn `powr-plan` again with the feedback, then `powr-review` again. Repeat until approved.

### 5. Record review gates
```bash
powr-workmaxxing gate record review_architecture --evidence '{"approved":true}' && \
powr-workmaxxing gate record review_code_quality --evidence '{"approved":true}' && \
powr-workmaxxing gate record review_tests --evidence '{"approved":true}' && \
powr-workmaxxing gate record review_performance --evidence '{"approved":true}' && \
powr-workmaxxing gate record review_ticket_decomposition --evidence '{"approved":true}'
```

### 6. Advance to ticketing
```bash
powr-workmaxxing advance  # REVIEWING → TICKETING
```

### 7. Spawn tickets agent
```
Agent(subagent_type="powr-tickets", prompt="
  Plan: <plan-path>
  Team: POWR
  Project: <project-name>
")
```
Returns ticket summaries JSON path and ticket IDs.

### 8. Record and advance
```bash
powr-workmaxxing gate record tickets_created --evidence '{"ticketIds":["POWR-500","POWR-501"]}'
```

Clean up the spec (absorbed into plan and tickets):
```bash
rm .claude/specs/<name>.md
```

```bash
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

### Single ticket: chained subagents

#### 1. Review mode branch
If `reviewMode` is true, create a feature branch:
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

#### 3. Read model signals (pre-investigation)
```bash
powr-workmaxxing model-signals <ticket-id> --repo "$CLAUDE_PROJECT_DIR"
```
Parse the JSON output to get `estimate`, `labels`, and `complexity` (complexity will be null before investigation — this is expected). Use the decision table (see "Dynamic Model Selection" in Global Rules) to choose the agent file for investigation:
- **powr-investigate-haiku** if `estimate <= 1` OR `labels` includes `"bug-fix"` — small/bug tickets need only find-and-report investigation
- **powr-investigate** (default, sonnet) otherwise, including when estimate is null — unknown scope means unknown complexity; default to the safer tier

Log the decision: "Agent file for investigation: <agentFile> -- <reason>"

#### 4. Investigate
```
Agent(subagent_type="<chosen-agent-file>", prompt="
  Ticket: <ticket-id>
  Description: <brief description>
  Project: <project>
")
```
Returns complexity assessment. The agent posts its findings directly to Linear as a comment.

```bash
powr-workmaxxing gate record investigation --ticket <ticket-id> --evidence '{"documented":true}'
```

#### 5. Read model signals (post-investigation) and route implement agent
```bash
powr-workmaxxing model-signals <ticket-id> --repo "$CLAUDE_PROJECT_DIR"
```
Parse JSON to get the updated `complexity`. Route the implementation agent:
- **Simple** complexity → `subagent_type="powr-implement"` (Sonnet — bounded, well-understood implementation)
- **Moderate/Complex/null** → `subagent_type="powr-implement-complex"` (inherit — architectural decisions, cross-cutting changes, or unknown scope)

Note: this is an agent routing decision, not a model override. The two agents have different system prompts optimized for their complexity tier.

Log the decision: "Implementation routing: <agent> -- <reason>"

#### 6. Implement
```
Agent(subagent_type="<chosen-agent>", prompt="
  Ticket: <ticket-id>
  Title: <title>
  Acceptance criteria: <ACs from ticket>
  Review mode: <on|off>
")
```
The agent posts its implementation summary directly to Linear as a comment.

```bash
powr-workmaxxing gate record code_committed --ticket <ticket-id> --evidence '{"commitSha":"<sha>"}'
```

#### 7. Read diff signals and code review
```
mcp__plugin_linear_linear__save_issue({ id: "<ticket-id>", state: "In Review" })
```

Read diff stats for agent file selection:
```bash
powr-workmaxxing model-signals <ticket-id> --repo "$CLAUDE_PROJECT_DIR" --diff
```
Parse JSON to get `diffStats`. Use the decision table to choose the agent file for code review:
- **powr-code-review-haiku** if `diffStats.files === 1` AND `(diffStats.insertions + diffStats.deletions) < 50` — a single-screen change is pure pattern-matching
- **powr-code-review** (default, sonnet) if multiple files OR >= 50 changed lines — multi-file diffs need cross-file reasoning
- **powr-code-review** (default, sonnet) if `diffStats` is null — can't assess scope, default to safer tier

Log the decision: "Agent file for code review: <agentFile> -- <reason>"

```
Agent(subagent_type="<chosen-agent-file>", prompt="
  Ticket: <ticket-id>
  Title: <title>
  Review mode: <on|off>
")
```
The agent posts its review findings directly to Linear as a comment.
If verdict is "Changes requested," loop: spawn implement again with review feedback, then re-review. Re-read diff signals and re-select the agent file before each re-review.

```bash
powr-workmaxxing gate record coderabbit_review --ticket <ticket-id> --evidence '{"documented":true}'
```

#### 8. Hand off
```
mcp__plugin_linear_linear__save_issue({ id: "<ticket-id>", state: "In Human Review" })
```
If review mode: tell user "Changes staged on branch `feat/<ticket-id>-<desc>`. Please review, commit, and create a PR."

#### Blocked: Manual Action
If at any point a ticket requires non-code human action: the executing agent will post a comment on the ticket explaining what's needed. Set to "Blocked: Manual Action", move on to next ticket.

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

The ship-verify agent posts its ship report directly to Linear as comments on each ticket.

### 3. Mark tickets Done
For each ticket currently "In Human Review":
```
mcp__plugin_linear_linear__save_issue({ id: "<ticket-id>", state: "Done" })
```

### 4. Clean up
```bash
rm .claude/plans/<name>.md
```

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
