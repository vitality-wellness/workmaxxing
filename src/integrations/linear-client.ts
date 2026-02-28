import { LinearClient } from "@linear/sdk";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

let client: LinearClient | null = null;

/**
 * Get a Linear API client. Looks for the API key in:
 * 1. LINEAR_API_KEY environment variable
 * 2. ~/.powr/linear-api-key file
 */
export function getLinearClient(): LinearClient {
  if (client) return client;

  let apiKey = process.env["LINEAR_API_KEY"];

  if (!apiKey) {
    const keyFile = join(homedir(), ".powr", "linear-api-key");
    if (existsSync(keyFile)) {
      apiKey = readFileSync(keyFile, "utf-8").trim();
    }
  }

  if (!apiKey) {
    throw new Error(
      "Linear API key not found. Set LINEAR_API_KEY env var or create ~/.powr/linear-api-key"
    );
  }

  client = new LinearClient({ apiKey });
  return client;
}
