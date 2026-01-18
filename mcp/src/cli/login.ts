#!/usr/bin/env node
/**
 * Herald Login CLI
 *
 * Authenticates user via GitHub OAuth.
 * Opens browser → User authorizes → Token stored locally.
 *
 * Usage: npx @spilno/herald-mcp login
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { createServer } from "http";
import { exec } from "child_process";

const CEDA_URL = process.env.CEDA_URL || "https://getceda.com";
const CONFIG_DIR = join(homedir(), ".herald");
const TOKEN_FILE = join(CONFIG_DIR, "token.json");

export interface AuthConfig {
  token: string;
  expiresAt: string;
  user: {
    login: string;
    email?: string;
  };
}

function getStoredAuth(): AuthConfig | null {
  if (!existsSync(TOKEN_FILE)) return null;
  try {
    const data = JSON.parse(readFileSync(TOKEN_FILE, "utf-8"));
    // Check if expired
    if (new Date(data.expiresAt) < new Date()) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function storeAuth(auth: AuthConfig): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(TOKEN_FILE, JSON.stringify(auth, null, 2), "utf-8");
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

export interface LoginOptions {
  help?: boolean;
  force?: boolean;
}

export function parseLoginArgs(args: string[]): LoginOptions {
  const options: LoginOptions = {};

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--force" || arg === "-f") {
      options.force = true;
    }
  }

  return options;
}

function printLoginHelp(): void {
  console.log(`
Herald Login - Authenticate with CEDA via GitHub

Usage:
  npx @spilno/herald-mcp login [options]

Options:
  --force, -f     Re-authenticate even if already logged in
  --help, -h      Show this help

This opens your browser for GitHub OAuth. After authorization,
your token is stored in ~/.herald/token.json

Your GitHub identity becomes your CEDA identity:
  - Your orgs = your pattern contexts
  - Your repos = your pattern sources
  - Git-verified trust = patterns propagate
`);
}

export async function runLogin(args: string[] = []): Promise<void> {
  const options = parseLoginArgs(args);

  if (options.help) {
    printLoginHelp();
    return;
  }

  // Check if already logged in
  const existingAuth = getStoredAuth();
  if (existingAuth && !options.force) {
    console.log(`
Already logged in as ${existingAuth.user.login}

To re-authenticate:
  npx @spilno/herald-mcp login --force

To logout:
  npx @spilno/herald-mcp logout
`);
    return;
  }

  console.log("Starting GitHub OAuth flow...\n");

  // Start local server to receive callback
  const PORT = 9876;
  const CALLBACK_PATH = "/callback";

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "", `http://localhost:${PORT}`);

    if (url.pathname === CALLBACK_PATH) {
      const token = url.searchParams.get("token");
      const login = url.searchParams.get("login");
      const email = url.searchParams.get("email");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <html>
            <body style="font-family: system-ui; padding: 2rem; text-align: center;">
              <h1>Authentication Failed</h1>
              <p>${error}</p>
              <p>You can close this window.</p>
            </body>
          </html>
        `);
        server.close();
        console.log(`\nAuthentication failed: ${error}`);
        process.exit(1);
      }

      if (token && login) {
        // Store the token
        const auth: AuthConfig = {
          token,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
          user: { login, email: email || undefined }
        };
        storeAuth(auth);

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <html>
            <body style="font-family: system-ui; padding: 2rem; text-align: center;">
              <h1>Logged in as ${login}</h1>
              <p>You can close this window and return to the terminal.</p>
            </body>
          </html>
        `);
        server.close();

        console.log(`\nLogged in as ${login}`);
        console.log(`Token stored in ~/.herald/token.json`);
        console.log(`\nNext: Run 'npx @spilno/herald-mcp config' to get your MCP configuration.`);
        process.exit(0);
      }
    }

    res.writeHead(404);
    res.end("Not found");
  });

  server.listen(PORT, () => {
    const authUrl = `${CEDA_URL}/api/auth/github?cli_callback=http://localhost:${PORT}${CALLBACK_PATH}`;

    console.log(`Opening browser for GitHub authorization...`);
    console.log(`\nIf browser doesn't open, visit:\n${authUrl}\n`);

    openBrowser(authUrl);
  });

  // Timeout after 5 minutes
  setTimeout(() => {
    console.log("\nTimeout waiting for authentication. Please try again.");
    server.close();
    process.exit(1);
  }, 5 * 60 * 1000);
}
