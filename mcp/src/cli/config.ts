#!/usr/bin/env node
/**
 * Herald Config CLI
 *
 * Outputs MCP configuration JSON for any MCP-compatible client.
 * Works with: Claude Code, Cursor, Windsurf, Cline, etc.
 *
 * Usage: npx @spilno/herald-mcp config [--client cursor]
 */

import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { join, basename } from "path";

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

export interface ConfigOptions {
  help?: boolean;
  client?: string;  // claude, cursor, windsurf, generic
  project?: string;
  json?: boolean;   // Output raw JSON only
}

export function parseConfigArgs(args: string[]): ConfigOptions {
  const options: ConfigOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--client" || arg === "-c") {
      options.client = args[++i];
    } else if (arg === "--project" || arg === "-p") {
      options.project = args[++i];
    } else if (arg === "--json") {
      options.json = true;
    }
  }

  return options;
}

function printConfigHelp(): void {
  console.log(`
Herald Config - Output MCP configuration for your AI coding assistant

Usage:
  npx @spilno/herald-mcp config [options]

Options:
  --client, -c    Target client: claude, cursor, windsurf, generic (default: generic)
  --project, -p   Project name override (default: current folder)
  --json          Output raw JSON only (for piping)
  --help, -h      Show this help

Examples:
  npx @spilno/herald-mcp config                    # Generic MCP config
  npx @spilno/herald-mcp config --client cursor    # For Cursor
  npx @spilno/herald-mcp config --json | pbcopy    # Copy JSON to clipboard

The config uses your logged-in identity. Run 'herald login' first.
`);
}

interface MCPConfig {
  mcpServers: {
    herald: {
      command: string;
      args: string[];
      env?: Record<string, string>;
    };
  };
}

function buildConfig(auth: AuthConfig | null, project: string): MCPConfig {
  const env: Record<string, string> = {
    CEDA_URL: "https://getceda.com",
  };

  // Add token if authenticated
  if (auth?.token) {
    env.CEDA_TOKEN = auth.token;
  }

  return {
    mcpServers: {
      herald: {
        command: "npx",
        args: ["@spilno/herald-mcp@latest"],
        env
      }
    }
  };
}

function getClientInstructions(client: string): string {
  switch (client.toLowerCase()) {
    case "claude":
      return `
Add to your Claude Code settings or .mcp.json:`;

    case "cursor":
      return `
Add to your Cursor MCP settings (Settings > MCP):`;

    case "windsurf":
      return `
Add to your Windsurf MCP configuration:`;

    default:
      return `
Add this to your MCP client configuration:`;
  }
}

function getClientConfigPath(client: string): string {
  switch (client.toLowerCase()) {
    case "claude":
      return "~/.claude.json or .mcp.json in your project";
    case "cursor":
      return "Settings > Features > MCP";
    case "windsurf":
      return "~/.windsurf/mcp.json";
    default:
      return "your MCP client's configuration file";
  }
}

export async function runConfig(args: string[] = []): Promise<void> {
  const options = parseConfigArgs(args);

  if (options.help) {
    printConfigHelp();
    return;
  }

  const auth = getStoredAuth();
  const project = options.project || basename(process.cwd());
  const client = options.client || "generic";

  const config = buildConfig(auth, project);

  // Raw JSON output mode
  if (options.json) {
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  // Pretty output with instructions
  if (!auth) {
    console.log(`
Note: Not logged in. Config will work but patterns won't persist to your account.
      Run 'npx @spilno/herald-mcp login' to authenticate.
`);
  } else {
    console.log(`
Logged in as: ${auth.user.login}
`);
  }

  console.log(getClientInstructions(client));
  console.log();
  console.log(JSON.stringify(config, null, 2));
  console.log();
  console.log(`Config location: ${getClientConfigPath(client)}`);

  if (auth) {
    console.log(`
Your patterns will sync to CEDA under your GitHub identity.
Herald auto-detects context from git when you're working in a repo.
`);
  }
}
