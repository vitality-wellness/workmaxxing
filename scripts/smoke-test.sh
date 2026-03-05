#!/bin/bash
set -euo pipefail

# Smoke test for powr-workmaxxing state machine.
#
# Usage:
#   ./scripts/smoke-test.sh
#   ./scripts/smoke-test.sh --verbose
#
# What it tests:
#   1. workflow start → status shows SPECCING stage
#   2. gate record + advance: SPECCING → PLANNING → REVIEWING → TICKETING → EXECUTING
#   3. ticket sub-workflow: QUEUED → INVESTIGATING → IMPLEMENTING → CODE_REVIEWING → DONE
#   4. model-signals: reads estimate + complexity from fixture files
#   5. model-signals --diff: reads diff stats from git
#   6. final advance: EXECUTING → SHIPPING (gate all_tickets_done)
#   7. gate enforcement: advance blocked when required gate is missing
#
# Requirements:
#   - tsx (for dev mode) OR powr-workmaxxing in PATH
#   - jq (optional; falls back to grep for JSON assertions)
#   - git (for --diff signal test)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

VERBOSE=false
for ARG in "$@"; do
  case "$ARG" in
    --verbose) VERBOSE=true ;;
  esac
done

# ── Resolve CLI binary ────────────────────────────────────────────────────────
# Prefer a local dev build (tsx/npx tsx) when model-signals is available.
# The globally installed binary may be an older version without model-signals.
#
# We define a `run_cli` function rather than storing the command in a variable,
# to avoid word-splitting issues with multi-word commands like "npx tsx path/cli.ts".

run_cli() {
  if command -v tsx &>/dev/null && [[ -f "$REPO_ROOT/src/cli.ts" ]]; then
    tsx "$REPO_ROOT/src/cli.ts" "$@"
  elif command -v npx &>/dev/null && [[ -f "$REPO_ROOT/src/cli.ts" ]]; then
    npx --yes tsx "$REPO_ROOT/src/cli.ts" "$@"
  elif command -v powr-workmaxxing &>/dev/null; then
    powr-workmaxxing "$@"
  else
    echo "ERROR: Cannot find CLI binary. Install tsx or powr-workmaxxing." >&2
    return 1
  fi
}

# Verify model-signals is available
if ! run_cli model-signals --help &>/dev/null 2>&1; then
  echo "ERROR: The 'model-signals' command is not available."
  echo "       Build the project: npm run build && npm install -g ."
  echo "       Or ensure tsx and src/cli.ts are accessible."
  exit 1
fi

echo "Using CLI: $(run_cli --version 2>/dev/null || echo 'dev build')"

log() {
  if [[ "$VERBOSE" == "true" ]]; then
    echo "  [debug] $*"
  fi
}

# ── Test tracking ─────────────────────────────────────────────────────────────

PASS=0
FAIL=0
FAILURES=()

assert_pass() {
  local label="$1"
  PASS=$((PASS + 1))
  echo "  PASS  $label"
}

assert_fail() {
  local label="$1"
  local detail="${2:-}"
  FAIL=$((FAIL + 1))
  FAILURES+=("$label${detail:+: $detail}")
  echo "  FAIL  $label"
  if [[ -n "$detail" ]]; then
    echo "        $detail"
  fi
}

# Run a run_cli subcommand and check it exits 0
assert_cli() {
  local label="$1"
  shift
  local output
  if output=$(run_cli "$@" 2>&1); then
    log "$output"
    assert_pass "$label"
  else
    assert_fail "$label" "Command failed: run_cli $*"
    log "$output"
  fi
}

# Assert a string appears in output
assert_contains() {
  local label="$1"
  local expected="$2"
  local actual="$3"
  if echo "$actual" | grep -qF "$expected"; then
    assert_pass "$label"
  else
    assert_fail "$label" "Expected '$expected' in output: $actual"
  fi
}

