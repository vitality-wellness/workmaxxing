# Implementation: SUNDAE-2421 — Fix model selection to route to agent files instead of runtime model parameter

## Changes
| File | Change |
|------|--------|
| `.claude/agents/powr-investigate-haiku.md` | Created haiku variant of powr-investigate (model: haiku in frontmatter, same prompt body) |
| `.claude/agents/powr-code-review-haiku.md` | Created haiku variant of powr-code-review (model: haiku in frontmatter, same prompt body) |
| `.claude/agents/powr-ship-verify-haiku.md` | Created haiku variant of powr-ship-verify (model: haiku in frontmatter, same prompt body) |
| `src/commands/model-select.ts` | Changed `ModelSelection.model` to `ModelSelection.agentFile`; selectModel() now returns agent file names (e.g., "powr-investigate-haiku") instead of model strings (e.g., "haiku"); added HAIKU_VARIANTS lookup map |
| `src/commands/model-select.test.ts` | Updated all assertions from `result.model` to `result.agentFile`; verify correct agent file names are returned |
| `skills/powr/SKILL.md` | Replaced all `model="<chosen-model>"` Agent() calls with `subagent_type="<chosen-agent-file>"`; updated Dynamic Model Selection docs to explain agent file routing pattern |

## Commits
- Pending (will commit below)

## Decisions Made
- Haiku variant agent files share the exact same prompt body as their sonnet counterparts, differing only in YAML frontmatter `model: haiku` vs `model: sonnet`. This keeps the prompt logic DRY and makes it clear the only difference is model tier.
- The `HAIKU_VARIANTS` map is a simple Record lookup rather than string concatenation to keep the mapping explicit and easily auditable.
- The `ModelSelection` interface was changed from `{ model, reason }` to `{ agentFile, reason }` to make the API semantically accurate -- the output is an agent file name to use as `subagent_type`, not a model string.
- `selectImplementAgent()` was left unchanged since it already returns agent file names (it never had the runtime model parameter problem).

## Acceptance Criteria
- [x] Create haiku variant agent files (powr-investigate-haiku, powr-code-review-haiku, powr-ship-verify-haiku) with `model: haiku` in frontmatter
- [x] Update selectModel() to return agent file names instead of model strings
- [x] Remove concept of runtime model parameter from ModelSelection interface
- [x] Update tests to verify correct agent file names
- [x] Update SKILL.md to use subagent_type routing instead of model parameter in Agent() calls
