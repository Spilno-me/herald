/**
 * Shared git utilities for Herald MCP.
 * Used by cli.ts (context derivation) and sdk.ts (auto-detection).
 */
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { userInfo } from "os";
import { join, dirname } from "path";

export interface GitInfo {
  remote: string | null;
  org: string | null;
  repo: string | null;
}

/**
 * Walk up from startPath to find the nearest .git directory.
 */
export function findGitRoot(startPath: string): string | null {
  let current = startPath;
  while (current !== "/" && current !== dirname(current)) {
    if (existsSync(join(current, ".git"))) {
      return current;
    }
    current = dirname(current);
  }
  return null;
}

/**
 * Parse the git remote "origin" URL from .git/config.
 * Returns normalized remote, org, and repo.
 */
export function getGitRemote(): GitInfo {
  try {
    const gitRoot = findGitRoot(process.cwd());
    if (!gitRoot) return { remote: null, org: null, repo: null };

    const configPath = join(gitRoot, ".git", "config");
    if (!existsSync(configPath)) return { remote: null, org: null, repo: null };

    const config = readFileSync(configPath, "utf-8");

    // Parse [remote "origin"] url = ...
    const remoteMatch = config.match(/\[remote "origin"\][^\[]*url\s*=\s*(.+)/m);
    if (!remoteMatch) return { remote: null, org: null, repo: null };

    const remoteUrl = remoteMatch[1].trim();

    // Normalize: git@github.com:org/repo.git → github.com/org/repo
    // https://github.com/org/repo.git → github.com/org/repo
    let normalized = remoteUrl
      .replace(/^git@/, "")
      .replace(/^https?:\/\//, "")
      .replace(/:/, "/")
      .replace(/\.git$/, "");

    // Extract org and repo
    const parts = normalized.split("/");
    const repo = parts.pop() || null;
    const org = parts.pop() || null;

    return { remote: normalized, org, repo };
  } catch {
    return { remote: null, org: null, repo: null };
  }
}

/**
 * Get the git user name from local or global git config.
 */
export function getGitUser(): string | null {
  try {
    const gitRoot = findGitRoot(process.cwd());
    if (!gitRoot) return null;

    const configPath = join(gitRoot, ".git", "config");
    if (!existsSync(configPath)) return null;

    const config = readFileSync(configPath, "utf-8");

    // Check local git config first: [user] name = ...
    const nameMatch = config.match(/\[user\][^\[]*name\s*=\s*(.+)/m);
    if (nameMatch) return nameMatch[1].trim();

    // Fall back to global git config
    const globalConfigPath = join(homedir(), ".gitconfig");
    if (existsSync(globalConfigPath)) {
      const globalConfig = readFileSync(globalConfigPath, "utf-8");
      const globalNameMatch = globalConfig.match(/\[user\][^\[]*name\s*=\s*(.+)/m);
      if (globalNameMatch) return globalNameMatch[1].trim();
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Derive the current user identity.
 * Priority: git user > OS username > "unknown"
 */
export function deriveUser(): string {
  const gitUser = getGitUser();
  if (gitUser) return gitUser;

  try {
    return userInfo().username;
  } catch {
    return "unknown";
  }
}

/**
 * Derive tags from cwd path — last 2 meaningful segments.
 * /Users/john/projects/acme/backend → ["acme", "backend"]
 */
export function deriveTags(): string[] {
  try {
    const cwd = process.cwd();
    const parts = cwd.split("/").filter(
      (p) => p && !["Users", "home", "Documents", "projects", "repos", "GitHub"].includes(p),
    );
    return parts.slice(-2);
  } catch {
    return [];
  }
}
