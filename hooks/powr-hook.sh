#!/bin/bash
set -euo pipefail

# powr-hook: Unified hook runner for Claude Code
#
# Reads workflow state from SQLite (~/.powr/workflow.db).
# Single entry point for all hook events across all repos.
#
# Usage: powr-hook <handler-name>
# Install: symlink from .claude/hooks/ in each repo to this file.

HANDLER="${1:-}"
INPUT=$(cat)
DB="$HOME/.powr/workflow.db"
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
REPOS_CONFIG="$HOME/.powr/repos.json"

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

block() {
  local REASON="$1"
  if command -v jq &>/dev/null; then
    jq -n --arg reason "$REASON" '{"decision":"block","reason":$reason}'
  else
    python3 -c "import json,sys; print(json.dumps({'decision':'block','reason':sys.argv[1]}))" "$REASON"
  fi
  exit 0
}

query() {
  sqlite3 "$DB" "$1" 2>/dev/null || echo ""
}

has_db() {
  [[ -f "$DB" ]]
}

json_field() {
  local FIELD="$1"
  if command -v jq &>/dev/null; then
    echo "$INPUT" | jq -r "$FIELD" 2>/dev/null || echo ""
  else
    echo "$INPUT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(eval('d'+sys.argv[1].replace('.','[\"').replace('/','').rstrip('\"')+'\"]'))" "$FIELD" 2>/dev/null || echo ""
  fi
}

is_bypassed() {
  local BYPASSED
  BYPASSED=$(query "SELECT 1 FROM sessions WHERE active=1 AND repo='$PROJECT_DIR' AND bypassed=1 LIMIT 1")
  [[ -n "$BYPASSED" ]]
}

set_terminal_title() {
  # Set terminal tab title via ANSI escape sequence (writes to /dev/tty to bypass stdout capture)
  printf '\033]0;%s\007' "$1" > /dev/tty 2>/dev/null || true
}

reset_terminal_title() {
  printf '\033]0;\007' > /dev/tty 2>/dev/null || true
}

get_production_paths() {
  # Read production paths from repos.json
  if [[ -f "$REPOS_CONFIG" ]] && command -v jq &>/dev/null; then
    for KEY in $(jq -r 'keys[]' "$REPOS_CONFIG" 2>/dev/null); do
      if [[ "$PROJECT_DIR" == *"$KEY"* ]]; then
        jq -r ".[\"$KEY\"].productionPaths[]" "$REPOS_CONFIG" 2>/dev/null
        return
      fi
    done
  fi
  # Fallback defaults
  echo "lib/"
  echo "ios/"
}

get_repo_field() {
  local FIELD="$1" DEFAULT="${2:-}"
  if [[ -f "$REPOS_CONFIG" ]] && command -v jq &>/dev/null; then
    for KEY in $(jq -r 'keys[]' "$REPOS_CONFIG" 2>/dev/null); do
      if [[ "$PROJECT_DIR" == *"$KEY"* ]]; then
        local VAL
        VAL=$(jq -r ".[\"$KEY\"].$FIELD // empty" "$REPOS_CONFIG" 2>/dev/null)
        echo "${VAL:-$DEFAULT}"
        return
      fi
    done
  fi
  echo "$DEFAULT"
}

is_review_mode() {
  [[ "$(get_repo_field reviewMode false)" == "true" ]]
}

# ============================================================================
# HANDLERS
# ============================================================================

handle_require_ticket() {
  # PreToolUse on Edit|Write — block production edits without active workflow
  if ! has_db; then exit 0; fi
  if is_bypassed; then exit 0; fi

  # Extract file path from tool input
  local FILE_PATH
  FILE_PATH=$(json_field '.tool_input.file_path // empty')
  if [[ -z "$FILE_PATH" ]]; then exit 0; fi

  # Normalize to relative path
  local REL_PATH="${FILE_PATH#$PROJECT_DIR/}"

  # Check if it's a production file
  local IS_PROD=false
  while IFS= read -r PREFIX; do
    if [[ "$REL_PATH" == "$PREFIX"* ]]; then
      IS_PROD=true
      break
    fi
  done < <(get_production_paths)

  if [[ "$IS_PROD" == "false" ]]; then exit 0; fi

  # Check for active workflow
  local WF_ID
  WF_ID=$(query "SELECT id FROM workflows WHERE active=1 AND repo='$PROJECT_DIR' ORDER BY updated_at DESC LIMIT 1")
  if [[ -z "$WF_ID" ]]; then
    deny "No active workflow. Editing production code ($REL_PATH) requires an active workflow. Use \`powr-workmaxxing start <name>\` or \`powr-workmaxxing bypass\`."
  fi

  # Check investigation gate (must investigate before coding)
  local HAS_INVESTIGATION
  HAS_INVESTIGATION=$(query "SELECT 1 FROM gates WHERE workflow_id='$WF_ID' AND gate_name='investigation' LIMIT 1")
  if [[ -z "$HAS_INVESTIGATION" ]]; then
    deny "Codebase investigation not complete. You MUST investigate before editing production code.\nAnswer 5 questions: similar features, types, utilities, state management, constraints.\nPost investigation comment, then code."
  fi
}

