/**
 * Shared HTTP client factory for CEDA API calls.
 *
 * Used by cli.ts and sdk.ts — each configures its own client instance
 * with different auth, timeout, and error handling strategies.
 */

export const DEFAULT_TIMEOUT_MS = 10_000;

export interface ApiClientConfig {
  /** Base URL for all requests (e.g. "https://getceda.com") */
  baseUrl: string;

  /** Return current auth header value, or null if none */
  getAuthHeader: () => string | null;

  /** Tenant context for request enrichment */
  context: { org: string; project: string; user: string };

  /** Request timeout in ms. Default: DEFAULT_TIMEOUT_MS (10s) */
  timeoutMs?: number;

  /**
   * Whether a GET endpoint needs tenant query params.
   * Default: always true (sdk behavior).
   * cli.ts overrides to only add for specific endpoints.
   */
  needsTenantParams?: (endpoint: string) => boolean;

  /**
   * Called on successful 401 token refresh.
   * Should return new auth header value, or null if refresh failed.
   */
  onRefreshToken?: () => Promise<string | null>;
}

export interface ApiClient {
  call(
    endpoint: string,
    method?: string,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}

/**
 * Fetch with AbortController timeout.
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  }
}

/**
 * Create a configured API client.
 *
 * The client handles:
 * - Auth header injection
 * - Body enrichment with org/project/user on POST
 * - Tenant query params on GET (configurable)
 * - Timeout via AbortController
 * - 401 auto-refresh + retry (if onRefreshToken provided)
 */
export function createApiClient(config: ApiClientConfig): ApiClient {
  const {
    baseUrl,
    getAuthHeader,
    context,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    needsTenantParams = () => true,
    onRefreshToken,
  } = config;

  return {
    async call(
      endpoint: string,
      method: string = "GET",
      body?: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
      let url = `${baseUrl}${endpoint}`;

      if (method === "GET" && needsTenantParams(endpoint)) {
        const separator = endpoint.includes("?") ? "&" : "?";
        url += `${separator}org=${encodeURIComponent(context.org)}&project=${encodeURIComponent(context.project)}&user=${encodeURIComponent(context.user)}`;
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      const authHeader = getAuthHeader();
      if (authHeader) {
        headers["Authorization"] = authHeader;
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

      const fetchOptions: RequestInit = {
        method,
        headers,
        body: enrichedBody ? JSON.stringify(enrichedBody) : undefined,
      };

      const response = await fetchWithTimeout(url, fetchOptions, timeoutMs);

      // 401 auto-refresh + retry
      if (response.status === 401 && onRefreshToken) {
        await response.text().catch(() => {}); // drain body
        const newAuthHeader = await onRefreshToken();
        if (newAuthHeader) {
          const retryHeaders = { ...headers, Authorization: newAuthHeader };
          const retryResponse = await fetchWithTimeout(
            url,
            { ...fetchOptions, headers: retryHeaders },
            timeoutMs,
          );
          if (!retryResponse.ok) {
            throw new Error(
              `HTTP ${retryResponse.status}: ${retryResponse.statusText}`,
            );
          }
          return (await retryResponse.json()) as Record<string, unknown>;
        }
        throw new Error("HTTP 401: Unauthorized (token refresh failed)");
      }

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}: ${response.statusText}`,
        );
      }

      return (await response.json()) as Record<string, unknown>;
    },
  };
}
