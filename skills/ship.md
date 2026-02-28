# /ship — Final Verification and Completion

Trigger: user says "/ship" or "ship it", "we're done"

## Instructions

Final stage: verify everything is complete and close out the workflow.

1. **Check all tickets are done:**
   ```bash
   powr-workflow status --repo "$CLAUDE_PROJECT_DIR" --json
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
   powr-workflow gate record ship_verified --evidence '{"verified":true}'
   powr-workflow advance  # SHIPPING → IDLE
   ```

6. Tell the user the workflow is complete with a summary of what was accomplished.