# Assert JSON field value using jq (falls back to grep for string values)
assert_json() {
  local label="$1"
  local jq_expr="$2"
  local expected="$3"
  local json="$4"

  if command -v jq &>/dev/null; then
    local actual
    actual=$(echo "$json" | jq -r "$jq_expr" 2>/dev/null || echo "")
    if [[ "$actual" == "$expected" ]]; then
      assert_pass "$label"
    else
      assert_fail "$label" "Expected $jq_expr == '$expected', got '$actual'"
    fi
  else
    # Fallback: grep for the expected value as a JSON string
    if echo "$json" | grep -qF "\"$expected\""; then
      assert_pass "$label"
    else
      assert_fail "$label" "Expected '$expected' in JSON (jq not available for precise check)"
    fi
  fi
}

# ── Temp directory setup ──────────────────────────────────────────────────────

TMPDIR_ROOT=$(mktemp -d)
FAKE_REPO="$TMPDIR_ROOT/fake-repo"
mkdir -p "$FAKE_REPO"
mkdir -p "$FAKE_REPO/.claude/ticket-summaries"
mkdir -p "$FAKE_REPO/.claude/handoffs"
mkdir -p "$FAKE_REPO/.claude/specs"
mkdir -p "$FAKE_REPO/.claude/plans"

# Fixture files that gates validate against (spec/plan gates check file existence)
echo "# Smoke test spec" > "$FAKE_REPO/.claude/specs/smoke-test.md"
echo "# Smoke test plan" > "$FAKE_REPO/.claude/plans/smoke-test.md"

# Initialize a minimal git repo (needed for --diff test and code_committed gate)
git -C "$FAKE_REPO" init -q
git -C "$FAKE_REPO" config user.email "smoke@test.local"
git -C "$FAKE_REPO" config user.name "Smoke Test"
touch "$FAKE_REPO/.gitkeep"
git -C "$FAKE_REPO" add .gitkeep
git -C "$FAKE_REPO" commit -q -m "init"

# Get the HEAD SHA for code_committed gate (requires a real commit SHA)
REAL_SHA=$(git -C "$FAKE_REPO" rev-parse HEAD)

cleanup() {
  rm -rf "$TMPDIR_ROOT"
}
trap cleanup EXIT

# ── Section 1: Workflow start ─────────────────────────────────────────────────

echo ""
echo "=== Section 1: Workflow Start ==="

assert_cli "start workflow" \
  start "smoke-test-feature" --repo "$FAKE_REPO"

STATUS_OUT=$(run_cli status --repo "$FAKE_REPO" --json 2>/dev/null || \
             run_cli status --repo "$FAKE_REPO" 2>&1)
log "status output: $STATUS_OUT"
assert_contains "status shows SPECCING" "SPECCING" "$STATUS_OUT"

# ── Section 2: SPECCING → PLANNING ───────────────────────────────────────────

echo ""
echo "=== Section 2: SPECCING → PLANNING ==="

assert_cli "gate record spec_document_written" \
  gate record spec_document_written \
  --repo "$FAKE_REPO" \
  --evidence "{\"path\":\"$FAKE_REPO/.claude/specs/smoke-test.md\"}"

assert_cli "advance SPECCING → PLANNING" \
  advance --repo "$FAKE_REPO"

STATUS_OUT=$(run_cli status --repo "$FAKE_REPO" --json 2>/dev/null || \
             run_cli status --repo "$FAKE_REPO" 2>&1)
assert_contains "status shows PLANNING after advance" "PLANNING" "$STATUS_OUT"

# ── Section 3: PLANNING → REVIEWING ──────────────────────────────────────────

echo ""
echo "=== Section 3: PLANNING → REVIEWING ==="

assert_cli "gate record plan_written" \
  gate record plan_written \
  --repo "$FAKE_REPO" \
  --evidence "{\"path\":\"$FAKE_REPO/.claude/plans/smoke-test.md\"}"

