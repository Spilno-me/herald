/**
 * Shared path constants and URL resolution for Herald MCP.
 * Single source of truth — used by cli.ts, sdk.ts, and CLI subcommands.
 */
import { homedir } from "os";
import { join } from "path";

export const CONFIG_DIR = join(homedir(), ".herald");
export const TOKEN_FILE = join(CONFIG_DIR, "token.json");

/** Default CEDA cloud URL — single source of truth for all modules. */
export const DEFAULT_CEDA_URL = "https://getceda.com";

/**
 * Resolve the CEDA API base URL.
 * Priority: CEDA_URL > HERALD_API_URL (deprecated) > default cloud.
 */
export function getCedaUrl(): string {
  if (process.env.CEDA_URL) {
    return process.env.CEDA_URL;
  }

  if (process.env.HERALD_API_URL) {
    console.error("[Herald] HERALD_API_URL is deprecated, use CEDA_URL instead");
    return process.env.HERALD_API_URL;
  }

  return DEFAULT_CEDA_URL;
}