handle_detect_work() {
  # UserPromptSubmit — inject verbose workflow status
  if ! has_db; then exit 0; fi
  if is_bypassed; then exit 0; fi

  # Use CLI for rich status if available
  if command -v powr-workmaxxing &>/dev/null; then
    local STATUS
    STATUS=$(powr-workmaxxing status --repo "$PROJECT_DIR" --json 2>/dev/null || echo '{"status":"idle"}')
    local WF_STATUS
    WF_STATUS=$(echo "$STATUS" | jq -r '.status // "idle"' 2>/dev/null || echo "idle")

    if [[ "$WF_STATUS" == "active" ]]; then
      local FEATURE STAGE
      FEATURE=$(echo "$STATUS" | jq -r '.workflow.featureName // ""' 2>/dev/null || echo "")
      STAGE=$(echo "$STATUS" | jq -r '.workflow.stage // ""' 2>/dev/null || echo "")

      # Check staleness
      local UPDATED_AT
      UPDATED_AT=$(echo "$STATUS" | jq -r '.workflow.updatedAt // ""' 2>/dev/null || echo "")
      if [[ -n "$UPDATED_AT" ]]; then
        local NOW_EPOCH UPDATED_EPOCH AGE_HOURS
        NOW_EPOCH=$(date +%s)
        UPDATED_EPOCH=$(date -j -f "%Y-%m-%d %H:%M:%S" "$UPDATED_AT" +%s 2>/dev/null || echo "$NOW_EPOCH")
        AGE_HOURS=$(( (NOW_EPOCH - UPDATED_EPOCH) / 3600 ))

        if [[ "$AGE_HOURS" -ge 2 ]]; then
          echo "STALE WORKFLOW: \"$FEATURE\" ($STAGE) — last activity ${AGE_HOURS}h ago. Use \`powr-workmaxxing status\` to check, or \`powr-workmaxxing bypass\` to skip."
          exit 0
        fi
      fi

      # Get next directive
      local NEXT_DIRECTIVE
      NEXT_DIRECTIVE=$(powr-workmaxxing gate next --repo "$PROJECT_DIR" 2>/dev/null || echo "")

      # Keep terminal tab title in sync with current ticket/workflow
      local WF_ID CURRENT_TICKET
      WF_ID=$(echo "$STATUS" | jq -r '.workflow.id // empty' 2>/dev/null || echo "")
      if [[ -n "$WF_ID" ]]; then
        CURRENT_TICKET=$(query "SELECT ticket_id FROM ticket_workflows WHERE workflow_id='$WF_ID' AND stage NOT IN ('DONE','QUEUED') ORDER BY updated_at DESC LIMIT 1")
      fi
      if [[ -n "${CURRENT_TICKET:-}" ]]; then
        set_terminal_title "$CURRENT_TICKET"
      else
        set_terminal_title "$FEATURE"
      fi

      echo "ACTIVE WORKFLOW: \"$FEATURE\" | Stage: $STAGE${NEXT_DIRECTIVE:+ | Next: $NEXT_DIRECTIVE}"
    fi
  else
    # Fallback: direct SQLite query
    local STAGE FEATURE
    STAGE=$(query "SELECT stage FROM workflows WHERE active=1 AND repo='$PROJECT_DIR' ORDER BY updated_at DESC LIMIT 1")
    FEATURE=$(query "SELECT feature_name FROM workflows WHERE active=1 AND repo='$PROJECT_DIR' ORDER BY updated_at DESC LIMIT 1")

    if [[ -n "$STAGE" ]]; then
      # Set terminal title from fallback path
      local CURRENT_TICKET
      CURRENT_TICKET=$(query "SELECT ticket_id FROM ticket_workflows tw JOIN workflows w ON tw.workflow_id=w.id WHERE w.active=1 AND w.repo='$PROJECT_DIR' AND tw.stage NOT IN ('DONE','QUEUED') LIMIT 1")
      if [[ -n "$CURRENT_TICKET" ]]; then
        set_terminal_title "$CURRENT_TICKET"
      elif [[ -n "$FEATURE" ]]; then
        set_terminal_title "$FEATURE"
      fi

      echo "ACTIVE WORKFLOW: \"$FEATURE\" | Stage: $STAGE"
    fi
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
  TRANSCRIPT_PATH=$(json_field '.transcript_path // empty')
  if [[ -n "$TRANSCRIPT_PATH" && -f "$TRANSCRIPT_PATH" ]]; then
    if grep -q 'EXECUTE_TICKET_DONE\|EXECUTE_BATCH_DONE' "$TRANSCRIPT_PATH" 2>/dev/null; then
      exit 0
    fi
  fi

  local FEATURE
  FEATURE=$(query "SELECT feature_name FROM workflows WHERE id='$WORKFLOW_ID'")
  block "Active workflow \"$FEATURE\" is in stage $STAGE. Complete or bypass before stopping."
}

