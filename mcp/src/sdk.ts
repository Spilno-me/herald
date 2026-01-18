/**
 * Herald SDK - Programmatic access to CEDA pattern memory
 *
 * Usage:
 *   import { herald } from '@spilno/herald-mcp';
 *
 *   // Capture a pattern (something that worked)
 *   await herald.learned('Always run tests before committing');
 *
 *   // Capture an antipattern (something that failed)
 *   await herald.gotStuck('Forgot to check existing tests before refactoring');
 *
 *   // Query patterns
 *   const patterns = await herald.recall();
 *
 *   // Configure (optional - uses git context by default)
 *   herald.configure({ baseUrl: 'https://custom.ceda.com' });
 */

import { existsSync, readFileSync } from "fs";
import { homedir, userInfo } from "os";
import { join, dirname } from "path";

export interface Pattern {
  insight: string;
  signal?: string;
  reinforcement?: string;
  warning?: string;
  scope?: string;
  feeling?: "stuck" | "success";
}

export interface RecallResult {
  patterns: Pattern[];
  antipatterns: Pattern[];
}

export interface HeraldConfig {
  baseUrl?: string;
  token?: string;
  org?: string;
  project?: string;
  user?: string;
}

interface GitInfo {
  remote: string | null;
  org: string | null;
  repo: string | null;
}

function findGitRoot(startPath: string): string | null {
  let current = startPath;
  while (current !== "/") {
    if (existsSync(join(current, ".git"))) {
      return current;
    }
    current = dirname(current);
  }
  return null;
}

function getGitRemote(): GitInfo {
  try {
    const gitRoot = findGitRoot(process.cwd());
    if (!gitRoot) return { remote: null, org: null, repo: null };

    const configPath = join(gitRoot, ".git", "config");
    if (!existsSync(configPath)) return { remote: null, org: null, repo: null };

    const config = readFileSync(configPath, "utf-8");

    const remoteMatch = config.match(/\[remote "origin"\][^\[]*url\s*=\s*(.+)/m);
    if (!remoteMatch) return { remote: null, org: null, repo: null };

    const remoteUrl = remoteMatch[1].trim();

    let normalized = remoteUrl
      .replace(/^git@/, "")
      .replace(/^https?:\/\//, "")
      .replace(/:/, "/")
      .replace(/\.git$/, "");

    const parts = normalized.split("/");
    const repo = parts.pop() || null;
    const org = parts.pop() || null;

    return { remote: normalized, org, repo };
  } catch {
    return { remote: null, org: null, repo: null };
  }
}

function getGitUser(): string | null {
  try {
    const gitRoot = findGitRoot(process.cwd());
    if (!gitRoot) return null;

    const configPath = join(gitRoot, ".git", "config");
    if (!existsSync(configPath)) return null;

    const config = readFileSync(configPath, "utf-8");

    const nameMatch = config.match(/\[user\][^\[]*name\s*=\s*(.+)/m);
    if (nameMatch) return nameMatch[1].trim();

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

function deriveUser(): string {
  const gitUser = getGitUser();
  if (gitUser) return gitUser;

  try {
    return userInfo().username;
  } catch {
    return "unknown";
  }
}

function deriveTags(): string[] {
  try {
    const cwd = process.cwd();
    const parts = cwd
      .split("/")
      .filter(
        (p) =>
          p &&
          !["Users", "home", "Documents", "projects", "repos", "GitHub"].includes(p)
      );
    return parts.slice(-2);
  } catch {
    return [];
  }
}

function deriveContext(): { org: string; project: string; user: string } {
  const gitInfo = getGitRemote();
  const user = deriveUser();

  if (gitInfo.org && gitInfo.repo) {
    return {
      org: gitInfo.org,
      project: gitInfo.repo,
      user,
    };
  }

  const tags = deriveTags();
  return {
    org: tags[0] || "default",
    project: tags[1] || tags[0] || "default",
    user,
  };
}

let sdkConfig: HeraldConfig = {};

function getBaseUrl(): string {
  return (
    sdkConfig.baseUrl ||
    process.env.CEDA_URL ||
    process.env.HERALD_API_URL ||
    "https://getceda.com"
  );
}

function getToken(): string | undefined {
  return sdkConfig.token || process.env.CEDA_TOKEN || process.env.HERALD_API_TOKEN;
}

function getContext(): { org: string; project: string; user: string } {
  if (sdkConfig.org && sdkConfig.project && sdkConfig.user) {
    return {
      org: sdkConfig.org,
      project: sdkConfig.project,
      user: sdkConfig.user,
    };
  }

  const derived = deriveContext();
  return {
    org: sdkConfig.org || derived.org,
    project: sdkConfig.project || derived.project,
    user: sdkConfig.user || derived.user,
  };
}

async function callApi(
  endpoint: string,
  method: "GET" | "POST" = "GET",
  body?: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const baseUrl = getBaseUrl();
  const token = getToken();
  const context = getContext();

  let url = `${baseUrl}${endpoint}`;

  if (method === "GET") {
    const separator = endpoint.includes("?") ? "&" : "?";
    url += `${separator}org=${encodeURIComponent(context.org)}&project=${encodeURIComponent(context.project)}&user=${encodeURIComponent(context.user)}`;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let enrichedBody = body;
  if (method === "POST" && body) {
    enrichedBody = {
      ...body,
      org: context.org,
      project: context.project,
      user: context.user,
    };
  }

  const response = await fetch(url, {
    method,
    headers,
    body: enrichedBody ? JSON.stringify(enrichedBody) : undefined,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return (await response.json()) as Record<string, unknown>;
}

export const herald = {
  /**
   * Capture a pattern (something that worked)
   * @param insight - Description of what worked
   * @param context - Optional session context
   */
  async learned(insight: string, context?: string): Promise<void> {
    await callApi("/api/herald/reflect", "POST", {
      feeling: "success",
      insight,
      session: context || "",
      method: "sdk",
    });
  },

  /**
   * Capture an antipattern (something that failed)
   * @param insight - Description of what went wrong
   * @param context - Optional session context
   */
  async gotStuck(insight: string, context?: string): Promise<void> {
    await callApi("/api/herald/reflect", "POST", {
      feeling: "stuck",
      insight,
      session: context || "",
      method: "sdk",
    });
  },

  /**
   * Query learned patterns
   * @param topic - Optional topic to filter by
   * @returns Patterns and antipatterns
   */
  async recall(topic?: string): Promise<Pattern[]> {
    const endpoint = topic
      ? `/api/herald/reflections?topic=${encodeURIComponent(topic)}`
      : "/api/herald/reflections";

    const result = await callApi(endpoint, "GET");

    const patterns = (result.patterns as Pattern[]) || [];
    const antipatterns = (result.antipatterns as Pattern[]) || [];

    return [
      ...patterns.map((p) => ({ ...p, feeling: "success" as const })),
      ...antipatterns.map((p) => ({ ...p, feeling: "stuck" as const })),
    ];
  },

  /**
   * Configure the SDK
   * @param opts - Configuration options
   */
  configure(opts: HeraldConfig): void {
    sdkConfig = { ...sdkConfig, ...opts };
  },
};

export default herald;
