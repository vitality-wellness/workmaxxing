import { Command } from "commander";
import {
  existsSync,
  mkdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  readFileSync,
  renameSync,
  lstatSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_DIR = "powr";
const HOOK_FILENAME = "powr-hook.sh";

const LEGACY_HOOKS = [
  "require-active-ticket.sh",
  "detect-ticket-work.sh",
  "ticket-lifecycle.sh",
  "enforce-ticket-gates.sh",
  "record-ticket-gate.sh",
  "review-plan.sh",
  "coordinate-merge.sh",
  "enforce-ac-in-description.sh",
  "enforce-ticket-fields.sh",
  "auto-review-trigger.sh",
  "context-handoff.sh",
  "review-plan-prompt.md",
];

/** The hooks config that replaces all legacy hooks */
const POWR_HOOKS = {
  UserPromptSubmit: [
    {
      hooks: [
        {
          type: "command",
          command:
            '"$CLAUDE_PROJECT_DIR"/.claude/hooks/powr-hook.sh detect-work',
        },
      ],
    },
  ],
  PreToolUse: [
    {
      matcher: "Edit|Write",
      hooks: [
        {
          type: "command",
          command:
            '"$CLAUDE_PROJECT_DIR"/.claude/hooks/powr-hook.sh require-ticket',
        },
      ],
    },
    {
      matcher: "ExitPlanMode",
      hooks: [
        {
          type: "command",
          command:
            '"$CLAUDE_PROJECT_DIR"/.claude/hooks/powr-hook.sh review-plan',
        },
      ],
    },
    {
      matcher: "mcp__plugin_linear_linear__save_issue",
      hooks: [
        {
          type: "command",
          command:
            '"$CLAUDE_PROJECT_DIR"/.claude/hooks/powr-hook.sh enforce-gates',
        },
      ],
    },
    {
      matcher: "mcp__plugin_linear_linear__save_issue",
      hooks: [
        {
          type: "command",
          command:
            '"$CLAUDE_PROJECT_DIR"/.claude/hooks/powr-hook.sh validate-ticket',
        },
      ],
    },
    {
      matcher: "Bash",
      hooks: [
        {
          type: "command",
          command:
            '"$CLAUDE_PROJECT_DIR"/.claude/hooks/powr-hook.sh block-commit',
        },
      ],
    },
    {
      matcher: "Bash",
      hooks: [
        {
          type: "command",
          command:
            '"$CLAUDE_PROJECT_DIR"/.claude/hooks/powr-hook.sh merge-coordination',
        },
      ],
    },
  ],
  PostToolUse: [
    {
      matcher: "Bash",
      hooks: [
        {
          type: "command",
          command:
            '"$CLAUDE_PROJECT_DIR"/.claude/hooks/powr-hook.sh post-commit',
        },
      ],
    },
    {
      matcher: "mcp__plugin_linear_linear__save_issue",
      hooks: [
        {
          type: "command",
          command:
            '"$CLAUDE_PROJECT_DIR"/.claude/hooks/powr-hook.sh auto-record-status',
        },
      ],
    },
    {
      matcher: "mcp__plugin_linear_linear__create_comment",
      hooks: [
        {
          type: "command",
          command:
            '"$CLAUDE_PROJECT_DIR"/.claude/hooks/powr-hook.sh post-comment',
        },
      ],
    },
  ],
  Stop: [
    {
      hooks: [
        {
          type: "command",
          command:
            '"$CLAUDE_PROJECT_DIR"/.claude/hooks/powr-hook.sh notification stop',
        },
      ],
    },
    {
      hooks: [
        {
          type: "command",
          command:
            '"$CLAUDE_PROJECT_DIR"/.claude/hooks/powr-hook.sh lifecycle',
        },
      ],
    },
  ],
  Notification: [
    {
      hooks: [
        {
          type: "command",
          command:
            '"$CLAUDE_PROJECT_DIR"/.claude/hooks/powr-hook.sh notification attention',
        },
      ],
    },
  ],
  PreCompact: [
    {
      hooks: [
        {
          type: "command",
          command:
            '"$CLAUDE_PROJECT_DIR"/.claude/hooks/powr-hook.sh context-handoff',
        },
      ],
    },
  ],
};

function findSourceDir(): string | null {
  const candidates = [
    resolve(dirname(fileURLToPath(import.meta.url)), ".."),
    resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."),
    resolve(process.env["HOME"] ?? "", "Dev", "vitality", "powr-workmaxxing"),
  ];

  for (const dir of candidates) {
    if (
      existsSync(join(dir, "hooks", HOOK_FILENAME)) &&
      existsSync(join(dir, "skills", SKILL_DIR, "SKILL.md"))
    ) {
      return dir;
    }
  }

  return null;
}

export const installCommand = new Command("install")
  .description("Install hooks + skills into a repo")
  .argument("[repo]", "Repo path (default: current directory)")
  .option("--all", "Install in all known POWR repos")
  .option("--dry-run", "Preview without changes")
  .action(
    (
      repo: string | undefined,
      opts: { all?: boolean; dryRun?: boolean }
    ) => {
      const sourceDir = findSourceDir();
      if (!sourceDir) {
        console.error(
          "Error: Cannot find powr-workmaxxing source files (hooks/ and skills/).\n" +
            "Make sure the package is installed properly."
        );
        process.exit(2);
      }

      const hookSource = join(sourceDir, "hooks", HOOK_FILENAME);
      const skillsDir = join(sourceDir, "skills");

      let targets: string[];
      if (opts.all) {
        const home = process.env["HOME"] ?? "";
        targets = [
          join(home, "Dev", "vitality", "powr-frontend"),
          join(home, "Dev", "vitality", "powr-api"),
          join(home, "Dev", "vitality", "website"),
        ];
      } else {
        targets = [resolve(repo ?? process.cwd())];
      }

      if (opts.dryRun) {
        console.log("[DRY RUN] No changes will be made.\n");
      }

      for (const target of targets) {
        if (!existsSync(target)) {
          console.log(`Skipping ${target} (not found)`);
          continue;
        }
        installInRepo(target, hookSource, skillsDir, opts.dryRun ?? false);
      }

      console.log("Done. Restart Claude Code to pick up the new skill.");
    }
  );

function installInRepo(
  repoPath: string,
  hookSource: string,
  skillsDir: string,
  dryRun: boolean
): void {
  const repoName =
    repoPath.split("/").filter(Boolean).pop() ?? repoPath;
  const hooksDir = join(repoPath, ".claude", "hooks");
  const skillsBase = join(repoPath, ".claude", "skills");

  console.log(`Installing in ${repoName}...`);

  if (!dryRun) {
    mkdirSync(hooksDir, { recursive: true });
    mkdirSync(skillsBase, { recursive: true });
  }

  // Move legacy hook files
  let legacyCount = 0;
  for (const hook of LEGACY_HOOKS) {
    const hookPath = join(hooksDir, hook);
    if (existsSync(hookPath) && !lstatSync(hookPath).isSymbolicLink()) {
      legacyCount++;
      if (!dryRun) {
        const legacyDir = join(hooksDir, "_legacy");
        mkdirSync(legacyDir, { recursive: true });
        renameSync(hookPath, join(legacyDir, hook));
      }
    }
  }
  if (legacyCount > 0) {
    console.log(`  Moved ${legacyCount} legacy hook files → _legacy/`);
  }

  // Symlink hook runner
  const hookLink = join(hooksDir, HOOK_FILENAME);
  if (!dryRun) {
    if (existsSync(hookLink)) unlinkSync(hookLink);
    symlinkSync(hookSource, hookLink);
  }
  console.log("  Linked powr-hook.sh");

  // Symlink skill directory
  const skillSrc = join(skillsDir, SKILL_DIR);
  const skillDest = join(skillsBase, SKILL_DIR);
  if (!dryRun) {
    if (existsSync(skillDest) && lstatSync(skillDest).isSymbolicLink()) {
      unlinkSync(skillDest);
    }
    if (!existsSync(skillDest)) {
      symlinkSync(skillSrc, skillDest);
    }
  }
  console.log("  Linked skill: /powr");

  // Update settings.local.json — replace hooks section
  updateSettings(repoPath, dryRun);

  console.log("");
}

function updateSettings(repoPath: string, dryRun: boolean): void {
  const settingsPath = join(repoPath, ".claude", "settings.local.json");

  let settings: Record<string, unknown> = {};

  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf-8")) as Record<
        string,
        unknown
      >;
    } catch {
      console.log("  Warning: Could not parse settings.local.json, creating fresh hooks section");
    }
  }

  // Replace the hooks section entirely
  settings["hooks"] = POWR_HOOKS;

  if (!dryRun) {
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  }
  console.log("  Updated settings.local.json (hooks → powr-hook.sh)");
}
