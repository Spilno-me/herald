/**
 * Herald SDK Tests
 */
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { herald } from "./sdk.js";

const originalFetch = global.fetch;

describe("herald SDK", () => {
  let fetchMock: jest.Mock<typeof fetch>;
  let capturedRequests: { url: string; options: RequestInit }[] = [];

  beforeEach(() => {
    capturedRequests = [];
    fetchMock = jest.fn((url: string | URL | Request, options?: RequestInit) => {
      capturedRequests.push({ url: url.toString(), options: options || {} });
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, patterns: [], antipatterns: [] }),
      } as Response);
    });
    global.fetch = fetchMock;

    // Reset SDK config before each test
    herald.configure({
      baseUrl: undefined,
      token: undefined,
      org: undefined,
      project: undefined,
      user: undefined,
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("learned()", () => {
    it("should call POST /api/herald/reflect with feeling=success", async () => {
      await herald.learned("Test pattern");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const { url, options } = capturedRequests[0];
      expect(url).toContain("/api/herald/reflect");
      expect(options.method).toBe("POST");

      const body = JSON.parse(options.body as string);
      expect(body.feeling).toBe("success");
      expect(body.insight).toBe("Test pattern");
      expect(body.method).toBe("sdk");
    });

    it("should include context when provided", async () => {
      await herald.learned("Test pattern", "deployment context");

      const { options } = capturedRequests[0];
      const body = JSON.parse(options.body as string);
      expect(body.session).toBe("deployment context");
    });
  });

  describe("gotStuck()", () => {
    it("should call POST /api/herald/reflect with feeling=stuck", async () => {
      await herald.gotStuck("Test antipattern");

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const { url, options } = capturedRequests[0];
      expect(url).toContain("/api/herald/reflect");
      expect(options.method).toBe("POST");

      const body = JSON.parse(options.body as string);
      expect(body.feeling).toBe("stuck");
      expect(body.insight).toBe("Test antipattern");
      expect(body.method).toBe("sdk");
    });

    it("should include context when provided", async () => {
      await herald.gotStuck("Test antipattern", "debugging session");

      const { options } = capturedRequests[0];
      const body = JSON.parse(options.body as string);
      expect(body.session).toBe("debugging session");
    });
  });

  describe("recall()", () => {
    it("should call GET /api/herald/reflections", async () => {
      fetchMock.mockImplementation((url: string | URL | Request, options?: RequestInit) => {
        capturedRequests.push({ url: url.toString(), options: options || {} });
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              patterns: [{ insight: "pattern1" }],
              antipatterns: [{ insight: "antipattern1" }],
            }),
        } as Response);
      });

      const result = await herald.recall();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const { url, options } = capturedRequests[0];
      expect(url).toContain("/api/herald/reflections");
      expect(options.method).toBe("GET");

      expect(result).toHaveLength(2);
      expect(result[0].feeling).toBe("success");
      expect(result[1].feeling).toBe("stuck");
    });

    it("should include topic in query when provided", async () => {
      await herald.recall("deployment");

      const { url } = capturedRequests[0];
      expect(url).toContain("topic=deployment");
    });
  });

  describe("configure()", () => {
    it("should change baseUrl for subsequent calls", async () => {
      herald.configure({ baseUrl: "https://custom.ceda.com" });

      await herald.learned("Test pattern");

      const { url } = capturedRequests[0];
      expect(url.startsWith("https://custom.ceda.com")).toBe(true);
    });

    it("should add authorization header when token is configured", async () => {
      herald.configure({ token: "test-token-123" });

      await herald.learned("Test pattern");

      const { options } = capturedRequests[0];
      expect(options.headers).toHaveProperty("Authorization", "Bearer test-token-123");
    });

    it("should use configured org/project/user in requests", async () => {
      herald.configure({
        org: "acme",
        project: "backend",
        user: "developer",
      });

      await herald.learned("Test pattern");

      const { options } = capturedRequests[0];
      const body = JSON.parse(options.body as string);
      expect(body.org).toBe("acme");
      expect(body.project).toBe("backend");
      expect(body.user).toBe("developer");
    });

    it("should merge configuration options", async () => {
      herald.configure({ baseUrl: "https://custom.ceda.com" });
      herald.configure({ token: "test-token" });

      await herald.learned("Test pattern");

      const { url, options } = capturedRequests[0];
      expect(url.startsWith("https://custom.ceda.com")).toBe(true);
      expect(options.headers).toHaveProperty("Authorization", "Bearer test-token");
    });
  });

  describe("error handling", () => {
    it("should throw on HTTP error", async () => {
      fetchMock.mockImplementationOnce(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
        } as Response)
      );

      await expect(herald.learned("Test pattern")).rejects.toThrow("HTTP 500");
    });

    it("should throw on network error", async () => {
      fetchMock.mockImplementationOnce(() =>
        Promise.reject(new Error("Network error"))
      );

      await expect(herald.learned("Test pattern")).rejects.toThrow("Network error");
    });
  });
});
