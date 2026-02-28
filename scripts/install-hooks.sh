#!/bin/bash
set -euo pipefail

# Install powr-workmaxxing into a repo.
#
# Usage:
#   powr-workmaxxing install                    ← install in current directory
#   powr-workmaxxing install /path/to/repo      ← install in specific repo
#   powr-workmaxxing install --all              ← install in all known repos
#   powr-workmaxxing install --dry-run          ← preview without changes
#
# What it does:
#   1. Creates .claude/hooks/ and .claude/skills/powr/ if missing
#   2. Symlinks powr-hook.sh (single hook runner)
#   3. Symlinks 4 skills (spec, plan, execute, ship)
#   4. Moves any legacy bash hooks to _legacy/

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKFLOW_DIR="$(dirname "$SCRIPT_DIR")"
HOOK_SOURCE="$WORKFLOW_DIR/hooks/powr-hook.sh"
SKILLS_DIR="$WORKFLOW_DIR/skills"

DRY_RUN=false
TARGETS=()

# Parse args
for ARG in "$@"; do
  case "$ARG" in
    --dry-run)
      DRY_RUN=true
      ;;
    --all)
      TARGETS=(
        "$HOME/Dev/vitality/powr-frontend"
        "$HOME/Dev/vitality/powr-api"
        "$HOME/Dev/vitality/website"
      )
      ;;
    *)
      TARGETS+=("$ARG")
      ;;
  esac
done

# Default: current directory
if [[ ${#TARGETS[@]} -eq 0 ]]; then
  TARGETS=("$(pwd)")
fi

if [[ "$DRY_RUN" == "true" ]]; then
  echo "[DRY RUN] No changes will be made."
  echo ""
fi

LEGACY_HOOKS=(
  "require-active-ticket.sh"
  "detect-ticket-work.sh"
  "ticket-lifecycle.sh"
  "enforce-ticket-gates.sh"
  "record-ticket-gate.sh"
  "review-plan.sh"
  "coordinate-merge.sh"
  "enforce-ac-in-description.sh"
  "enforce-ticket-fields.sh"
  "auto-review-trigger.sh"
  "context-handoff.sh"
  "review-plan-prompt.md"
)

install_repo() {
  local REPO="$1"
  local REPO_NAME=$(basename "$REPO")
  local HOOKS_DIR="$REPO/.claude/hooks"
  local SKILL_TARGET="$REPO/.claude/skills/powr"

  echo "Installing in $REPO_NAME ($REPO)..."

  # Create directories
  if [[ "$DRY_RUN" == "false" ]]; then
    mkdir -p "$HOOKS_DIR"
    mkdir -p "$SKILL_TARGET"
  fi

  # Move legacy hooks to _legacy/
  local LEGACY_COUNT=0
  for HOOK in "${LEGACY_HOOKS[@]}"; do
    if [[ -f "$HOOKS_DIR/$HOOK" && ! -L "$HOOKS_DIR/$HOOK" ]]; then
      LEGACY_COUNT=$((LEGACY_COUNT + 1))
      if [[ "$DRY_RUN" == "false" ]]; then
        mkdir -p "$HOOKS_DIR/_legacy"
        mv "$HOOKS_DIR/$HOOK" "$HOOKS_DIR/_legacy/$HOOK"
      fi
    fi
  done
  if [[ "$LEGACY_COUNT" -gt 0 ]]; then
    echo "  Moved $LEGACY_COUNT legacy hooks to _legacy/"
  fi

  # Symlink hook runner
  local HOOK_LINK="$HOOKS_DIR/powr-hook.sh"
  if [[ "$DRY_RUN" == "false" ]]; then
    rm -f "$HOOK_LINK"
    ln -s "$HOOK_SOURCE" "$HOOK_LINK"
  fi
  echo "  Linked powr-hook.sh"

  # Symlink skills
  for SKILL in spec plan execute ship; do
    if [[ "$DRY_RUN" == "false" ]]; then
      ln -sf "$SKILLS_DIR/$SKILL.md" "$SKILL_TARGET/$SKILL.md"
    fi
  done
  echo "  Linked 4 skills (powr:spec, powr:plan, powr:execute, powr:ship)"

  echo "  Done."
  echo ""
}

for TARGET in "${TARGETS[@]}"; do
  # Resolve to absolute path
  TARGET=$(cd "$TARGET" 2>/dev/null && pwd || echo "$TARGET")

  if [[ ! -d "$TARGET" ]]; then
    echo "Skipping $TARGET (directory not found)"
    continue
  fi

  install_repo "$TARGET"
done

echo "Installed. Test with: powr-workmaxxing status"
echo "Rollback legacy hooks: mv .claude/hooks/_legacy/* .claude/hooks/"
