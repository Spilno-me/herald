#!/usr/bin/env node
/**
 * Herald Upgrade CLI
 *
 * Opens billing page to upgrade plan.
 * Shows current usage stats first.
 *
 * Usage: npx @spilno/herald-mcp upgrade
 */

import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { exec } from "child_process";

const CEDA_URL = process.env.CEDA_URL || "https://getceda.com";
const CONFIG_DIR = join(homedir(), ".herald");
const TOKEN_FILE = join(CONFIG_DIR, "token.json");

interface AuthConfig {
  token: string;
  user: { login: string };
}

function getStoredAuth(): AuthConfig | null {
  if (!existsSync(TOKEN_FILE)) return null;
  try {
    return JSON.parse(readFileSync(TOKEN_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function openBrowser(url: string): void {
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

export interface UpgradeOptions {
  help?: boolean;
}

export function parseUpgradeArgs(args: string[]): UpgradeOptions {
  const options: UpgradeOptions = {};

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    }
  }

  return options;
}

function printUpgradeHelp(): void {
  console.log(`
Herald Upgrade - Manage your CEDA subscription

Usage:
  npx @spilno/herald-mcp upgrade [options]

Options:
  --help, -h      Show this help

Plans:
  Free    $0/mo   1 project, 100 patterns, 1K queries/mo
  Pro     $9/mo   Unlimited projects, 10K patterns, unlimited queries
  Team    $29/seat/mo   Org sharing, cross-project propagation

This opens the CEDA billing portal in your browser.
`);
}

interface UsageStats {
  plan: string;
  patterns: { used: number; limit: number };
  queries: { used: number; limit: number };
  projects: { used: number; limit: number };
}

async function fetchUsage(auth: AuthConfig): Promise<UsageStats | null> {
  try {
    const response = await fetch(`${CEDA_URL}/api/usage`, {
      headers: {
        Authorization: `Bearer ${auth.token}`,
      },
    });

    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function formatUsage(used: number, limit: number): string {
  const percentage = limit > 0 ? Math.round((used / limit) * 100) : 0;
  const bar = "=".repeat(Math.min(20, Math.round(percentage / 5))) + " ".repeat(20 - Math.round(percentage / 5));

  if (limit === -1) {
    return `${used} (unlimited)`;
  }

  const warning = percentage >= 80 ? " !" : "";
  return `${used}/${limit} [${bar}] ${percentage}%${warning}`;
}

export async function runUpgrade(args: string[] = []): Promise<void> {
  const options = parseUpgradeArgs(args);

  if (options.help) {
    printUpgradeHelp();
    return;
  }

  const auth = getStoredAuth();

  if (!auth) {
    console.log(`
Not logged in. Login first to manage your subscription:

  npx @spilno/herald-mcp login
  npx @spilno/herald-mcp upgrade
`);
    return;
  }

  console.log(`Fetching usage for ${auth.user.login}...\n`);

  const usage = await fetchUsage(auth);

  if (usage) {
    console.log(`Current Plan: ${usage.plan.toUpperCase()}`);
    console.log();
    console.log(`Patterns:  ${formatUsage(usage.patterns.used, usage.patterns.limit)}`);
    console.log(`Queries:   ${formatUsage(usage.queries.used, usage.queries.limit)}`);
    console.log(`Projects:  ${formatUsage(usage.projects.used, usage.projects.limit)}`);
    console.log();

    // Check if near limits
    const patternsPercent = usage.patterns.limit > 0 ? (usage.patterns.used / usage.patterns.limit) * 100 : 0;
    const queriesPercent = usage.queries.limit > 0 ? (usage.queries.used / usage.queries.limit) * 100 : 0;

    if (patternsPercent >= 80 || queriesPercent >= 80) {
      console.log("You're approaching your plan limits. Consider upgrading.\n");
    }
  } else {
    console.log("Could not fetch usage stats.\n");
  }

  const billingUrl = `${CEDA_URL}/billing?user=${auth.user.login}`;

  console.log("Opening billing portal...\n");
  openBrowser(billingUrl);

  console.log(`If browser doesn't open, visit:\n${billingUrl}`);
}
