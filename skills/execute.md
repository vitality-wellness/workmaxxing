# /execute — Execute Tickets, Cycles, or Projects

Trigger: user says "/execute" followed by a ticket ID, cycle, project, milestone, or nothing (defaults to next unblocked ticket in current workflow)

## Resolving what to execute

Parse the user's intent and fetch the right ticket list from Linear MCP:

| User says | What to do |
|---|---|
| `/execute POWR-500` | Execute that single ticket |
| `/execute` | Next unblocked ticket in current workflow |
| `/execute cycle "Sprint 12"` | All tickets in that cycle |
| `/execute project "MVP Launch"` | All tickets in that project |
| `/execute milestone "Auth Overhaul"` | All tickets under that milestone |

### Fetching ticket lists

**Single ticket:**
```
mcp__plugin_linear_linear__get_issue({ id: "POWR-500" })
```

**Cycle:**
```
mcp__plugin_linear_linear__list_issues({ cycle: "Sprint 12", state: "unstarted", team: "POWR" })
```

**Project:**
```
mcp__plugin_linear_linear__list_issues({ project: "MVP Launch", state: "unstarted", team: "POWR" })
```

**Milestone — list sub-issues under the milestone's parent tickets:**
```
mcp__plugin_linear_linear__list_issues({ project: "<project>", state: "unstarted", team: "POWR" })
```
Then filter by milestone.

### Ordering

Sort tickets by:
1. Dependency order (unblocked tickets first)
2. Priority (Urgent > High > Normal > Low)
3. Estimate (smallest first — quick wins unblock faster)

Show the ordered list to the user before starting:
```
Ready to execute 5 tickets:
  1. POWR-500  OAuth provider setup        (High, 3pt, unblocked)
  2. POWR-501  Token exchange endpoint     (High, 5pt, blocked by POWR-500)
  3. POWR-502  Refresh token logic         (Normal, 3pt, blocked by POWR-500)
  4. POWR-503  Flutter login screen        (Normal, 5pt, blocked by POWR-501)
  5. POWR-504  E2E auth tests              (Normal, 3pt, blocked by POWR-503)

Start with POWR-500?
```

## Per-ticket execution

For each ticket, drive through the sub-workflow stages:

### 1. INVESTIGATING
- Read the ticket description and ACs from Linear
- Explore codebase: answer 5 questions (similar features, types/interfaces, utilities, state management, constraints)
- Post investigation comment to the Linear ticket
- Record: `powr-workmaxxing gate record investigation --evidence '{"commentUrl":"..."}'`

### 2. IMPLEMENTING
- Write code following investigation findings
- Commit changes
- Record: `powr-workmaxxing gate record code_committed --evidence '{"commitSha":"..."}'`

### 3. CODE_REVIEWING
- Run `/coderabbit:review`
- Record: `powr-workmaxxing gate record coderabbit_review --evidence '{"reviewUrl":"..."}'`

### 4. CROSS_REFING
- List project issues in Linear
- Classify findings: "Must Fix Now" vs "Covered by Future Tickets"
- Post cross-reference comment
- Record: `powr-workmaxxing gate record findings_crossreferenced --evidence '{"commentUrl":"..."}'`

### 5. FIXING
- Fix all "Must Fix Now" items
- Post resolution comment
- Record: `powr-workmaxxing gate record findings_resolved --evidence '{"commentUrl":"..."}'`

### 6. VERIFYING_ACS
- Extract ACs from ticket description
- Verify each AC passes
- Post verification comment
- Record: `powr-workmaxxing gate record acceptance_criteria --evidence '{"commentUrl":"..."}'`

### 7. DONE
- Mark ticket as Done in Linear:
  ```
  mcp__plugin_linear_linear__save_issue({ id: "<issue-id>", state: "Done" })
  ```
- Move to next ticket in the list

## Completion

When all tickets in the batch are done:
```bash
powr-workmaxxing advance  # EXECUTING → SHIPPING
```
Output: EXECUTE_TICKET_DONE

If executing a single ticket (not a batch), just mark it done and report back — don't advance the workflow stage.
