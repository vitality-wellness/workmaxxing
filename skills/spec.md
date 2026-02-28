# /spec — Interactive Requirements Gathering

Trigger: user says "/spec" or "spec out", "write a spec for"

## Instructions

You are gathering requirements for a new feature. Follow this workflow:

1. **Start the workflow:**
   ```bash
   powr-workflow start "<feature-name>" --repo "$CLAUDE_PROJECT_DIR"
   ```

2. **Interview the user** using AskUserQuestion for each:
   - What problem does this solve?
   - Who uses it? (end user, developer, both)
   - What are the success criteria? (measurable outcomes)
   - What are the constraints? (performance, platform, backward compatibility)
   - What existing code does this touch? (explore codebase to answer this)
   - What's explicitly out of scope?

3. **Write the spec document** to `.claude/specs/<feature-name>.md` using this format:
   ```markdown
   # Feature: <name>
   ## Problem
   ## Users
   ## Success Criteria
   - [ ] criterion 1
   ## Constraints
   ## Scope
   ### In Scope
   ### Out of Scope
   ## Existing Code Impact
   ## Open Questions
   ```

4. **Record the gate and advance:**
   ```bash
   powr-workflow gate record spec_document_written --evidence '{"path":".claude/specs/<name>.md"}'
   powr-workflow advance
   ```

5. Tell the user: "Spec complete. Use `/plan` to create an implementation plan."
