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

/**
 * Find the powr-workmaxxing source directory.
 * Tries multiple resolution strategies.
 */
function findSourceDir(): string | null {
  const candidates = [
    // npm link: follow the symlink from the bin entry
    resolve(dirname(fileURLToPath(import.meta.url)), ".."),
    resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."),
    // Common dev locations
    resolve(process.env["HOME"] ?? "", "Dev", "vitality", "powr-workmaxxing"),
  ];

  for (const dir of candidates) {
    if (
      existsSync(join(dir, "hooks", HOOK_FILENAME)) &&
      existsSync(join(dir, "skills", "powr", "spec", "SKILL.md"))
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

      console.log("Test: powr-workmaxxing status");
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

  // Move legacy hooks
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
    console.log(`  Moved ${legacyCount} legacy hooks → _legacy/`);
  }

  // Symlink hook runner
  const hookLink = join(hooksDir, HOOK_FILENAME);
  if (!dryRun) {
    if (existsSync(hookLink)) unlinkSync(hookLink);
    symlinkSync(hookSource, hookLink);
  }
  console.log("  Linked powr-hook.sh");

  // Symlink powr/ skill directory
  const skillSrc = join(skillsDir, SKILL_DIR);
  const skillDest = join(skillsBase, SKILL_DIR);
  if (!dryRun) {
    if (existsSync(skillDest)) {
      if (lstatSync(skillDest).isSymbolicLink()) {
        unlinkSync(skillDest);
      }
    }
    symlinkSync(skillSrc, skillDest);
  }
  console.log("  Linked skills: powr:spec, powr:plan, powr:execute, powr:ship");

  console.log("  Done.\n");
}
