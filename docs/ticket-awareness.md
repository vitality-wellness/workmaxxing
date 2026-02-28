# Ticket Awareness Checkpoints

At every stage of the workflow, Claude should be aware of what already exists in Linear.
This prevents duplicate work, informs better decisions, and keeps the big picture visible.

## Checkpoints

### 1. Spec: "Does this already exist?"

**When:** Start of /powr-spec, before interviewing the user

**Query:**
- All tickets across all projects (not just current cycle)
- All projects (active + backlog)

**Looking for:**
- Existing tickets that cover the same thing (full or partial overlap)
- Related projects or milestones that this might belong under
- Previous tickets that attempted similar work (canceled or completed — learn from them)

**Action:**
- If overlap found: show the user. "There's already POWR-342 'Add OAuth support' in the MVP Launch project. Are you extending that, or is this different?"
- If related project found: suggest adding to it instead of starting fresh
- If prior attempt found: surface what happened. "POWR-201 tried this and was canceled — notes say the API wasn't ready yet."

---

### 2. Plan: "What's the full picture?"

**When:** Start of /powr-plan, before writing the plan

**Query:**
- All tickets in the same project
- All tickets blocking or blocked by related tickets
- All tickets touching the same files/modules (infer from ticket descriptions)

**Looking for:**
- Upcoming tickets that will touch the same code (don't over-engineer or under-engineer)
- Completed tickets that established patterns (follow them)
- Dependencies that should influence step ordering
- Work that's planned but not started that this plan could conflict with

**Action:**
- Shape the plan around what's coming. "POWR-400 will refactor the auth module next sprint — keep your changes isolated to the new OAuth provider so they don't conflict."
- Note dependencies in the plan: "Step 3 depends on POWR-380 being merged first."

---

### 3. Plan → Tickets: "Does a ticket already cover this?"

**When:** During /powr-plan ticket decomposition, before creating each ticket

**Query:**
- All tickets in the project + backlog
- All sub-tickets under related parents
- Tickets with similar titles (fuzzy match)

**Looking for:**
- Exact duplicates (same title or description)
- Partial overlap (existing ticket covers half the scope)
- Tickets that could be extended instead of creating new ones

**Action:**
- Don't create a duplicate. "Step 3 of your plan is already covered by POWR-410. Linking instead of creating."
- Suggest extending: "POWR-410 covers the API side but not the UI. Should I add a sub-ticket to it, or create a separate ticket?"
- Show the user what would be created vs what already exists

---

### 4. Execute: Investigation: "Where does this fit?"

**When:** Start of investigation for each ticket

**Query:**
- All tickets in the same project/milestone
- The full dependency chain (what blocks this, what this unblocks)
- Recently completed tickets in the same area

**Looking for:**
- Big picture context: where does this ticket fit in the overall feature?
- What was just built that this builds on?
- What's coming next that this should prepare for?
- Patterns established by recently completed tickets (naming, structure, approach)

**Action:**
- Include context in the investigation comment: "This is ticket 3 of 7 in the Auth Overhaul milestone. POWR-500 and POWR-501 established the provider pattern — follow it."
- Flag if the ticket's approach might conflict with upcoming work

---

### 5. Execute: Implementation: "Am I about to break something?"

**When:** Before making significant architectural decisions during implementation

**Query:**
- All future tickets that touch the same files (grep ticket descriptions for file paths)
- All tickets in the current wave + next wave

**Looking for:**
- Future tickets that will modify the same files
- Upcoming refactors that would undo current work
- Shared utilities being built by parallel worktrees in the same wave

**Action:**
- Don't build abstractions that the next ticket will immediately change
- Don't modify shared code if another worktree in the same wave is also modifying it
- Note in commit message if something was intentionally deferred to a future ticket

---

### 6. Execute: CodeRabbit Cross-Reference: "Is this a known issue?"

**When:** After CodeRabbit review, during cross-reference

**Query:**
- ALL tickets across ALL projects and ALL cycles (not just current)
- Include backlog, future sprints, and completed tickets

**Looking for:**
- Existing tickets that already track the found issue
- Patterns of the same issue appearing in other reviews
- Future tickets that will naturally fix the issue as part of their scope

**Action:**
- "Must Fix Now" only if NO existing ticket covers it
- "Covered by POWR-450 (next sprint)" if a future ticket handles it
- "Recurring issue — POWR-300 and POWR-350 had the same finding. Consider a cross-cutting ticket."
- Create sub-tickets only for genuinely new issues

---

### 7. Execute: AC Verification: "What does completing this unblock?"

**When:** After verifying acceptance criteria pass

**Query:**
- Tickets blocked by the current ticket
- Next tickets in dependency order

**Looking for:**
- What becomes unblocked when this ticket is marked Done
- Whether the unblocked tickets are ready to start (or have other blockers)

**Action:**
- Note in the completion comment: "Completing this unblocks POWR-503 and POWR-504."
- If in batch execution, inform the wave orchestrator which tickets are now available

---

### 8. Ship: "Is anything orphaned?"

**When:** During /powr-ship, before closing the workflow

**Query:**
- All tickets in the project
- All sub-tickets under tickets we created

**Looking for:**
- Tickets we created but never executed (orphaned)
- Tickets still in "Todo" or "In Progress" that should be done
- Sub-tickets created from CodeRabbit findings that weren't resolved
- Inconsistencies between what was planned and what was built

**Action:**
- Warn: "POWR-506 was created during planning but never executed. Should it be moved to backlog or canceled?"
- Flag unresolved sub-tickets: "2 sub-tickets from CodeRabbit findings are still open."
- Summary includes: planned vs completed, deferred items, open questions

---

## Implementation

This is a skill-level concern, not a CLI concern. Each skill should include the relevant
Linear MCP queries at the right points. The queries are:

```
# Broad search (spec, cross-reference)
mcp__plugin_linear_linear__list_issues({ query: "<search terms>", team: "POWR", limit: 50 })

# Project-scoped (plan, execute)
mcp__plugin_linear_linear__list_issues({ project: "<project>", team: "POWR" })

# Dependency chain (investigation, AC verification)
mcp__plugin_linear_linear__get_issue({ id: "<id>", includeRelations: true })

# File-path search (implementation)
mcp__plugin_linear_linear__list_issues({ query: "<filename>", team: "POWR" })
```

The key insight: **always search broadly, then filter.** Don't limit to the current cycle
or project — the most useful context is often in a different project or future sprint.
