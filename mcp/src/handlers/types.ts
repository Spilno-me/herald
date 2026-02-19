/**
 * Shared types for Herald MCP handler modules.
 *
 * All handler modules import their common interfaces from here
 * so cli.ts, tests, and handler files share a single source of truth.
 */

import type { SensitiveDataType, DataClassification } from "../sanitization.js";

// ---------------------------------------------------------------------------
// Tool result types
// ---------------------------------------------------------------------------

export type ToolContent = Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
export interface ToolResult { content: ToolContent; isError?: boolean }

// ---------------------------------------------------------------------------
// Base handler deps (all handler modules extend this)
// ---------------------------------------------------------------------------

export interface HandlerDeps {
  callCedaAPI: (endpoint: string, method?: string, body?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  emitProgress: (progress: number, total: number) => Promise<void>;
  config: {
    org: string;
    project: string;
    user: string;
  };
}

// ---------------------------------------------------------------------------
// Buffer types
// ---------------------------------------------------------------------------

export interface BufferedInsight {
  insight: string;
  topic?: string;
  targetVault?: string;
  sourceVault?: string;
  org: string;
  project: string;
  user: string;
  bufferedAt: string;
  type?: "insight" | "reflection";
  feeling?: "stuck" | "success";
  session?: string;
  method?: "direct" | "simulation";
}

// ---------------------------------------------------------------------------
// Session reflection types
// ---------------------------------------------------------------------------

export interface SessionReflection {
  id: string;
  session: string;
  feeling: "stuck" | "success";
  insight: string;
  method: "direct" | "simulation";
  timestamp: string;
}

export interface SessionReflectionsSummary {
  count: number;
  patterns: number;
  antipatterns: number;
  reflections: SessionReflection[];
}

// ---------------------------------------------------------------------------
// AI types (for herald_simulate)
// ---------------------------------------------------------------------------

export interface AIClient {
  provider: "anthropic" | "openai";
  key: string;
}

export interface ExtractedPattern {
  signal: string;
  outcome: "pattern" | "antipattern";
  reinforcement: string;
  warning: string;
}

// ---------------------------------------------------------------------------
// Sanitization preview type (mirrors previewSanitization return)
// ---------------------------------------------------------------------------

export interface SanitizationPreview {
  original: string;
  sanitized: string;
  wouldSanitize: boolean;
  detectedTypes: SensitiveDataType[];
  classification: DataClassification;
  wouldBlock: boolean;
  blockReason?: string;
  redactionCount: number;
}

// ---------------------------------------------------------------------------
// Context types (for herald_context refresh)
// ---------------------------------------------------------------------------

export type TrustLevel = "HIGH" | "LOW";

export interface LoadedContext {
  user: string;
  tags: string[];
  trust: TrustLevel;
  source: "git" | "stored" | "path" | "verified";
  propagates: boolean;
  gitRemote: string;
}

export interface ContextUpdate {
  user: string;
  tags: string[];
  org: string;
  project: string;
  trustLevel: TrustLevel;
  contextSource: "git" | "stored" | "path" | "verified";
  propagates: boolean;
  gitRemote: string;
}
