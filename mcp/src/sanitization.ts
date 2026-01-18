/**
 * CEDA-65: Client-Side Sanitization
 *
 * Pre-transmission sanitization for Herald MCP.
 * Sensitive data never leaves the client machine.
 */

export enum DataClassification {
  PUBLIC = 'PUBLIC',
  INTERNAL = 'INTERNAL',
  CONFIDENTIAL = 'CONFIDENTIAL',
  RESTRICTED = 'RESTRICTED',
}

export enum SensitiveDataType {
  EMAIL = 'EMAIL',
  PHONE = 'PHONE',
  SSN = 'SSN',
  API_KEY = 'API_KEY',
  AWS_KEY = 'AWS_KEY',
  PASSWORD = 'PASSWORD',
  PRIVATE_KEY = 'PRIVATE_KEY',
  JWT_TOKEN = 'JWT_TOKEN',
  CREDIT_CARD = 'CREDIT_CARD',
  IP_ADDRESS = 'IP_ADDRESS',
  FILE_PATH = 'FILE_PATH',
  PHI_MEDICAL = 'PHI_MEDICAL',
  PHI_DIAGNOSIS = 'PHI_DIAGNOSIS',
}

export interface SanitizationResult {
  sanitizedText: string;
  detectedTypes: SensitiveDataType[];
  dataClass: DataClassification;
  blocked: boolean;
  blockReason?: string;
  redactionCount: number;
}

interface DetectionPattern {
  type: SensitiveDataType;
  pattern: RegExp;
  classification: DataClassification;
  replacement: string;
  block?: boolean;
}

