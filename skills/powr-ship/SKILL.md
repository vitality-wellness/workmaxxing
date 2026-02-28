---
name: powr-ship
description: Final verification and workflow completion. Checks all tickets done, catches orphans, runs static analysis, closes the workflow. Triggers on "/ship", "ship it", "we're done".
allowed-tools: Bash, Read, Grep, Glob, mcp__plugin_linear_linear__list_issues, mcp__plugin_linear_linear__get_issue
---

# /ship — Final Verification and Completion

## Instructions

Final stage: verify everything is complete and close out the workflow.

1. **Check all tickets are done:**
   ```bash
   powr-workmaxxing status --repo "$CLAUDE_PROJECT_DIR" --json
   ```

2. **Audit the ticket landscape:**
   ```
   mcp__plugin_linear_linear__list_issues({ project: "<project>", team: "POWR" })
   ```
   Look for:
   - **Orphaned tickets** — created during planning but never executed. Should they move to backlog or be canceled?
   - **Open sub-tickets** — from CodeRabbit findings that weren't resolved. Flag them.
   - **Tickets still in Todo/In Progress** — that should be done but aren't.
   - **Planned vs built** — did we build everything we planned? List anything deferred.

   Report what you find to the user before proceeding.

3. **Run static analysis** (repo-appropriate):
   ```bash
   powr-workmaxxing repo analyze
   ```

4. **Verify all changes committed:**
   ```bash
   git status
   ```

5. **Post summary** — include:
   - What was built (features, key decisions)
   - Tickets: planned vs completed vs deferred
   - Open items (orphaned tickets, unresolved sub-tickets)
   - Total effort (points completed)

6. **Complete the workflow:**
   ```bash
   powr-workmaxxing gate record ship_verified --evidence '{"verified":true}'
   powr-workmaxxing advance  # SHIPPING → IDLE
   ```
