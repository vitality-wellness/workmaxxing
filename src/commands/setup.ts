import { Command } from "commander";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { getDb } from "../store/db.js";
import { loadRepoConfigs } from "../config/repo-config.js";

export const setupCommand = new Command("setup")
  .description("First-time setup — creates ~/.powr/ and initializes the database")
  .action(() => {
    const powrDir = join(homedir(), ".powr");

    // 1. Create ~/.powr/
    if (!existsSync(powrDir)) {
      mkdirSync(powrDir, { recursive: true });
      console.log("Created ~/.powr/");
    } else {
      console.log("~/.powr/ already exists");
    }

    // 2. Initialize SQLite database
    const db = getDb();
    db.close();
    console.log("Database ready at ~/.powr/workflow.db");

    // 3. Create default repo config
    loadRepoConfigs();
    console.log("Repo config at ~/.powr/repos.json");

    console.log();
    console.log("Setup complete. Now install in your repo:");
    console.log("  cd /path/to/your-repo");
    console.log("  powr-workmaxxing install");
  });
