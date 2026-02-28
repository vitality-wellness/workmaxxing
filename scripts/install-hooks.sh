#!/bin/bash
set -euo pipefail

# Install powr-workmaxxing hooks into all POWR repos.
#
# What it does:
# 1. Moves old bash hooks to _legacy/ (preserves for rollback)
# 2. Creates symlinks from each repo to the shared powr-hook.sh
# 3. Updates settings.local.json to point to the new hooks
#
# Usage: ./scripts/install-hooks.sh [--dry-run]

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKFLOW_DIR="$(dirname "$SCRIPT_DIR")"
HOOK_SOURCE="$WORKFLOW_DIR/hooks/powr-hook.sh"
SKILLS_DIR="$WORKFLOW_DIR/skills"

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  echo "[DRY RUN] No changes will be made."
fi

REPOS=(
  "$HOME/Dev/vitality/powr-frontend"
  "$HOME/Dev/vitality/powr-api"
  "$HOME/Dev/vitality/website"
)

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
)

for REPO in "${REPOS[@]}"; do
  REPO_NAME=$(basename "$REPO")
  HOOKS_DIR="$REPO/.claude/hooks"

  if [[ ! -d "$HOOKS_DIR" ]]; then
    echo "⏭  Skipping $REPO_NAME (no .claude/hooks/)"
    continue
  fi

  echo "📦 Installing hooks in $REPO_NAME..."

  # Move legacy hooks
  LEGACY_DIR="$HOOKS_DIR/_legacy"
  if [[ "$DRY_RUN" == "false" ]]; then
    mkdir -p "$LEGACY_DIR"
  fi

  for HOOK in "${LEGACY_HOOKS[@]}"; do
    if [[ -f "$HOOKS_DIR/$HOOK" && ! -L "$HOOKS_DIR/$HOOK" ]]; then
      echo "   Moving $HOOK → _legacy/"
      if [[ "$DRY_RUN" == "false" ]]; then
        mv "$HOOKS_DIR/$HOOK" "$LEGACY_DIR/$HOOK"
      fi
    fi
  done

  # Create symlink to shared hook runner
  SYMLINK_PATH="$HOOKS_DIR/powr-hook.sh"
  if [[ -L "$SYMLINK_PATH" || -f "$SYMLINK_PATH" ]]; then
    echo "   Removing existing powr-hook.sh"
    if [[ "$DRY_RUN" == "false" ]]; then
      rm -f "$SYMLINK_PATH"
    fi
  fi

  echo "   Symlinking powr-hook.sh → $HOOK_SOURCE"
  if [[ "$DRY_RUN" == "false" ]]; then
    ln -s "$HOOK_SOURCE" "$SYMLINK_PATH"
  fi

  # Also keep notification hooks (not migrated)
  echo "   Keeping notif-done.sh, notif-attention.sh (not migrated)"

  # Symlink skills
  SKILL_TARGET="$REPO/.claude/skills/workmaxxing"
  if [[ "$DRY_RUN" == "false" ]]; then
    mkdir -p "$SKILL_TARGET"
  fi

  for SKILL in spec plan execute ship; do
    if [[ -L "$SKILL_TARGET/$SKILL.md" ]]; then
      echo "   Skill $SKILL.md already linked"
    else
      echo "   Symlinking skill $SKILL.md"
      if [[ "$DRY_RUN" == "false" ]]; then
        ln -sf "$SKILLS_DIR/$SKILL.md" "$SKILL_TARGET/$SKILL.md"
      fi
    fi
  done

  echo "   ✅ Done"
  echo ""
done

echo "Installed in all repos:"
echo "  - powr-hook.sh (11 handlers)"
echo "  - 4 skills (/spec, /plan, /execute, /ship)"
echo ""
echo "Next: Update settings.local.json in each repo to point hooks to powr-hook.sh"
echo "Test: powr-workmaxxing status"
echo "Rollback: mv .claude/hooks/_legacy/* .claude/hooks/"
