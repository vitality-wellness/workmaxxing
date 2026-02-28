#!/bin/bash
set -euo pipefail

# powr-hook: Unified hook runner for Claude Code
#
# Reads workflow state from SQLite (~/.powr/workflow.db) instead of files.
# Single entry point for all hook events across all repos.
#
# Usage: powr-hook <handler-name>
# Handlers: require-ticket, detect-work, lifecycle, review-plan, enforce-gates
#
# Install: symlink from .claude/hooks/ in each repo to this file.

HANDLER="${1:-}"
INPUT=$(cat)
DB="$HOME/.powr/workflow.db"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

# --- Helpers ---
deny() {
  local REASON="$1"
  if command -v jq &>/dev/null; then
    jq -n --arg reason "$REASON" \
      '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":$reason}}'
  else
    python3 -c "import json,sys; print(json.dumps({'hookSpecificOutput':{'hookEventName':'PreToolUse','permissionDecision':'deny','permissionDecisionReason':sys.argv[1]}}))" "$REASON"
  fi
  exit 0
}

query() {
  sqlite3 "$DB" "$1" 2>/dev/null || echo ""
}

has_db() {
  [[ -f "$DB" ]]
}

# --- Handlers ---

handle_require_ticket() {
  # PreToolUse on Edit|Write — block production edits without active workflow or bypass
  if ! has_db; then exit 0; fi

  # Check for bypass
  local BYPASSED
  BYPASSED=$(query "SELECT 1 FROM sessions WHERE active=1 AND repo='$PROJECT_DIR' AND bypassed=1 LIMIT 1")
  if [[ -n "$BYPASSED" ]]; then exit 0; fi

  # Check for active workflow
  local ACTIVE
  ACTIVE=$(query "SELECT 1 FROM workflows WHERE active=1 AND repo='$PROJECT_DIR' LIMIT 1")
  if [[ -n "$ACTIVE" ]]; then exit 0; fi

  deny "No active workflow. Use \`powr-workflow start <name>\` to begin, or \`powr-workflow bypass\` for non-ticket work."
}

handle_detect_work() {
  # UserPromptSubmit — inject workflow status
  if ! has_db; then exit 0; fi

  # Check for bypass
  local BYPASSED
  BYPASSED=$(query "SELECT 1 FROM sessions WHERE active=1 AND repo='$PROJECT_DIR' AND bypassed=1 LIMIT 1")
  if [[ -n "$BYPASSED" ]]; then exit 0; fi

  # Check for active workflow
  local STAGE FEATURE
  STAGE=$(query "SELECT stage FROM workflows WHERE active=1 AND repo='$PROJECT_DIR' ORDER BY updated_at DESC LIMIT 1")
  FEATURE=$(query "SELECT feature_name FROM workflows WHERE active=1 AND repo='$PROJECT_DIR' ORDER BY updated_at DESC LIMIT 1")

  if [[ -n "$STAGE" ]]; then
    echo "ACTIVE WORKFLOW: \"$FEATURE\" | Stage: $STAGE | Use \`powr-workflow status\` for details."
  fi
}

handle_lifecycle() {
  # Stop — block stop if session has active workflow that's not done
  if ! has_db; then exit 0; fi

  local WORKFLOW_ID STAGE
  WORKFLOW_ID=$(query "SELECT w.id FROM workflows w JOIN sessions s ON w.id=s.workflow_id WHERE s.active=1 AND s.repo='$PROJECT_DIR' AND w.active=1 AND s.bypassed=0 LIMIT 1")

  if [[ -z "$WORKFLOW_ID" ]]; then exit 0; fi

  STAGE=$(query "SELECT stage FROM workflows WHERE id='$WORKFLOW_ID'")
  if [[ "$STAGE" == "IDLE" || "$STAGE" == "SHIPPING" ]]; then exit 0; fi

  # Check transcript for completion marker
  local TRANSCRIPT_PATH
  if command -v jq &>/dev/null; then
    TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty' 2>/dev/null || true)
  fi
  if [[ -n "${TRANSCRIPT_PATH:-}" && -f "$TRANSCRIPT_PATH" ]]; then
    if grep -q 'EXECUTE_TICKET_DONE\|EXECUTE_BATCH_DONE' "$TRANSCRIPT_PATH" 2>/dev/null; then
      exit 0
    fi
  fi

  REASON="Active workflow \"$(query "SELECT feature_name FROM workflows WHERE id='$WORKFLOW_ID'")\" is in stage $STAGE. Complete or bypass before stopping."
  jq -n --arg reason "$REASON" '{"decision":"block","reason":$reason}' 2>/dev/null || \
    python3 -c "import json,sys; print(json.dumps({'decision':'block','reason':sys.argv[1]}))" "$REASON"
}