handle_review_plan() {
  # PreToolUse on ExitPlanMode — enforce plan review gate
  if ! has_db; then exit 0; fi

  local WORKFLOW_ID
  WORKFLOW_ID=$(query "SELECT id FROM workflows WHERE active=1 AND repo='$PROJECT_DIR' AND stage='REVIEWING' LIMIT 1")

  if [[ -z "$WORKFLOW_ID" ]]; then exit 0; fi

  local REVIEWS_DONE
  REVIEWS_DONE=$(query "SELECT COUNT(*) FROM gates WHERE workflow_id='$WORKFLOW_ID' AND gate_name LIKE 'review_%'")

  if [[ "${REVIEWS_DONE:-0}" -ge 5 ]]; then exit 0; fi

  PROMPT_FILE="$PROJECT_DIR/.claude/hooks/review-plan-prompt.md"
  if [[ -f "$PROMPT_FILE" ]]; then
    deny "$(cat "$PROMPT_FILE")"
  else
    deny "PLAN REVIEW REQUIRED: Review architecture, code quality, tests, performance, and ticket decomposition before presenting plan."
  fi
}

handle_enforce_gates() {
  # PreToolUse on save_issue — block Done transition without all ticket-scoped gates
  if ! has_db; then exit 0; fi

  local STATE TICKET_ID
  STATE=$(json_field '.tool_input.state // empty')
  TICKET_ID=$(json_field '.tool_input.id // empty')

  if [[ -z "$STATE" ]] || [[ "$(echo "$STATE" | tr '[:upper:]' '[:lower:]')" != "done" ]]; then
    exit 0
  fi

  if is_bypassed; then exit 0; fi

  # Block Done transitions in review mode
  if is_review_mode; then
    deny "REVIEW MODE: Do not mark tickets as Done. The human will review, commit, create a PR, and mark Done."
  fi

  # Find ticket workflow for this ticket
  local TW_ID MISSING
  TW_ID=$(query "SELECT tw.id FROM ticket_workflows tw JOIN workflows w ON tw.workflow_id=w.id WHERE tw.ticket_id='$TICKET_ID' AND w.active=1 LIMIT 1")

  # If no ticket workflow exists but there IS an active workflow, block — ticket hasn't been tracked
  if [[ -z "$TW_ID" ]]; then
    local HAS_ACTIVE_WF
    HAS_ACTIVE_WF=$(query "SELECT 1 FROM workflows WHERE active=1 AND repo='$PROJECT_DIR' LIMIT 1")
    if [[ -n "$HAS_ACTIVE_WF" ]]; then
      deny "BLOCKED: Cannot mark $TICKET_ID as Done — no ticket workflow exists. Record a gate with --ticket $TICKET_ID first to create one."
    fi
    exit 0
  fi

  local WF_ID
  WF_ID=$(query "SELECT workflow_id FROM ticket_workflows WHERE id='$TW_ID'")

  # Check ticket-scoped gates (WHERE ticket_workflow_id = TW_ID)
  # Gate list derived from CLI to avoid maintaining a third copy
  local GATE_LIST
  if command -v powr-workmaxxing &>/dev/null; then
    GATE_LIST=$(powr-workmaxxing gate list-ticket-gates 2>/dev/null || echo "ticket_in_progress investigation code_committed coderabbit_review findings_crossreferenced findings_resolved acceptance_criteria")
  else
    GATE_LIST="ticket_in_progress investigation code_committed coderabbit_review findings_crossreferenced findings_resolved acceptance_criteria"
  fi
  for GATE in $GATE_LIST; do
    local PASSED
    PASSED=$(query "SELECT 1 FROM gates WHERE workflow_id='$WF_ID' AND ticket_workflow_id='$TW_ID' AND gate_name='$GATE' LIMIT 1")
    if [[ -z "$PASSED" ]]; then
      MISSING="${MISSING:-}  ⬜ $GATE\n"
    fi
  done

  if [[ -n "${MISSING:-}" ]]; then
    deny "BLOCKED: Cannot mark $TICKET_ID as Done. Missing gates (ticket-scoped):\n$MISSING\nComplete these before setting state to Done."
  fi
}