assert_cli "advance PLANNING → REVIEWING" \
  advance --repo "$FAKE_REPO"

STATUS_OUT=$(run_cli status --repo "$FAKE_REPO" --json 2>/dev/null || \
             run_cli status --repo "$FAKE_REPO" 2>&1)
assert_contains "status shows REVIEWING" "REVIEWING" "$STATUS_OUT"

# ── Section 4: REVIEWING → TICKETING ─────────────────────────────────────────

echo ""
echo "=== Section 4: REVIEWING → TICKETING ==="

for GATE in review_architecture review_code_quality review_tests review_performance review_ticket_decomposition; do
  assert_cli "gate record $GATE" \
    gate record "$GATE" \
    --repo "$FAKE_REPO" \
    --evidence '{"approved":true}'
done

assert_cli "advance REVIEWING → TICKETING" \
  advance --repo "$FAKE_REPO"

STATUS_OUT=$(run_cli status --repo "$FAKE_REPO" --json 2>/dev/null || \
             run_cli status --repo "$FAKE_REPO" 2>&1)
assert_contains "status shows TICKETING" "TICKETING" "$STATUS_OUT"

# ── Section 5: TICKETING → EXECUTING ─────────────────────────────────────────

echo ""
echo "=== Section 5: TICKETING → EXECUTING ==="

assert_cli "gate record tickets_created" \
  gate record tickets_created \
  --repo "$FAKE_REPO" \
  --evidence '{"ticketIds":["SMOKE-1","SMOKE-2"]}'

assert_cli "advance TICKETING → EXECUTING" \
  advance --repo "$FAKE_REPO"

STATUS_OUT=$(run_cli status --repo "$FAKE_REPO" --json 2>/dev/null || \
             run_cli status --repo "$FAKE_REPO" 2>&1)
assert_contains "status shows EXECUTING" "EXECUTING" "$STATUS_OUT"

# ── Section 6: Ticket sub-workflow ───────────────────────────────────────────

echo ""
echo "=== Section 6: Ticket Sub-Workflow (SMOKE-1) ==="

assert_cli "gate record ticket_in_progress for SMOKE-1" \
  gate record ticket_in_progress \
  --ticket SMOKE-1 \
  --repo "$FAKE_REPO" \
  --evidence '{"linearIssueId":"SMOKE-1"}'

assert_cli "gate record investigation for SMOKE-1" \
  gate record investigation \
  --ticket SMOKE-1 \
  --repo "$FAKE_REPO" \
  --evidence '{"commentUrl":"http://linear.test/comment/1"}'

assert_cli "gate record code_committed for SMOKE-1" \
  gate record code_committed \
  --ticket SMOKE-1 \
  --repo "$FAKE_REPO" \
  --evidence "{\"commitSha\":\"$REAL_SHA\"}"

assert_cli "gate record coderabbit_review for SMOKE-1" \
  gate record coderabbit_review \
  --ticket SMOKE-1 \
  --repo "$FAKE_REPO" \
  --evidence '{"reviewUrl":"http://linear.test/review/1"}'

# Verify ticket gate state via check-ticket
TICKET_GATE_CHECK=$(run_cli gate check-ticket SMOKE-1 --repo "$FAKE_REPO" --json 2>/dev/null || \
                    run_cli gate check-ticket SMOKE-1 --repo "$FAKE_REPO" 2>&1)
log "ticket gate check: $TICKET_GATE_CHECK"
assert_contains "ticket gate check returns SMOKE-1 data" "SMOKE-1" "$TICKET_GATE_CHECK"

if command -v jq &>/dev/null; then
  ALL_PASSED=$(echo "$TICKET_GATE_CHECK" | jq -r '.allPassed' 2>/dev/null || echo "")
  if [[ "$ALL_PASSED" == "true" ]]; then
    assert_pass "SMOKE-1 all gates passed"
  else
    assert_fail "SMOKE-1 all gates passed" "allPassed was not true: $TICKET_GATE_CHECK"
  fi