handle_review_plan() {
  # PreToolUse on ExitPlanMode — enforce plan review gate
  if ! has_db; then
    # Fall back to marker-based approach if no DB yet
    exit 0
  fi

  local WORKFLOW_ID
  WORKFLOW_ID=$(query "SELECT id FROM workflows WHERE active=1 AND repo='$PROJECT_DIR' AND stage='REVIEWING' LIMIT 1")

  if [[ -z "$WORKFLOW_ID" ]]; then exit 0; fi

  # Check if review gates are passed
  local REVIEWS_DONE
  REVIEWS_DONE=$(query "SELECT COUNT(*) FROM gates WHERE workflow_id='$WORKFLOW_ID' AND gate_name LIKE 'review_%'")

  if [[ "${REVIEWS_DONE:-0}" -ge 5 ]]; then
    # All 5 review gates passed
    exit 0
  fi

  # Deny with review prompt
  PROMPT_FILE="$PROJECT_DIR/.claude/hooks/review-plan-prompt.md"
  if [[ -f "$PROMPT_FILE" ]]; then
    deny "$(cat "$PROMPT_FILE")"
  else
    deny "PLAN REVIEW REQUIRED: Review architecture, code quality, tests, performance, and ticket decomposition before presenting plan."
  fi
}

handle_enforce_gates() {
  # PreToolUse on update_issue — block Done transition without gates
  if ! has_db; then exit 0; fi

  local STATE TICKET_ID
  if command -v jq &>/dev/null; then
    STATE=$(echo "$INPUT" | jq -r '.tool_input.state // empty' 2>/dev/null || true)
    TICKET_ID=$(echo "$INPUT" | jq -r '.tool_input.id // empty' 2>/dev/null || true)
  fi

  # Only gate "Done" transitions
  if [[ -z "$STATE" ]] || [[ "$(echo "$STATE" | tr '[:upper:]' '[:lower:]')" != "done" ]]; then
    exit 0
  fi

  # Check if ticket has all gates in workflow DB
  local TW_ID MISSING
  TW_ID=$(query "SELECT tw.id FROM ticket_workflows tw JOIN workflows w ON tw.workflow_id=w.id WHERE tw.ticket_id='$TICKET_ID' AND w.active=1 LIMIT 1")

  if [[ -z "$TW_ID" ]]; then exit 0; fi  # Not tracked in workflow

  # Check required gates for VERIFYING_ACS stage
  for GATE in investigation code_committed coderabbit_review findings_crossreferenced findings_resolved acceptance_criteria; do
    local PASSED
    PASSED=$(query "SELECT 1 FROM gates WHERE workflow_id=(SELECT workflow_id FROM ticket_workflows WHERE id='$TW_ID') AND gate_name='$GATE' LIMIT 1")
    if [[ -z "$PASSED" ]]; then
      MISSING="${MISSING:-}  ⬜ $GATE\n"
    fi
  done

  if [[ -n "${MISSING:-}" ]]; then
    deny "BLOCKED: Cannot mark $TICKET_ID as Done. Missing gates:\n$MISSING\nComplete these before setting state to Done."
  fi
}

# --- Dispatch ---
case "$HANDLER" in
  require-ticket)  handle_require_ticket ;;
  detect-work)     handle_detect_work ;;
  lifecycle)       handle_lifecycle ;;
  review-plan)     handle_review_plan ;;
  enforce-gates)   handle_enforce_gates ;;
  *)
    echo "Unknown handler: $HANDLER" >&2
    echo "Usage: powr-hook <require-ticket|detect-work|lifecycle|review-plan|enforce-gates>" >&2
    exit 1
    ;;
esac