handle_auto_record_status() {
  # PostToolUse on save_issue — auto-record ticket_in_progress when state is set to "In Progress"
  if ! has_db; then exit 0; fi
  if is_bypassed; then exit 0; fi

  local STATE TICKET_ID
  STATE=$(json_field '.tool_input.state // empty')
  TICKET_ID=$(json_field '.tool_input.id // empty')

  if [[ -z "$STATE" ]] || [[ -z "$TICKET_ID" ]]; then exit 0; fi

  # Normalize state comparison
  local STATE_LOWER
  STATE_LOWER=$(echo "$STATE" | tr '[:upper:]' '[:lower:]' | tr -d ' ')
  if [[ "$STATE_LOWER" != "inprogress" ]]; then exit 0; fi

  # Auto-record ticket_in_progress gate via CLI
  if command -v powr-workmaxxing &>/dev/null; then
    local GATE_OUTPUT
    GATE_OUTPUT=$(powr-workmaxxing gate record ticket_in_progress \
      --ticket "$TICKET_ID" \
      --repo "$PROJECT_DIR" \
      --evidence "{\"linearIssueId\":\"$TICKET_ID\"}" 2>&1) && \
      echo "Auto-recorded: ticket_in_progress for $TICKET_ID" || \
      echo "WARNING: Failed to auto-record ticket_in_progress for $TICKET_ID: $GATE_OUTPUT. Record manually: powr-workmaxxing gate record ticket_in_progress --ticket $TICKET_ID --evidence '{\"linearIssueId\":\"$TICKET_ID\"}'"

    # Rename terminal tab to the ticket being worked on
    set_terminal_title "$TICKET_ID"
  fi
}

handle_post_commit() {
  # PostToolUse on Bash — auto-record code_committed + trigger CodeRabbit
  if ! has_db; then exit 0; fi
  if is_bypassed; then exit 0; fi

  local COMMAND
  COMMAND=$(json_field '.tool_input.command // empty')
  if ! echo "$COMMAND" | grep -qE 'git\s+commit' 2>/dev/null; then exit 0; fi

  local WF_ID
  WF_ID=$(query "SELECT id FROM workflows WHERE active=1 AND repo='$PROJECT_DIR' ORDER BY updated_at DESC LIMIT 1")
  if [[ -z "$WF_ID" ]]; then exit 0; fi

  # Extract commit SHA from stdout (git commit output)
  local STDOUT COMMIT_SHA
  STDOUT=$(json_field '.tool_result.stdout // empty')
  COMMIT_SHA=$(echo "$STDOUT" | grep -oE '[0-9a-f]{7,40}' | head -1)

  # Auto-record code_committed for ticket in IMPLEMENTING stage
  if [[ -n "$COMMIT_SHA" ]] && command -v powr-workmaxxing &>/dev/null; then
    local TICKET_ID
    TICKET_ID=$(query "SELECT ticket_id FROM ticket_workflows WHERE workflow_id='$WF_ID' AND stage='IMPLEMENTING' LIMIT 1")
    if [[ -n "$TICKET_ID" ]]; then
      local GATE_OUTPUT
      GATE_OUTPUT=$(powr-workmaxxing gate record code_committed \
        --ticket "$TICKET_ID" \
        --repo "$PROJECT_DIR" \
        --evidence "{\"commitSha\":\"$COMMIT_SHA\"}" 2>&1) && \
        echo "Auto-recorded: code_committed ($COMMIT_SHA) for $TICKET_ID" || \
        echo "WARNING: Failed to auto-record code_committed for $TICKET_ID: $GATE_OUTPUT"
    fi
  fi

  local HAS_REVIEW
  HAS_REVIEW=$(query "SELECT 1 FROM gates WHERE workflow_id='$WF_ID' AND gate_name='coderabbit_review' LIMIT 1")
  if [[ -n "$HAS_REVIEW" ]]; then exit 0; fi

  echo "MANDATORY: Code committed. Run /coderabbit:review NOW. This gate is enforced."
}

