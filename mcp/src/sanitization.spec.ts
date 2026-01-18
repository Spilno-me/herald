/**
 * CEDA-65: Sanitization Tests
 */
import { sanitize, previewSanitization, DataClassification, SensitiveDataType } from "./sanitization.js";

describe("sanitization", () => {
  describe("sanitize", () => {
    it("should pass through clean text unchanged", () => {
      const result = sanitize("This is a clean pattern about error handling");
      expect(result.sanitizedText).toBe("This is a clean pattern about error handling");
      expect(result.redactionCount).toBe(0);
      expect(result.dataClass).toBe(DataClassification.PUBLIC);
    });

    it("should redact API keys", () => {
      const result = sanitize("Found issue with api_key=sk-proj-abc123xyz789abc123xyz789");
      expect(result.sanitizedText).toContain("[API_KEY_REDACTED]");
      expect(result.detectedTypes).toContain(SensitiveDataType.API_KEY);
      expect(result.dataClass).toBe(DataClassification.CONFIDENTIAL);
    });

    it("should redact Stripe-style keys", () => {
      const result = sanitize("Using sk-live-abc123xyz789abc123xyz789abc");
      expect(result.sanitizedText).toContain("[API_KEY_REDACTED]");
    });

    it("should redact JWT tokens", () => {
      const result = sanitize("Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U");
      expect(result.sanitizedText).toContain("[JWT_TOKEN_REDACTED]");
    });

    it("should redact file paths with usernames", () => {
      const result = sanitize("Error in /Users/john/project/src/auth.ts");
      expect(result.sanitizedText).toContain("[PATH_REDACTED]");
      expect(result.detectedTypes).toContain(SensitiveDataType.FILE_PATH);
    });

    it("should redact email addresses", () => {
      const result = sanitize("Contact user at john.doe@company.com for help");
      expect(result.sanitizedText).toContain("[EMAIL_REDACTED]");
    });

    it("should redact phone numbers", () => {
      const result = sanitize("Call support at 555-123-4567");
      expect(result.sanitizedText).toContain("[PHONE_REDACTED]");
    });

    it("should redact IP addresses", () => {
      const result = sanitize("Server at 192.168.1.100 is down");
      expect(result.sanitizedText).toContain("[IP_REDACTED]");
    });

    it("should block private keys entirely", () => {
      const result = sanitize(`-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC7
-----END PRIVATE KEY-----`);
      expect(result.blocked).toBe(true);
      expect(result.sanitizedText).toBe("");
      expect(result.detectedTypes).toContain(SensitiveDataType.PRIVATE_KEY);
    });

    it("should block AWS access keys", () => {
      const result = sanitize("Using AKIAIOSFODNN7EXAMPLE for S3");
      expect(result.blocked).toBe(true);
      expect(result.detectedTypes).toContain(SensitiveDataType.AWS_KEY);
    });

    it("should redact passwords", () => {
      const result = sanitize("Set password=mysecretpass123");
      expect(result.sanitizedText).toContain("[PASSWORD_REDACTED]");
    });

    it("should redact SSN patterns", () => {
      const result = sanitize("SSN: 123-45-6789");
      expect(result.sanitizedText).toContain("[SSN_REDACTED]");
    });

    it("should handle multiple redactions", () => {
      const result = sanitize("User john@test.com at 192.168.1.1 with api_key=abc123xyz789abc123xyz789");
      expect(result.redactionCount).toBeGreaterThan(2);
      expect(result.sanitizedText).not.toContain("john@test.com");
      expect(result.sanitizedText).not.toContain("192.168.1.1");
    });
  });

  describe("previewSanitization", () => {
    it("should show original and sanitized side by side", () => {
      const result = previewSanitization("Contact john@example.com");
      expect(result.original).toBe("Contact john@example.com");
      expect(result.sanitized).toContain("[EMAIL_REDACTED]");
      expect(result.wouldSanitize).toBe(true);
    });

    it("should indicate clean content", () => {
      const result = previewSanitization("Clean pattern description");
      expect(result.wouldSanitize).toBe(false);
      expect(result.classification).toBe(DataClassification.PUBLIC);
    });

    it("should indicate blocked content", () => {
      const result = previewSanitization("Key: AKIAIOSFODNN7EXAMPLE");
      expect(result.wouldBlock).toBe(true);
    });
  });
});
