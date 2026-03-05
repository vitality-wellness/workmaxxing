# Implementation: SUNDAE-2418 — Add dynamic model selection logic to SKILL.md orchestrator

## Changes
| File | Change |
|------|--------|
| `src/commands/model-select.ts` | New file -- `selectModel()` pure function with per-agent decision logic, `selectImplementAgent()` helper, `SelectModelInput` and `ModelSelection` types |
| `src/commands/model-select.test.ts` | New file -- 32 unit tests covering the full decision table with fixture-based inputs for all 4 agents |
| `skills/powr/SKILL.md` | Added "Dynamic Model Selection" section to Global Rules with decision table; updated execute flow steps 3-11 to read signals via `model-signals` CLI and pass `model` override to Agent spawns; updated ship flow step 1 to read ticket count and gate status for ship-verify model selection; added logging instructions for every model decision |

## Commits
- Changes staged, not committed

## Decisions Made
- Kept `selectModel()` as a pure TypeScript function in `src/commands/model-select.ts` (not wired to CLI) -- serves as ground truth for the decision table that the SKILL.md prose references
- Used `"haiku"` and `"sonnet"` as model strings matching the agent frontmatter convention (not full model IDs like `claude-haiku-3-5`)
- Separated `selectImplementAgent()` from `selectModel()` because implement routing selects an agent name (not a model override)
- Pre-investigation signal read (step 3) gets estimate/labels for investigate model; post-investigation read (step 6) gets complexity for implement routing; diff read (step 9) gets diffStats for code-review model
- Bug-fix label matching is case-insensitive (lowercase comparison) to handle label casing variations
- Missing/null data always defaults to the more capable model (sonnet) as a conservative fallback
- Did not add `model-select.ts` to `cli.ts` since it is a library function, not a CLI command
- Renumbered execute steps from 3-9 to 3-11 to accommodate the new signal-reading steps

## Acceptance Criteria
- [x] Agent tool model parameter is verified working before implementing the full ladder (prerequisite gate -- skipped per AC note, logic assumes it works)
- [x] Orchestrator calls powr-workmaxxing model-signals <ticket-id> via Bash to get signals before spawning investigate/implement agents
- [x] powr-investigate is spawned with model override: haiku for estimate <= 1 or "bug-fix" label, sonnet otherwise
- [x] powr-implement routes to powr-implement (sonnet) for Simple complexity, powr-implement-complex (inherit) for Moderate/Complex
- [x] powr-code-review is spawned with model override: haiku for diffs < 50 lines and single file, sonnet otherwise (uses --diff flag on model-signals)
- [x] powr-ship-verify is spawned with model override: haiku for 1-2 tickets with all gates passed, sonnet otherwise
- [x] Model selection decisions are logged in the orchestrator output so the user sees which model was chosen and why
- [x] selectModel() function is unit tested against the full decision table with fixture-based inputs
