// @ts-nocheck — top-level await required for jest.unstable_mockModule with ESM
/**
 * Tests for shared auth module.
 *
 * Tests loadStoredTokens, persistTokens, isTokenExpired, getStoredAuth.
 * Mocks filesystem I/O — no real disk access.
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";

jest.unstable_mockModule("fs", () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  writeFileSync: jest.fn(),
}));

const mockFs = await import("fs");
const { loadStoredTokens, persistTokens, isTokenExpired, getStoredAuth } =
  await import("./auth.js");

describe("shared/auth", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("loadStoredTokens", () => {
    it("should return tokens from token.json", () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(true);
      (mockFs.readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({ token: "abc", refreshToken: "xyz" }),
      );

      const result = loadStoredTokens();
      expect(result).toEqual({ token: "abc", refreshToken: "xyz" });
    });

    it("should return empty object when file missing", () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(false);

      const result = loadStoredTokens();
      expect(result).toEqual({});
    });

    it("should return empty object on parse error", () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(true);
      (mockFs.readFileSync as jest.Mock).mockReturnValue("not json");

      const result = loadStoredTokens();
      expect(result).toEqual({});
    });

    it("should return undefined for missing token fields", () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(true);
      (mockFs.readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({ user: { login: "test" } }),
      );

      const result = loadStoredTokens();
      expect(result).toEqual({ token: undefined, refreshToken: undefined });
    });
  });

  describe("persistTokens", () => {
    it("should merge tokens into existing file", () => {
      const existing = {
        token: "old",
        refreshToken: "old-refresh",
        expiresAt: "2024-01-01T00:00:00.000Z",
        user: { login: "testuser" },
      };
      (mockFs.existsSync as jest.Mock).mockReturnValue(true);
      (mockFs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(existing));

      persistTokens("new-access", "new-refresh", 3600);

      expect(mockFs.writeFileSync).toHaveBeenCalledTimes(1);
      const written = JSON.parse(
        (mockFs.writeFileSync as jest.Mock).mock.calls[0][1] as string,
      );
      expect(written.token).toBe("new-access");
      expect(written.refreshToken).toBe("new-refresh");
      expect(written.user.login).toBe("testuser");
      expect(written.expiresAt).toBeDefined();
    });

    it("should use JWT exp claim for expiresAt when available", () => {
      const exp = Math.floor(Date.now() / 1000) + 7200;
      const payload = Buffer.from(JSON.stringify({ exp })).toString("base64");
      const fakeJwt = `header.${payload}.signature`;

      (mockFs.existsSync as jest.Mock).mockReturnValue(true);
      (mockFs.readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({ token: "old" }),
      );

      persistTokens(fakeJwt, "refresh", 3600);

      const written = JSON.parse(
        (mockFs.writeFileSync as jest.Mock).mock.calls[0][1] as string,
      );
      expect(written.expiresAt).toBe(new Date(exp * 1000).toISOString());
    });

    it("should fall back to expiresIn when JWT is unparseable", () => {
      const beforeMs = Date.now();
      (mockFs.existsSync as jest.Mock).mockReturnValue(true);
      (mockFs.readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({ token: "old" }),
      );

      persistTokens("not-a-jwt", "refresh", 3600);

      const written = JSON.parse(
        (mockFs.writeFileSync as jest.Mock).mock.calls[0][1] as string,
      );
      const expiresAtMs = new Date(written.expiresAt).getTime();
      expect(expiresAtMs).toBeGreaterThanOrEqual(beforeMs + 3600 * 1000 - 1000);
      expect(expiresAtMs).toBeLessThanOrEqual(beforeMs + 3600 * 1000 + 1000);
    });

    it("should not throw when file does not exist", () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(false);

      expect(() => persistTokens("a", "b", 3600)).not.toThrow();
      expect(mockFs.writeFileSync).not.toHaveBeenCalled();
    });

    it("should not throw on write error", () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(true);
      (mockFs.readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({ token: "old" }),
      );
      (mockFs.writeFileSync as jest.Mock).mockImplementation(() => {
        throw new Error("EACCES: permission denied");
      });

      expect(() => persistTokens("a", "b", 3600)).not.toThrow();
    });
  });

  describe("isTokenExpired", () => {
    it("should return false for a valid future token", () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      const payload = Buffer.from(JSON.stringify({ exp })).toString("base64");
      const token = `h.${payload}.s`;

      expect(isTokenExpired(token)).toBe(false);
    });

    it("should return true for an expired token", () => {
      const exp = Math.floor(Date.now() / 1000) - 120;
      const payload = Buffer.from(JSON.stringify({ exp })).toString("base64");
      const token = `h.${payload}.s`;

      expect(isTokenExpired(token)).toBe(true);
    });

    it("should return true for token without exp", () => {
      const payload = Buffer.from(JSON.stringify({ sub: "user" })).toString(
        "base64",
      );
      const token = `h.${payload}.s`;

      expect(isTokenExpired(token)).toBe(true);
    });

    it("should return true for malformed token", () => {
      expect(isTokenExpired("not-a-jwt")).toBe(true);
    });
  });

  describe("getStoredAuth", () => {
    it("should return null when file missing", () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(false);
      expect(getStoredAuth()).toBeNull();
    });

    it("should return null when token expired", () => {
      (mockFs.existsSync as jest.Mock).mockReturnValue(true);
      (mockFs.readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({
          token: "abc",
          expiresAt: "2020-01-01T00:00:00.000Z",
          user: { login: "test" },
        }),
      );

      expect(getStoredAuth()).toBeNull();
    });

    it("should return auth config when valid", () => {
      const futureDate = new Date(Date.now() + 3600 * 1000).toISOString();
      (mockFs.existsSync as jest.Mock).mockReturnValue(true);
      (mockFs.readFileSync as jest.Mock).mockReturnValue(
        JSON.stringify({
          token: "abc",
          expiresAt: futureDate,
          user: { login: "test" },
        }),
      );

      const result = getStoredAuth();
      expect(result).not.toBeNull();
      expect(result!.token).toBe("abc");
      expect(result!.user.login).toBe("test");
    });
  });
});
