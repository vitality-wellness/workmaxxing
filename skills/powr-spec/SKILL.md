---
name: powr-spec
description: Interview the user to define what to build, determine scope (ticket vs project), and produce a spec document. Use when the user wants to define a feature, fix, or initiative before planning.
argument-hint: <what you want to build>
allowed-tools: Bash, AskUserQuestion, Write, Read, Grep, Glob, Agent
---

# /powr-spec — Interactive Requirements Gathering

## Instructions

You are interviewing the user to understand what they want to build. Your job is to ask the right questions, determine the scope, and write a spec document.

### Step 1: Start the workflow

```bash
powr-workmaxxing start "<feature-name>" --repo "$CLAUDE_PROJECT_DIR"
```

### Step 2: Interview

Use AskUserQuestion to have a conversation. Adapt your questions to what the user tells you — don't robotically go through a checklist. But make sure you cover:

- **What problem does this solve?** Why does this matter?
- **Who uses it?** End user, developer, internal tooling?
- **What does success look like?** Concrete, measurable outcomes.
- **What are the constraints?** Performance targets, platform requirements, backward compatibility, deadlines.
- **What's explicitly out of scope?** What are we NOT building?
- **Explore the codebase** to understand what existing code this touches. Use Agent/Grep/Read to find related code, then share what you found with the user to validate your understanding.

Ask follow-up questions. Dig into vague answers. If the user says "make it fast," ask "fast how? Sub-100ms API response? Instant UI feedback? Both?"

### Step 3: Determine scope

Based on the interview, figure out the right granularity:

| What they described | Linear structure |
|---|---|
| A small fix or tweak | Single ticket |
| A focused feature with a few parts | Ticket with sub-tickets |
| A multi-part feature touching several areas | Multiple tickets with dependencies |
| A large initiative with distinct phases | Project with milestones, tickets, and sub-tickets |

Use AskUserQuestion to confirm the scope with the user:
- "This sounds like it breaks down into 3 tickets under one parent. Does that match your expectation, or is this bigger/smaller than I'm thinking?"

### Step 4: Write the spec

Save to `.claude/specs/<feature-name>.md`:

```markdown
# Feature: <name>

## Problem
<what problem this solves and why it matters>

## Users
<who uses this and how>

## Success Criteria
- [ ] <measurable criterion>
- [ ] <measurable criterion>

## Scope
<single ticket | ticket with sub-tickets | multi-ticket | project with milestones>

### In Scope
- <thing>

### Out of Scope
- <thing>

## Constraints
- <constraint>

## Existing Code Impact
- <file/module>: <what changes>

## Open Questions
- <anything unresolved>
```

### Step 5: Record and advance

```bash
powr-workmaxxing gate record spec_document_written --evidence '{"path":".claude/specs/<name>.md"}'
powr-workmaxxing advance
```

Tell the user: "Spec complete. Use `/powr-plan` to create an implementation plan."
