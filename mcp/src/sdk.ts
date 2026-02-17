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

import { getGitRemote, deriveUser, deriveTags } from "./shared/git-utils.js";
import { getCedaUrl } from "./shared/paths.js";
import { getCedaToken, loadStoredTokens, persistTokens } from "./shared/auth.js";
import { createApiClient, type ApiClient } from "./shared/api-client.js";

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
    org: tags[0] || "unknown",
    project: tags[1] || tags[0] || "unknown",
    user,
  };
}

let sdkConfig: HeraldConfig = {};

function getBaseUrl(): string {
  return sdkConfig.baseUrl || getCedaUrl();
}

function getToken(): string | undefined {
  return sdkConfig.token || getCedaToken();
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

function getClient(): ApiClient {
  const baseUrl = getBaseUrl();
  const context = getContext();

  return createApiClient({
    baseUrl,
    getAuthHeader: () => {
      const token = getToken();
      return token ? `Bearer ${token}` : null;
    },
    context,
    onRefreshToken: async () => {
      const { refreshToken } = loadStoredTokens();
      if (!refreshToken) return null;

      try {
        const response = await fetch(`${baseUrl}/api/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });

        if (!response.ok) return null;

        const data = (await response.json()) as {
          accessToken: string;
          refreshToken: string;
          expiresIn: number;
        };

        persistTokens(data.accessToken, data.refreshToken, data.expiresIn);

        return `Bearer ${data.accessToken}`;
      } catch {
        return null;
      }
    },
  });
}

async function callApi(
  endpoint: string,
  method: "GET" | "POST" = "GET",
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return getClient().call(endpoint, method, body);
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