const PATTERNS: DetectionPattern[] = [
  // RESTRICTED - Block entirely
  {
    type: SensitiveDataType.PRIVATE_KEY,
    pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(RSA\s+)?PRIVATE\s+KEY-----/gi,
    classification: DataClassification.RESTRICTED,
    replacement: '[PRIVATE_KEY_BLOCKED]',
    block: true,
  },
  {
    type: SensitiveDataType.AWS_KEY,
    pattern: /(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}/g,
    classification: DataClassification.RESTRICTED,
    replacement: '[AWS_KEY_REDACTED]',
    block: true,
  },
  {
    type: SensitiveDataType.AWS_KEY,
    pattern: /aws_secret_access_key\s*[=:]\s*['"]?[A-Za-z0-9/+=]{40}['"]?/gi,
    classification: DataClassification.RESTRICTED,
    replacement: 'aws_secret_access_key=[AWS_SECRET_REDACTED]',
    block: true,
  },

  // CONFIDENTIAL - Redact but allow
  {
    type: SensitiveDataType.SSN,
    pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
    classification: DataClassification.CONFIDENTIAL,
    replacement: '[SSN_REDACTED]',
  },
  {
    type: SensitiveDataType.CREDIT_CARD,
    pattern: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
    classification: DataClassification.CONFIDENTIAL,
    replacement: '[CREDIT_CARD_REDACTED]',
  },
  {
    type: SensitiveDataType.API_KEY,
    pattern: /(?:api[_-]?key|apikey|api[_-]?token)\s*[=:]\s*['"]?[A-Za-z0-9_\-]{20,}['"]?/gi,
    classification: DataClassification.CONFIDENTIAL,
    replacement: '[API_KEY_REDACTED]',
  },
  {
    type: SensitiveDataType.API_KEY,
    pattern: /(?:sk|pk)[-_](?:live|test)[-_][A-Za-z0-9]{24,}/g,
    classification: DataClassification.CONFIDENTIAL,
    replacement: '[API_KEY_REDACTED]',
  },
  {
    type: SensitiveDataType.JWT_TOKEN,
    pattern: /eyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/g,
    classification: DataClassification.CONFIDENTIAL,
    replacement: '[JWT_TOKEN_REDACTED]',
  },
  {
    type: SensitiveDataType.PASSWORD,
    pattern: /(?:password|passwd|pwd)\s*[=:]\s*['"]?[^\s'"]{4,}['"]?/gi,
    classification: DataClassification.CONFIDENTIAL,
    replacement: '[PASSWORD_REDACTED]',
  },
  {
    type: SensitiveDataType.PASSWORD,
    pattern: /(?:secret|token|auth)\s*[=:]\s*['"]?[A-Za-z0-9_\-]{8,}['"]?/gi,
    classification: DataClassification.CONFIDENTIAL,
    replacement: '[SECRET_REDACTED]',
  },

  // PHI - Protected Health Information
  {
    type: SensitiveDataType.PHI_MEDICAL,
    pattern: /\b(?:patient\s+id|medical\s+record\s+number|mrn|health\s+record)\s*[:#]?\s*[A-Z0-9\-]{4,}/gi,
    classification: DataClassification.CONFIDENTIAL,
    replacement: '[PHI_RECORD_REDACTED]',
  },
  {
    type: SensitiveDataType.PHI_DIAGNOSIS,
    pattern: /\b(?:diagnosed?\s+with|diagnosis|icd[-\s]?10|icd[-\s]?9)\s*[:#]?\s*[A-Z0-9\.\-]+/gi,
    classification: DataClassification.CONFIDENTIAL,
    replacement: '[PHI_DIAGNOSIS_REDACTED]',
  },
  {
    type: SensitiveDataType.PHI_MEDICAL,
    pattern: /\b(?:prescription|rx|medication)\s*[:#]?\s*[A-Za-z0-9\s\-]{4,}/gi,
    classification: DataClassification.CONFIDENTIAL,
    replacement: '[PHI_MEDICATION_REDACTED]',
  },

  // INTERNAL - Redact for privacy
  {
    type: SensitiveDataType.EMAIL,
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    classification: DataClassification.INTERNAL,
    replacement: '[EMAIL_REDACTED]',
  },
  {
    type: SensitiveDataType.PHONE,
    pattern: /(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b/g,
    classification: DataClassification.INTERNAL,
    replacement: '[PHONE_REDACTED]',
  },
  {
    type: SensitiveDataType.IP_ADDRESS,
    pattern: /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
    classification: DataClassification.INTERNAL,
    replacement: '[IP_REDACTED]',
  },
  {
    type: SensitiveDataType.FILE_PATH,
    pattern: /(?:\/Users\/|\/home\/|C:\\Users\\)[A-Za-z0-9_\-\.]+(?:\/[A-Za-z0-9_\-\.]+)*/g,
    classification: DataClassification.INTERNAL,
    replacement: '[PATH_REDACTED]',
  },
  {
    type: SensitiveDataType.FILE_PATH,
    pattern: /(?:\/var\/|\/etc\/|\/opt\/)[A-Za-z0-9_\-\.\/]+/g,
    classification: DataClassification.INTERNAL,
    replacement: '[PATH_REDACTED]',
  },
];

function getClassificationLevel(classification: DataClassification): number {
  switch (classification) {
    case DataClassification.PUBLIC: return 0;
    case DataClassification.INTERNAL: return 1;
    case DataClassification.CONFIDENTIAL: return 2;
    case DataClassification.RESTRICTED: return 3;
    default: return 0;
  }
}

/**
 * Sanitize text by detecting and redacting sensitive data
 * Called client-side before any data transmission
 */
export function sanitize(text: string): SanitizationResult {
  const detectedTypes: Set<SensitiveDataType> = new Set();
  let sanitizedText = text;
  let highestClassification = DataClassification.PUBLIC;
  let blocked = false;
  let blockReason: string | undefined;
  let redactionCount = 0;

  for (const pattern of PATTERNS) {
    // Reset regex state for global patterns
    pattern.pattern.lastIndex = 0;
    const matches = [...text.matchAll(pattern.pattern)];

    for (const match of matches) {
      detectedTypes.add(pattern.type);
      redactionCount++;

      if (getClassificationLevel(pattern.classification) > getClassificationLevel(highestClassification)) {
        highestClassification = pattern.classification;
      }

      if (pattern.block) {
        blocked = true;
        blockReason = `Detected ${pattern.type}: Content contains restricted data that cannot be transmitted`;
      }
    }

    // Apply redaction
    pattern.pattern.lastIndex = 0;
    sanitizedText = sanitizedText.replace(pattern.pattern, pattern.replacement);
  }

  return {
    sanitizedText: blocked ? '' : sanitizedText,
    detectedTypes: Array.from(detectedTypes),
    dataClass: highestClassification,
    blocked,
    blockReason,
    redactionCount,
  };
}

/**
 * Preview what would be sanitized without modifying (for dry-run)
 */
export function previewSanitization(text: string): {
  original: string;
  sanitized: string;
  wouldSanitize: boolean;
  detectedTypes: SensitiveDataType[];
  classification: DataClassification;
  wouldBlock: boolean;
  blockReason?: string;
  redactionCount: number;
} {
  const result = sanitize(text);
  return {
    original: text,
    sanitized: result.blocked ? '[BLOCKED - Contains restricted data]' : result.sanitizedText,
    wouldSanitize: result.redactionCount > 0,
    detectedTypes: result.detectedTypes,
    classification: result.dataClass,
    wouldBlock: result.blocked,
    blockReason: result.blockReason,
    redactionCount: result.redactionCount,
  };
}

/**
 * Sanitize all text fields in a reflection payload
 */
export function sanitizeReflection(payload: {
  session: string;
  insight: string;
  signal?: string;
  outcome?: string;
  reinforcement?: string;
  warning?: string;
}): {
  sanitized: typeof payload;
  summary: SanitizationResult;
} {
  const allText = [
    payload.session,
    payload.insight,
    payload.signal,
    payload.outcome,
    payload.reinforcement,
    payload.warning,
  ].filter(Boolean).join('\n---\n');

  const summary = sanitize(allText);

  return {
    sanitized: {
      session: sanitize(payload.session).sanitizedText,
      insight: sanitize(payload.insight).sanitizedText,
      signal: payload.signal ? sanitize(payload.signal).sanitizedText : undefined,
      outcome: payload.outcome ? sanitize(payload.outcome).sanitizedText : undefined,
      reinforcement: payload.reinforcement ? sanitize(payload.reinforcement).sanitizedText : undefined,
      warning: payload.warning ? sanitize(payload.warning).sanitizedText : undefined,
    },
    summary,
  };
}
