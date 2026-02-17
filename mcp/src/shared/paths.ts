/**
 * Shared path constants and URL resolution for Herald MCP.
 * Single source of truth — used by cli.ts, sdk.ts, and CLI subcommands.
 */
import { homedir } from "os";
import { join } from "path";

export const CONFIG_DIR = join(homedir(), ".herald");
export const TOKEN_FILE = join(CONFIG_DIR, "token.json");

/**
 * Resolve the CEDA API base URL.
 * Priority: CEDA_URL > HERALD_API_URL > default cloud.
 */
export function getCedaUrl(): string {
  return process.env.CEDA_URL || process.env.HERALD_API_URL || "https://getceda.com";
}
