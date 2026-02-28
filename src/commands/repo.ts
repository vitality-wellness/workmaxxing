import { Command } from "commander";
import { getRepoConfig } from "../config/repo-config.js";
import { execSync } from "node:child_process";

export const repoCommand = new Command("repo").description(
  "Repo-specific lifecycle commands"
);

repoCommand
  .command("analyze")
  .description("Run repo-appropriate static analysis")
  .option("--repo <path>", "Repository path", process.cwd())
  .action((opts: { repo: string }) => {
    const config = getRepoConfig(opts.repo);
    if (!config?.analyzeCommand) {
      console.log("No analyze command configured for this repo.");
      return;
    }

    console.log(`Running: ${config.analyzeCommand}`);
    try {
      execSync(config.analyzeCommand, {
        cwd: opts.repo,
        stdio: "inherit",
      });
      console.log("Analysis passed.");
    } catch {
      console.error("Analysis failed.");
      process.exit(1);
    }
  });

repoCommand
  .command("info")
  .description("Show repo configuration")
  .option("--repo <path>", "Repository path", process.cwd())
  .option("--json", "Output as JSON")
  .action((opts: { repo: string; json?: boolean }) => {
    const config = getRepoConfig(opts.repo);

    if (!config) {
      console.log("No configuration found for this repo.");
      console.log("Configure in ~/.powr/repos.json");
      return;
    }

    if (opts.json) {
      console.log(JSON.stringify(config));
    } else {
      console.log(`Name:             ${config.name}`);
      console.log(`Team:             ${config.team}`);
      console.log(`Production paths: ${config.productionPaths.join(", ")}`);
      console.log(`Analyze:          ${config.analyzeCommand ?? "none"}`);
      console.log(`Restart:          ${config.restartCommand ?? "none"}`);
    }
  });
