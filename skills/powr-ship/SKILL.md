---
name: powr-ship
description: Final verification and workflow completion. Checks all tickets done, runs static analysis, closes the workflow. Triggers on "/ship", "ship it", "we're done".
allowed-tools: Bash, Read, Grep, Glob, mcp__plugin_linear_linear__list_issues
---

# /ship — Final Verification and Completion

## Instructions

Final stage: verify everything is complete and close out the workflow.

1. **Check all tickets are done:**
   ```bash
   powr-workmaxxing status --repo "$CLAUDE_PROJECT_DIR" --json
   ```

2. **Run static analysis** (repo-appropriate):
   - Frontend: `dart analyze`
   - API: `go vet ./...`
   - Website: `npm run build`

3. **Verify all changes committed:**
   ```bash
   git status
   ```

4. **Post summary** — what was built, how many tickets completed, key decisions made

5. **Complete the workflow:**
   ```bash
   powr-workmaxxing gate record ship_verified --evidence '{"verified":true}'
   powr-workmaxxing advance  # SHIPPING → IDLE
   ```

6. Tell the user the workflow is complete with a summary of what was accomplished.
