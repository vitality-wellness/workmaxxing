# /execute — Ticket-by-Ticket Execution with Gates

Trigger: user says "/execute" or "execute", "start working on tickets"

## Instructions

You are executing tickets from the workflow, one at a time, with gate enforcement.

1. **Check status:**
   ```bash
   powr-workmaxxing status --repo "$CLAUDE_PROJECT_DIR" --json
   ```

2. **Show available tickets** sorted by dependency order (unblocked first)

3. **For each ticket**, drive through the sub-workflow stages:

### INVESTIGATING
- Explore codebase: answer 5 questions (similar features, types, utilities, state, constraints)
- Post investigation comment to the Linear ticket
- Record: `powr-workmaxxing gate record investigation --evidence '{"commentUrl":"..."}'`

### IMPLEMENTING
- Write code following investigation findings
- Commit changes
- Record: `powr-workmaxxing gate record code_committed --evidence '{"commitSha":"..."}'`

### CODE_REVIEWING
- Run `/coderabbit:review`
- Record: `powr-workmaxxing gate record coderabbit_review --evidence '{"reviewUrl":"..."}'`

### CROSS_REFING
- List project issues in Linear
- Classify findings: "Must Fix Now" vs "Covered by Future Tickets"
- Post cross-reference comment
- Record: `powr-workmaxxing gate record findings_crossreferenced --evidence '{"commentUrl":"..."}'`

### FIXING
- Fix all "Must Fix Now" items
- Post resolution comment
- Record: `powr-workmaxxing gate record findings_resolved --evidence '{"commentUrl":"..."}'`

### VERIFYING_ACS
- Extract ACs from ticket description
- Verify each AC
- Post verification comment
- Record: `powr-workmaxxing gate record acceptance_criteria --evidence '{"commentUrl":"..."}'`

### DONE
- Mark ticket as Done in Linear
- Move to next ticket

4. When all tickets done:
   ```bash
   powr-workmaxxing advance  # EXECUTING → SHIPPING
   ```
   Output: EXECUTE_TICKET_DONE
