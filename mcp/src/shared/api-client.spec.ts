/**
 * Tests for shared API client factory.
 *
 * Mocks global.fetch — no real network access.
 */

import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { createApiClient, fetchWithTimeout } from "./api-client.js";

const originalFetch = global.fetch;

describe("shared/api-client", () => {
  let fetchMock: jest.Mock<typeof fetch>;
  let capturedRequests: { url: string; options: RequestInit }[];

  function mockFetchOk(responseBody: Record<string, unknown> = { success: true }) {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(responseBody),
    } as Response);
  }

  function mockFetch401ThenOk(refreshBody: Record<string, unknown> = { refreshed: true }) {
    let callCount = 0;
    fetchMock.mockImplementation((url: string | URL | Request, options?: RequestInit) => {
      capturedRequests.push({ url: url.toString(), options: options || {} });
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 401,
          statusText: "Unauthorized",
          text: () => Promise.resolve(""),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(refreshBody),
      } as Response);
    });
  }

  beforeEach(() => {
    capturedRequests = [];
    fetchMock = jest.fn((url: string | URL | Request, options?: RequestInit) => {
      capturedRequests.push({ url: url.toString(), options: options || {} });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true }),
      } as Response);
    });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("createApiClient", () => {
    const baseConfig = {
      baseUrl: "https://test.ceda.com",
      getAuthHeader: () => "Bearer test-token",
      context: { org: "acme", project: "backend", user: "john" },
    };

    it("should make GET request with tenant params", async () => {
      const client = createApiClient(baseConfig);
      await client.call("/api/reflections");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const url = capturedRequests[0].url;
      expect(url).toContain("https://test.ceda.com/api/reflections?");
      expect(url).toContain("org=acme");
      expect(url).toContain("project=backend");
      expect(url).toContain("user=john");
    });

    it("should append tenant params with & when endpoint has query string", async () => {
      const client = createApiClient(baseConfig);
      await client.call("/api/reflections?topic=testing");

      const url = capturedRequests[0].url;
      expect(url).toContain("?topic=testing&org=acme");
    });

    it("should skip tenant params when needsTenantParams returns false", async () => {
      const client = createApiClient({
        ...baseConfig,
        needsTenantParams: (ep) => ep.startsWith("/api/patterns"),
      });

      await client.call("/api/stats");
      const url = capturedRequests[0].url;
      expect(url).toBe("https://test.ceda.com/api/stats");
      expect(url).not.toContain("org=");
    });

    it("should enrich POST body with context", async () => {
      const client = createApiClient(baseConfig);
      await client.call("/api/herald/reflect", "POST", {
        feeling: "success",
        insight: "test",
      });

      const body = JSON.parse(capturedRequests[0].options.body as string);
      expect(body.feeling).toBe("success");
      expect(body.org).toBe("acme");
      expect(body.project).toBe("backend");
      expect(body.user).toBe("john");
    });

    it("should set Authorization header", async () => {
      const client = createApiClient(baseConfig);
      await client.call("/api/test");

      const headers = capturedRequests[0].options.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer test-token");
    });

    it("should not set Authorization when getAuthHeader returns null", async () => {
      const client = createApiClient({
        ...baseConfig,
        getAuthHeader: () => null,
      });
      await client.call("/api/test");

      const headers = capturedRequests[0].options.headers as Record<string, string>;
      expect(headers["Authorization"]).toBeUndefined();
    });

    it("should throw on non-ok response", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      } as Response);

      const client = createApiClient(baseConfig);
      await expect(client.call("/api/test")).rejects.toThrow("HTTP 500");
    });

    it("should auto-refresh on 401 and retry", async () => {
      mockFetch401ThenOk({ data: "refreshed" });

      const client = createApiClient({
        ...baseConfig,
        onRefreshToken: async () => "Bearer new-token",
      });

      const result = await client.call("/api/test");
      expect(result).toEqual({ data: "refreshed" });
      expect(capturedRequests).toHaveLength(2);

      const retryHeaders = capturedRequests[1].options.headers as Record<string, string>;
      expect(retryHeaders["Authorization"]).toBe("Bearer new-token");
    });

    it("should throw when 401 refresh fails", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: () => Promise.resolve(""),
      } as Response);

      const client = createApiClient({
        ...baseConfig,
        onRefreshToken: async () => null,
      });

      await expect(client.call("/api/test")).rejects.toThrow(
        "token refresh failed",
      );
    });

    it("should throw when 401 with no onRefreshToken configured", async () => {
      fetchMock.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      } as Response);

      const client = createApiClient(baseConfig);
      await expect(client.call("/api/test")).rejects.toThrow("HTTP 401");
    });
  });

  describe("fetchWithTimeout", () => {
    it("should return response on success", async () => {
      mockFetchOk({ data: "ok" });

      const response = await fetchWithTimeout(
        "https://example.com",
        { method: "GET" },
        5000,
      );
      expect(response.ok).toBe(true);
    });

    it("should throw timeout error on AbortError", async () => {
      fetchMock.mockImplementation(() => {
        const error = new Error("The operation was aborted");
        error.name = "AbortError";
        return Promise.reject(error);
      });

      await expect(
        fetchWithTimeout("https://example.com", { method: "GET" }, 100),
      ).rejects.toThrow("Request timeout after 100ms");
    });

    it("should re-throw non-abort errors", async () => {
      fetchMock.mockRejectedValue(new Error("Network failure"));

      await expect(
        fetchWithTimeout("https://example.com", { method: "GET" }),
      ).rejects.toThrow("Network failure");
    });
  });
});
