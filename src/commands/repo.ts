import { Command } from "commander";
import { getRepoConfig, setRepoConfigField, registerRepo } from "../config/repo-config.js";
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
      console.log(`Review mode:      ${config.reviewMode ? "on" : "off"}`);
    }
  });

repoCommand
  .command("set")
  .description("Set a repo configuration field")
  .argument("<key>", "Config field name (e.g. reviewMode)")
  .argument("<value>", "Value to set (true/false for booleans)")
  .option("--repo <path>", "Repository path", process.cwd())
  .action((key: string, value: string, opts: { repo: string }) => {
    // Parse value — support booleans and null
    let parsed: unknown;
    if (value === "true") parsed = true;
    else if (value === "false") parsed = false;
    else if (value === "null") parsed = null;
    else parsed = value;

    let ok = setRepoConfigField(opts.repo, key, parsed);
    if (!ok) {
      // Auto-register the repo with minimal defaults
      ok = registerRepo(opts.repo);
      if (ok) {
        ok = setRepoConfigField(opts.repo, key, parsed);
      }
    }

    if (!ok) {
      console.error(`Failed to set config. Check ~/.powr/repos.json`);
      process.exit(1);
    }

    console.log(`Set ${key} = ${JSON.stringify(parsed)}`);
  });