fi

# ── Section 7: model-signals (no diff) ───────────────────────────────────────

echo ""
echo "=== Section 7: model-signals — Estimate + Labels ==="

# Create ticket-summaries fixture
cat > "$FAKE_REPO/.claude/ticket-summaries/smoke-test.json" <<'FIXTURE'
{
  "tickets": [
    {
      "id": "SMOKE-1",
      "title": "Simple smoke test ticket",
      "summary": "Validate the state machine works end to end",
      "estimate": 1,
      "labels": ["bug-fix"],
      "deps": []
    },
    {
      "id": "SMOKE-2",
      "title": "Complex smoke test ticket",
      "summary": "Larger feature implementation",
      "estimate": 3,
      "labels": ["feature"],
      "deps": []
    }
  ]
}
FIXTURE

# SMOKE-1: estimate=1, bug-fix label → haiku threshold
SIGNALS_OUT=$(run_cli model-signals SMOKE-1 --repo "$FAKE_REPO" 2>&1)
log "model-signals SMOKE-1: $SIGNALS_OUT"
assert_contains "model-signals SMOKE-1 returns ticketId" "SMOKE-1" "$SIGNALS_OUT"
assert_json "SMOKE-1 estimate is 1" ".estimate" "1" "$SIGNALS_OUT"

# SMOKE-2: estimate=3, feature label → sonnet threshold
SIGNALS_OUT=$(run_cli model-signals SMOKE-2 --repo "$FAKE_REPO" 2>&1)
log "model-signals SMOKE-2: $SIGNALS_OUT"
assert_contains "model-signals SMOKE-2 returns ticketId" "SMOKE-2" "$SIGNALS_OUT"
assert_json "SMOKE-2 estimate is 3" ".estimate" "3" "$SIGNALS_OUT"

# ── Section 8: model-signals with complexity handoff ─────────────────────────

echo ""
echo "=== Section 8: model-signals — Complexity from Handoff ==="

# Create an investigation handoff for SMOKE-2 with Moderate complexity
cat > "$FAKE_REPO/.claude/handoffs/investigate-SMOKE-2.md" <<'HANDOFF'
# Investigation: SMOKE-2 — Complex smoke test ticket

## Codebase Findings
Found relevant files in src/engine/.

## Complexity Assessment
Moderate — multiple files need updates across two subsystems.
HANDOFF

SIGNALS_OUT=$(run_cli model-signals SMOKE-2 --repo "$FAKE_REPO" 2>&1)
log "model-signals SMOKE-2 with handoff: $SIGNALS_OUT"
assert_json "SMOKE-2 complexity reads Moderate from handoff" ".complexity" "Moderate" "$SIGNALS_OUT"

# Create a Simple handoff for SMOKE-1
cat > "$FAKE_REPO/.claude/handoffs/investigate-SMOKE-1.md" <<'HANDOFF'
# Investigation: SMOKE-1 — Simple smoke test ticket

## Codebase Findings
Single config file change.

## Complexity Assessment
Simple — one-line change in a single file.
HANDOFF

SIGNALS_OUT=$(run_cli model-signals SMOKE-1 --repo "$FAKE_REPO" 2>&1)
log "model-signals SMOKE-1 with handoff: $SIGNALS_OUT"
assert_json "SMOKE-1 complexity reads Simple from handoff" ".complexity" "Simple" "$SIGNALS_OUT"

# ── Section 9: model-signals --diff ──────────────────────────────────────────

echo ""
echo "=== Section 9: model-signals --diff ==="

# Create a staged change so git diff --stat HEAD has something to show
echo "hello world" > "$FAKE_REPO/test-file.txt"
git -C "$FAKE_REPO" add test-file.txt