handle_post_comment() {
  # PostToolUse on create_comment — auto-detect gates from comment text, scoped to ticket
  if ! has_db; then exit 0; fi

  local COMMENT_BODY ISSUE_ID
  COMMENT_BODY=$(json_field '.tool_input.body // empty')
  ISSUE_ID=$(json_field '.tool_input.issueId // empty')
  if [[ -z "$COMMENT_BODY" ]]; then exit 0; fi

  # Use CLI for gate detection if available
  if command -v powr-workmaxxing &>/dev/null; then
    local DETECTED
    DETECTED=$(powr-workmaxxing gate detect --text "$COMMENT_BODY" --repo "$PROJECT_DIR" --json 2>/dev/null || echo "[]")

    local COUNT
    COUNT=$(echo "$DETECTED" | jq 'length' 2>/dev/null || echo "0")

    if [[ "$COUNT" -gt 0 ]]; then
      # Build --ticket flag if we have an issueId
      local TICKET_FLAG=""
      if [[ -n "$ISSUE_ID" ]]; then
        TICKET_FLAG="--ticket $ISSUE_ID"
      fi

      # Record each detected gate (scoped to ticket if available)
      echo "$DETECTED" | jq -r '.[].gate' 2>/dev/null | while IFS= read -r GATE_NAME; do
        # shellcheck disable=SC2086
        powr-workmaxxing gate record "$GATE_NAME" --repo "$PROJECT_DIR" $TICKET_FLAG 2>/dev/null || true
      done

      # Output next directive
      local DIRECTIVE
      DIRECTIVE=$(powr-workmaxxing gate next --repo "$PROJECT_DIR" 2>/dev/null || echo "")
      if [[ -n "$DIRECTIVE" ]]; then
        echo "$DIRECTIVE"
      fi
    fi
  fi
}

handle_validate_ticket() {
  # PreToolUse on save_issue — validate ticket fields
  if ! has_db; then exit 0; fi

  # For save_issue updates (id present but no title), only validate if description is being changed
  local HAS_ID HAS_TITLE
  HAS_ID=$(json_field '.tool_input.id // empty')
  HAS_TITLE=$(json_field '.tool_input.title // empty')
  if [[ -n "$HAS_ID" && -z "$HAS_TITLE" ]]; then
    local DESC
    DESC=$(json_field '.tool_input.description // empty')
    if [[ -z "$DESC" ]]; then exit 0; fi
  fi

  # Use CLI for validation if available
  if command -v powr-workmaxxing &>/dev/null; then
    local TOOL_INPUT
    TOOL_INPUT=$(echo "$INPUT" | jq '.tool_input' 2>/dev/null || echo "{}")

    local RESULT
    RESULT=$(powr-workmaxxing ticket validate --json "$TOOL_INPUT" 2>/dev/null || echo '{"valid":true}')

    local VALID
    VALID=$(echo "$RESULT" | jq -r '.valid' 2>/dev/null || echo "true")

    if [[ "$VALID" == "false" ]]; then
      local ERRORS
      ERRORS=$(echo "$RESULT" | jq -r '.errors | join("\n  - ")' 2>/dev/null || echo "Validation failed")
      deny "BLOCKED: Ticket validation failed:\n  - $ERRORS"
    fi
  fi
}

