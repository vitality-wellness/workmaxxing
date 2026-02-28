---
name: powr-spec
description: Interactive requirements gathering that produces a spec document. Use when the user wants to define what to build before planning. Triggers on "/spec", "spec out", "write a spec for".
argument-hint: <feature description>
allowed-tools: Bash, AskUserQuestion, Write, Read, Grep, Glob, Agent
---

# /spec — Interactive Requirements Gathering

## Instructions

You are gathering requirements for a new feature. Follow this workflow:

1. **Start the workflow:**
   ```bash
   powr-workmaxxing start "<feature-name>" --repo "$CLAUDE_PROJECT_DIR"
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
   powr-workmaxxing gate record spec_document_written --evidence '{"path":".claude/specs/<name>.md"}'
   powr-workmaxxing advance
   ```

5. Tell the user: "Spec complete. Use `/plan` to create an implementation plan."
