/**
 * Shared auth utilities for Herald MCP.
 * Used by CLI subcommands (login, config, upgrade) and cli.ts.
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { exec } from "child_process";
import { TOKEN_FILE } from "./paths.js";

export interface AuthConfig {
  token: string;
  refreshToken?: string;
  expiresAt: string;
  user: {
    login: string;
    email?: string;
  };
}

/**
 * Load stored auth from ~/.herald/token.json.
 * Returns null if missing, unparseable, or expired.
 */
export function getStoredAuth(): AuthConfig | null {
  if (!existsSync(TOKEN_FILE)) return null;
  try {
    const data = JSON.parse(readFileSync(TOKEN_FILE, "utf-8"));
    if (new Date(data.expiresAt) < new Date()) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * Open a URL in the user's default browser (cross-platform).
 */
export function openBrowser(url: string): void {
  const platform = process.platform;
  let cmd: string;

  if (platform === "darwin") {
    cmd = `open "${url}"`;
  } else if (platform === "win32") {
    cmd = `start "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }

  exec(cmd, (err) => {
    if (err) {
      console.log(`\nCould not open browser. Please visit:\n${url}\n`);
    }
  });
}

/**
 * Resolve the CEDA API token.
 * Priority: CEDA_TOKEN > HERALD_API_TOKEN (deprecated) > stored token.
 */
export function getCedaToken(): string | undefined {
  if (process.env.CEDA_TOKEN) {
    return process.env.CEDA_TOKEN;
  }

  if (process.env.HERALD_API_TOKEN) {
    console.error("[Herald] HERALD_API_TOKEN is deprecated, use CEDA_TOKEN instead");
    return process.env.HERALD_API_TOKEN;
  }

  return loadStoredTokens().token;
}

export interface StoredTokens {
  token?: string;
  refreshToken?: string;
}

/**
 * Load stored tokens from ~/.herald/token.json.
 * Returns { token, refreshToken } or empty object if missing/unparseable.
 */
export function loadStoredTokens(): StoredTokens {
  try {
    if (existsSync(TOKEN_FILE)) {
      const data = JSON.parse(readFileSync(TOKEN_FILE, "utf-8"));
      return {
        token: data.token || undefined,
        refreshToken: data.refreshToken || undefined,
      };
    }
  } catch {
    // Ignore errors reading token file
  }
  return {};
}

/**
 * Write updated access/refresh tokens back to ~/.herald/token.json.
 * Merges into existing file to preserve user info and other fields.
 * Non-fatal on failure — tokens can still work in memory.
 */
export function persistTokens(
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
): void {
  try {
    if (!existsSync(TOKEN_FILE)) return;
    const existing = JSON.parse(readFileSync(TOKEN_FILE, "utf-8"));
    existing.token = accessToken;
    existing.refreshToken = refreshToken;
    try {
      const payload = JSON.parse(
        Buffer.from(accessToken.split(".")[1], "base64").toString(),
      );
      existing.expiresAt = payload.exp
        ? new Date(payload.exp * 1000).toISOString()
        : new Date(Date.now() + expiresIn * 1000).toISOString();
    } catch {
      existing.expiresAt = new Date(
        Date.now() + expiresIn * 1000,
      ).toISOString();
    }
    writeFileSync(TOKEN_FILE, JSON.stringify(existing, null, 2), "utf-8");
  } catch {
    // Non-fatal: tokens work in memory even if disk write fails
  }
}

const TOKEN_EXPIRY_GRACE_MS = 60_000;

/**
 * Check if a JWT token is expired (with 60s grace period).
 */
export function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
    if (!payload.exp) return true;
    return payload.exp * 1000 < Date.now() + TOKEN_EXPIRY_GRACE_MS;
  } catch {
    return true;
  }
}
