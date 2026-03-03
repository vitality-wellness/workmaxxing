import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Primitive 1: Per-repo configuration.
 */

export interface RepoConfig {
  name: string;
  team: string;
  productionPaths: string[];
  analyzeCommand: string | null;
  restartCommand: string | null;
  reviewMode?: boolean;
}

type RepoConfigMap = Record<string, RepoConfig>;

export const CONFIG_PATH = join(homedir(), ".powr", "repos.json");

const DEFAULTS: RepoConfigMap = {
  "powr-frontend": {
    name: "frontend",
    team: "POWR",
    productionPaths: ["lib/", "ios/"],
    analyzeCommand: "dart analyze",
    restartCommand: "./scripts/run_prod.sh",
  },
  "powr-api": {
    name: "api",
    team: "POWR",
    productionPaths: ["internal/", "cmd/"],
    analyzeCommand: "go vet ./...",
    restartCommand: null,
  },
  website: {
    name: "website",
    team: "POWR",
    productionPaths: ["src/"],
    analyzeCommand: "npm run build",
    restartCommand: null,
  },
};

let cachedConfig: RepoConfigMap | null = null;

export function loadRepoConfigs(): RepoConfigMap {
  if (cachedConfig) return cachedConfig;

  if (existsSync(CONFIG_PATH)) {
    try {
      cachedConfig = JSON.parse(
        readFileSync(CONFIG_PATH, "utf-8")
      ) as RepoConfigMap;
      return cachedConfig;
    } catch {
      // Fall through to defaults
    }
  }

  // Write defaults on first use
  const dir = join(homedir(), ".powr");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULTS, null, 2));
  cachedConfig = DEFAULTS;
  return cachedConfig;
}

/**
 * Resolve repo config from a full path.
 * Matches by checking if any key is a suffix of the path.
 */
export function getRepoConfig(repoPath: string): RepoConfig | null {
  const configs = loadRepoConfigs();

  // Try exact key match first
  if (configs[repoPath]) return configs[repoPath];

  // Try suffix match (path ends with key)
  for (const [key, config] of Object.entries(configs)) {
    if (repoPath.endsWith(key) || repoPath.endsWith(`/${key}`)) {
      return config;
    }
  }

  return null;
}

/**
 * Find the config key that matches a repo path.
 */
export function getRepoConfigKey(repoPath: string): string | null {
  const configs = loadRepoConfigs();

  if (configs[repoPath]) return repoPath;

  for (const key of Object.keys(configs)) {
    if (repoPath.endsWith(key) || repoPath.endsWith(`/${key}`)) {
      return key;
    }
  }

  return null;
}

/**
 * Register a new repo with minimal defaults using its directory basename as the key.
 */
export function registerRepo(repoPath: string): boolean {
  const configs = loadRepoConfigs();
  const basename = repoPath.replace(/\/+$/, "").split("/").pop();
  if (!basename) return false;

  // Already registered
  if (getRepoConfigKey(repoPath)) return true;

  configs[basename] = {
    name: basename,
    team: "",
    productionPaths: [],
    analyzeCommand: null,
    restartCommand: null,
  };
  writeFileSync(CONFIG_PATH, JSON.stringify(configs, null, 2));
  cachedConfig = configs;
  return true;
}

/**
 * Set a field on a repo's config and write back to disk.
 */
export function setRepoConfigField(
  repoPath: string,
  field: string,
  value: unknown
): boolean {
  const configs = loadRepoConfigs();
  const key = getRepoConfigKey(repoPath);
  if (!key || !configs[key]) return false;

  (configs[key] as unknown as Record<string, unknown>)[field] = value;
  writeFileSync(CONFIG_PATH, JSON.stringify(configs, null, 2));
  cachedConfig = configs;
  return true;
}

/**
 * Check if a file path is a production file for the given repo.
 */
export function isProductionFile(
  repoPath: string,
  filePath: string
): boolean {
  const config = getRepoConfig(repoPath);
  if (!config) return false;

  // Normalize to relative path
  const relative = filePath.startsWith(repoPath)
    ? filePath.slice(repoPath.length).replace(/^\//, "")
    : filePath;

  return config.productionPaths.some((prefix) => relative.startsWith(prefix));
}
