import { Command } from "commander";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

// The repo is always at a known location since it's npm-linked
const WORKMAXXING_DIR = join(homedir(), "Dev", "vitality", "powr-workmaxxing");

export const installCommand = new Command("install")
  .description("Install hooks + skills into a repo")
  .argument("[repo]", "Repo path (default: current directory)")
  .option("--all", "Install in all known repos")
  .option("--dry-run", "Preview without changes")
  .action(
    (
      repo: string | undefined,
      opts: { all?: boolean; dryRun?: boolean }
    ) => {
      const installScript = join(WORKMAXXING_DIR, "scripts", "install-hooks.sh");

      if (!existsSync(installScript)) {
        console.error(
          `Error: Cannot find ${installScript}\nIs powr-workmaxxing at ~/Dev/vitality/powr-workmaxxing?`
        );
        process.exit(2);
      }

      const args: string[] = [];
      if (opts.dryRun) args.push("--dry-run");
      if (opts.all) args.push("--all");
      if (repo) args.push(repo);

      try {
        execSync(`bash "${installScript}" ${args.join(" ")}`, {
          stdio: "inherit",
        });
      } catch {
        process.exit(1);
      }
    }
  );