SIGNALS_DIFF=$(run_cli model-signals SMOKE-1 --repo "$FAKE_REPO" --diff 2>&1)
log "model-signals --diff: $SIGNALS_DIFF"
assert_contains "model-signals --diff returns output" "SMOKE-1" "$SIGNALS_DIFF"
assert_contains "model-signals --diff includes diffStats key" "diffStats" "$SIGNALS_DIFF"

# ── Section 10: Complete ticket SMOKE-2 and advance to SHIPPING ───────────────

echo ""
echo "=== Section 10: Complete SMOKE-2 + EXECUTING → SHIPPING ==="

assert_cli "gate record ticket_in_progress for SMOKE-2" \
  gate record ticket_in_progress \
  --ticket SMOKE-2 \
  --repo "$FAKE_REPO" \
  --evidence '{"linearIssueId":"SMOKE-2"}'

assert_cli "gate record investigation for SMOKE-2" \
  gate record investigation \
  --ticket SMOKE-2 \
  --repo "$FAKE_REPO" \
  --evidence '{"commentUrl":"http://linear.test/comment/2"}'

assert_cli "gate record code_committed for SMOKE-2" \
  gate record code_committed \
  --ticket SMOKE-2 \
  --repo "$FAKE_REPO" \
  --evidence "{\"commitSha\":\"$REAL_SHA\"}"

assert_cli "gate record coderabbit_review for SMOKE-2" \
  gate record coderabbit_review \
  --ticket SMOKE-2 \
  --repo "$FAKE_REPO" \
  --evidence '{"reviewUrl":"http://linear.test/review/2"}'

assert_cli "gate record all_tickets_done" \
  gate record all_tickets_done \
  --repo "$FAKE_REPO" \
  --evidence '{"ticketCount":2}'

assert_cli "advance EXECUTING → SHIPPING" \
  advance --repo "$FAKE_REPO"

STATUS_OUT=$(run_cli status --repo "$FAKE_REPO" --json 2>/dev/null || \
             run_cli status --repo "$FAKE_REPO" 2>&1)
assert_contains "status shows SHIPPING" "SHIPPING" "$STATUS_OUT"

# ── Section 11: SHIPPING → IDLE ──────────────────────────────────────────────

echo ""
echo "=== Section 11: SHIPPING → IDLE ==="

assert_cli "gate record ship_verified" \
  gate record ship_verified \
  --repo "$FAKE_REPO" \
  --evidence '{"verified":true}'

assert_cli "advance SHIPPING → IDLE" \
  advance --repo "$FAKE_REPO"

STATUS_OUT=$(run_cli status --repo "$FAKE_REPO" --json 2>/dev/null || \
             run_cli status --repo "$FAKE_REPO" 2>&1)
assert_contains "status shows IDLE" "IDLE" "$STATUS_OUT"

# ── Section 12: Advance blocked without required gate ────────────────────────

echo ""
echo "=== Section 12: Gate Enforcement ==="

# Start a new workflow (previous is now IDLE)
assert_cli "start second workflow" \
  start "gate-block-test" --repo "$FAKE_REPO"

STATUS_OUT=$(run_cli status --repo "$FAKE_REPO" 2>&1)
assert_contains "second workflow starts at SPECCING" "SPECCING" "$STATUS_OUT"

# Attempt advance without the required spec_document_written gate — should fail
if run_cli advance --repo "$FAKE_REPO" &>/dev/null; then
  assert_fail "advance without gate should be blocked" "Expected non-zero exit, got 0"
else
  assert_pass "advance without gate is correctly blocked"
fi

# ── Results ───────────────────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════"
echo "  Results: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════"

if [[ "$FAIL" -gt 0 ]]; then
  echo ""
  echo "Failed tests:"
  for f in "${FAILURES[@]}"; do
    echo "  - $f"
  done
  echo ""
  exit 1
fi

echo ""
echo "All smoke tests passed."
exit 0