handle_merge_coordination() {
  # PreToolUse on Bash — enforce rebase-before-merge for worktrees
  if ! has_db; then exit 0; fi

  local COMMAND
  COMMAND=$(json_field '.tool_input.command // empty')

  # Only intercept git merge with worktree branches
  if ! echo "$COMMAND" | grep -qE 'git\s+merge.*worktree-' 2>/dev/null; then exit 0; fi

  local BRANCH
  BRANCH=$(echo "$COMMAND" | grep -oE 'worktree-[a-zA-Z0-9_-]+' | head -1)
  if [[ -z "$BRANCH" ]]; then exit 0; fi

  # Check if branch has diverged from main
  local MERGE_BASE MAIN_HEAD
  MERGE_BASE=$(git -C "$PROJECT_DIR" merge-base main "$BRANCH" 2>/dev/null || echo "")
  MAIN_HEAD=$(git -C "$PROJECT_DIR" rev-parse main 2>/dev/null || echo "")

  if [[ -z "$MERGE_BASE" || -z "$MAIN_HEAD" ]]; then exit 0; fi

  if [[ "$MERGE_BASE" != "$MAIN_HEAD" ]]; then
    local AHEAD
    AHEAD=$(git -C "$PROJECT_DIR" rev-list --count "$MERGE_BASE".."$MAIN_HEAD" 2>/dev/null || echo "?")
    deny "BLOCKED: Cannot merge $BRANCH — main is $AHEAD commit(s) ahead.\nREQUIRED — rebase first:\n  git rebase main $BRANCH\nThen fast-forward merge:\n  git checkout main\n  git merge --ff-only $BRANCH"
  fi
}

handle_context_handoff() {
  # PreCompact — remind to post handoff comment
  if ! has_db; then exit 0; fi

  local WF_ID FEATURE STAGE
  WF_ID=$(query "SELECT id FROM workflows WHERE active=1 AND repo='$PROJECT_DIR' ORDER BY updated_at DESC LIMIT 1")
  if [[ -z "$WF_ID" ]]; then exit 0; fi

  FEATURE=$(query "SELECT feature_name FROM workflows WHERE id='$WF_ID'")
  STAGE=$(query "SELECT stage FROM workflows WHERE id='$WF_ID'")

  echo "CONTEXT EXHAUSTION ($FEATURE): Post a handoff comment NOW. Include: current step, completed work, in-progress work, remaining steps, key decisions. This ensures the next session can pick up cleanly."
}

handle_notification() {
  # Stop or Notification — macOS notification with sound
  if ! command -v osascript &>/dev/null; then exit 0; fi

  local EVENT_TYPE="${2:-stop}"

  if [[ "$EVENT_TYPE" == "stop" ]]; then
    reset_terminal_title
    osascript -e 'display notification "Task complete" with title "powr-workmaxxing" sound name "Glass"' 2>/dev/null || true
  else
    local MESSAGE
    MESSAGE=$(json_field '.message // "Attention needed"')
    MESSAGE=$(echo "$MESSAGE" | sed 's/["\\]/\\&/g' | head -c 200)
    osascript -e "display notification \"$MESSAGE\" with title \"powr-workmaxxing\" sound name \"Bottle\"" 2>/dev/null || true
  fi
}

handle_block_commit() {
  # PreToolUse on Bash — block git commit in review mode
  if ! has_db; then exit 0; fi
  if is_bypassed; then exit 0; fi
  if ! is_review_mode; then exit 0; fi

  local COMMAND
  COMMAND=$(json_field '.tool_input.command // empty')
  if echo "$COMMAND" | grep -qE 'git\s+commit' 2>/dev/null; then
    # Only block if there's an active workflow
    local WF_ID
    WF_ID=$(query "SELECT id FROM workflows WHERE active=1 AND repo='$PROJECT_DIR' LIMIT 1")
    if [[ -n "$WF_ID" ]]; then
      deny "REVIEW MODE: Do not commit. Stage changes with 'git add' but leave committing to the human. They will review, commit, and create a PR."
    fi
  fi
}

# ============================================================================
# DISPATCH
# ============================================================================

case "$HANDLER" in
  require-ticket)       handle_require_ticket ;;
  detect-work)          handle_detect_work ;;
  lifecycle)            handle_lifecycle ;;
  review-plan)          handle_review_plan ;;
  enforce-gates)        handle_enforce_gates ;;
  auto-record-status)   handle_auto_record_status ;;
  post-commit)          handle_post_commit ;;
  post-comment)         handle_post_comment ;;
  validate-ticket)      handle_validate_ticket ;;
  block-commit)         handle_block_commit ;;
  merge-coordination)   handle_merge_coordination ;;
  context-handoff)      handle_context_handoff ;;
  notification)         handle_notification ;;
  *)
    echo "Unknown handler: $HANDLER" >&2
    echo "Handlers: require-ticket, detect-work, lifecycle, review-plan, enforce-gates," >&2
    echo "          auto-record-status, post-commit, post-comment, validate-ticket," >&2
    echo "          block-commit, merge-coordination, context-handoff, notification" >&2
    exit 1
    ;;
esac
