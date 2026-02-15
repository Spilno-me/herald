#!/usr/bin/env node
/**
 * Herald Logout CLI
 *
 * Clears stored authentication token.
 *
 * Usage: npx @spilno/herald-mcp logout
 */

import { existsSync, unlinkSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const CONFIG_DIR = join(homedir(), ".herald");
const TOKEN_FILE = join(CONFIG_DIR, "token.json");

export interface LogoutOptions {
  help?: boolean;
}

export function parseLogoutArgs(args: string[]): LogoutOptions {
  const options: LogoutOptions = {};

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    }
  }

  return options;
}

function printLogoutHelp(): void {
  console.log(`
Herald Logout - Clear stored authentication

Usage:
  npx @spilno/herald-mcp logout [options]

Options:
  --help, -h      Show this help

This removes ~/.herald/token.json
Herald will continue to work but patterns won't sync to your account.
`);
}

export async function runLogout(args: string[] = []): Promise<void> {
  const options = parseLogoutArgs(args);

  if (options.help) {
    printLogoutHelp();
    return;
  }

  if (!existsSync(TOKEN_FILE)) {
    console.log("Not logged in. Nothing to do.");
    return;
  }

  // Show who we're logging out
  try {
    const data = JSON.parse(readFileSync(TOKEN_FILE, "utf-8"));
    const login = data.user?.login || "unknown";
    unlinkSync(TOKEN_FILE);
    console.log(`Logged out ${login}`);
    console.log(`\nToken removed from ~/.herald/token.json`);
  } catch {
    unlinkSync(TOKEN_FILE);
    console.log("Logged out. Token file removed.");
  }

  console.log(`
Herald will continue to work locally.
Patterns captured will use path-based context (low trust, no propagation).

To login again:
  npx @spilno/herald-mcp login
`);
}
