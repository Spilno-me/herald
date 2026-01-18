#!/usr/bin/env node
/**
 * Herald MCP - AI-native interface to CEDA ecosystem
 *
 * Dual-mode:
 * - CLI mode (TTY): Natural commands for humans
 * - MCP mode (piped): JSON-RPC for AI agents
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  Tool,
  Resource,
} from "@modelcontextprotocol/sdk/types.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { homedir, userInfo } from "os";
import { join, basename, dirname } from "path";
import { createHash } from "crypto";
import * as readline from "readline";

import { runInit } from "./cli/init.js";
import { runLogin } from "./cli/login.js";
import { runLogout } from "./cli/logout.js";
import { runConfig } from "./cli/config.js";
import { runUpgrade } from "./cli/upgrade.js";
import { runChat } from "./cli/chat.js";
import { sanitize, previewSanitization, sanitizeReflection, DataClassification } from "./sanitization.js";

// Configuration - all sensitive values from environment only
// CEDA_URL is primary, HERALD_API_URL for backwards compat, default to cloud
const CEDA_API_URL = process.env.CEDA_URL || process.env.HERALD_API_URL || "https://getceda.com";
// CEDA_TOKEN is the primary auth (from app.getceda.com OAuth)
// HERALD_API_TOKEN kept for backwards compatibility
const CEDA_API_TOKEN = process.env.CEDA_TOKEN || process.env.HERALD_API_TOKEN;
const CEDA_API_USER = process.env.HERALD_API_USER;
const CEDA_API_PASS = process.env.HERALD_API_PASS;

// CEDA-70: Zero-config context - everything auto-derived, nothing required
// User is ALWAYS known (whoami). Company/project inferred from path as tags.

function deriveUser(): string {
  // Priority: git user > env var > OS user
  // Git user is trusted (immutable identity from git config)
  const gitUser = getGitUser();
  if (gitUser) return gitUser;

  try {
    return userInfo().username;
  } catch {
    return "unknown";
  }
}

function deriveTags(): string[] {
  // Derive tags from cwd path - last 2 meaningful segments
  // /Users/john/projects/acme/backend → ["acme", "backend"]
  try {
    const cwd = process.cwd();
    const parts = cwd.split("/").filter(p => p && !["Users", "home", "Documents", "projects", "repos", "GitHub"].includes(p));
    return parts.slice(-2);  // Last 2 segments as tags
  } catch {
    return [];
  }
}

// ADR-001: Git-based trust model
// Git remote = unforgeable identity. Can't claim repo access without having it.

type TrustLevel = 'HIGH' | 'LOW';

interface GitInfo {
  remote: string | null;
  org: string | null;
  repo: string | null;
}

function findGitRoot(startPath: string): string | null {
  let current = startPath;
  while (current !== '/') {
    if (existsSync(join(current, '.git'))) {
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

    const configPath = join(gitRoot, '.git', 'config');
    if (!existsSync(configPath)) return { remote: null, org: null, repo: null };

    const config = readFileSync(configPath, 'utf-8');

    // Parse [remote "origin"] url = ...
    const remoteMatch = config.match(/\[remote "origin"\][^\[]*url\s*=\s*(.+)/m);
    if (!remoteMatch) return { remote: null, org: null, repo: null };

    const remoteUrl = remoteMatch[1].trim();

    // Normalize: git@github.com:org/repo.git → github.com/org/repo
    // https://github.com/org/repo.git → github.com/org/repo
    let normalized = remoteUrl
      .replace(/^git@/, '')
      .replace(/^https?:\/\//, '')
      .replace(/:/, '/')
      .replace(/\.git$/, '');

    // Extract org and repo
    const parts = normalized.split('/');
    const repo = parts.pop() || null;
    const org = parts.pop() || null;

    return { remote: normalized, org, repo };
  } catch {
    return { remote: null, org: null, repo: null };
  }
}

// Git-based user identity (trusted - derived from git config)
function getGitUser(): string | null {
  try {
    const gitRoot = findGitRoot(process.cwd());
    if (!gitRoot) return null;

    const configPath = join(gitRoot, '.git', 'config');
    if (!existsSync(configPath)) return null;

    const config = readFileSync(configPath, 'utf-8');

    // Check local git config first: [user] name = ...
    const nameMatch = config.match(/\[user\][^\[]*name\s*=\s*(.+)/m);
    if (nameMatch) return nameMatch[1].trim();

    // Fall back to global git config
    const globalConfigPath = join(homedir(), '.gitconfig');
    if (existsSync(globalConfigPath)) {
      const globalConfig = readFileSync(globalConfigPath, 'utf-8');
      const globalNameMatch = globalConfig.match(/\[user\][^\[]*name\s*=\s*(.+)/m);
      if (globalNameMatch) return globalNameMatch[1].trim();
    }

    return null;
  } catch {
    return null;
  }
}

function hashTag(input: string): string {
  // Create short, deterministic hash for tag
  // "github.com/Spilno-me/ceda" → "ceda-a7f3b2"
  const hash = createHash('sha256').update(input).digest('hex').slice(0, 6);
  const name = input.split('/').pop() || 'unknown';
  return `${name}-${hash}`;
}

interface TagSet {
  tags: string[];
  trust: TrustLevel;
  source: 'git' | 'stored' | 'path' | 'env';
  propagates: boolean;
  gitInfo?: GitInfo;
}

function deriveTagSet(): TagSet {
  // 1. Check env vars (explicit override)
  // HERALD_ORG is primary, HERALD_COMPANY for backwards compat
  const envOrg = process.env.HERALD_ORG || process.env.HERALD_COMPANY;
  if (envOrg) {
    return {
      tags: [envOrg, process.env.HERALD_PROJECT].filter(Boolean) as string[],
      trust: 'LOW',  // Env vars can be set by anyone
      source: 'env',
      propagates: false
    };
  }

  // 2. Check Git remote (HIGH trust)
  const gitInfo = getGitRemote();
  if (gitInfo.remote) {
    return {
      tags: [
        gitInfo.org || 'unknown',
        gitInfo.repo || 'unknown',
        hashTag(gitInfo.remote)  // Unique, unforgeable tag
      ],
      trust: 'HIGH',
      source: 'git',
      propagates: true,
      gitInfo
    };
  }

  // 3. Fallback to path (LOW trust)
  return {
    tags: deriveTags(),
    trust: 'LOW',
    source: 'path',
    propagates: false
  };
}

// CEDA-71: Context persistence - read/write .mcp.json
// ADR-001: Now includes trust level from git
interface HeraldContext {
  tags: string[];
  user: string;
  trust?: TrustLevel;
  source?: 'git' | 'stored' | 'path' | 'env';
  propagates?: boolean;
  derived?: boolean;
  derivedFrom?: string;
  storedAt?: string;
  gitRemote?: string;
}

interface McpJson {
  mcpServers?: Record<string, unknown>;
  herald?: {
    context?: HeraldContext;
  };
}

function getMcpJsonPath(): string {
  return join(process.cwd(), '.mcp.json');
}

function readMcpJson(): McpJson | null {
  const mcpPath = getMcpJsonPath();
  if (!existsSync(mcpPath)) return null;

  try {
    return JSON.parse(readFileSync(mcpPath, 'utf-8'));
  } catch {
    return null;
  }
}

function persistContext(tagSet: TagSet, user: string): void {
  const mcpPath = getMcpJsonPath();

  let mcpJson: McpJson = {};
  if (existsSync(mcpPath)) {
    try {
      mcpJson = JSON.parse(readFileSync(mcpPath, 'utf-8'));
    } catch {
      // Corrupted file, preserve structure
      mcpJson = {};
    }
  }

  // Add herald context section (preserve existing mcpServers)
  // ADR-001: Include trust level and git info
  mcpJson.herald = {
    ...mcpJson.herald,
    context: {
      tags: tagSet.tags,
      user,
      trust: tagSet.trust,
      source: tagSet.source,
      propagates: tagSet.propagates,
      derived: true,
      derivedFrom: tagSet.source,
      storedAt: new Date().toISOString(),
      gitRemote: tagSet.gitInfo?.remote || undefined
    }
  };

  writeFileSync(mcpPath, JSON.stringify(mcpJson, null, 2));
  console.error(`[Herald] Context stored: tags=[${tagSet.tags.join(', ')}] trust=${tagSet.trust} source=${tagSet.source}`);
}

interface LoadedContext {
  tags: string[];
  user: string;
  trust: TrustLevel;
  source: 'git' | 'stored' | 'path' | 'env';
  propagates: boolean;
  gitRemote?: string;
}

function loadOrDeriveContext(): LoadedContext {
  const user = process.env.HERALD_USER || deriveUser();

  // 1. Check env vars (explicit override - highest priority, but LOW trust)
  // HERALD_ORG is primary, HERALD_COMPANY for backwards compat
  const envOrg = process.env.HERALD_ORG || process.env.HERALD_COMPANY;
  if (envOrg) {
    return {
      tags: [envOrg, process.env.HERALD_PROJECT].filter(Boolean) as string[],
      user,
      trust: 'LOW',
      source: 'env',
      propagates: false
    };
  }

  // 2. Check .mcp.json for stored context (preserve user's config)
  const mcpJson = readMcpJson();
  if (mcpJson?.herald?.context?.tags?.length) {
    const stored = mcpJson.herald.context;
    return {
      tags: stored.tags,
      user: stored.user || user,
      trust: stored.trust || 'LOW',
      source: 'stored',
      propagates: stored.propagates || false,
      gitRemote: stored.gitRemote
    };
  }

  // 3. Derive fresh (ADR-001: use git if available)
  const tagSet = deriveTagSet();

  // Store for next time (only if no stored context exists)
  if (tagSet.tags.length > 0 && !mcpJson?.herald?.context) {
    try {
      persistContext(tagSet, user);
    } catch {
      // Silent fail - don't break startup if we can't write
    }
  }

  return {
    tags: tagSet.tags,
    user,
    trust: tagSet.trust,
    source: tagSet.source,
    propagates: tagSet.propagates,
    gitRemote: tagSet.gitInfo?.remote || undefined
  };
}

// Load context once at startup
const LOADED_CONTEXT = loadOrDeriveContext();

// User is always known (can be refreshed via herald_context)
let HERALD_USER = LOADED_CONTEXT.user;

// Tags from context (env > stored > git > path) - can be refreshed
let HERALD_TAGS = LOADED_CONTEXT.tags;
let HERALD_ORG = HERALD_TAGS[0] || "";
let HERALD_PROJECT = HERALD_TAGS[1] || HERALD_TAGS[0] || "";

// ADR-001: Trust level determines pattern propagation
// These are mutable - verification with CEDA may upgrade/downgrade trust
let TRUST_LEVEL: TrustLevel = LOADED_CONTEXT.trust;
let PROPAGATES: boolean = LOADED_CONTEXT.propagates;
let CONTEXT_SOURCE: 'git' | 'stored' | 'path' | 'env' | 'verified' = LOADED_CONTEXT.source;
const GIT_REMOTE = LOADED_CONTEXT.gitRemote;

// Server-verified context (set after /api/auth/verify call)
let VERIFIED_CONTEXT: {
  verified: boolean;
  org?: string;
  project?: string;
  trust?: TrustLevel;
  tags?: string[];
} | null = null;

// Offspring vault context (for Avatar mode)
const HERALD_VAULT = process.env.HERALD_VAULT || "";
const AEGIS_OFFSPRING_PATH = process.env.AEGIS_OFFSPRING_PATH || join(homedir(), "Documents", "aegis_ceda", "_offspring");

// Cloud mode: Use CEDA API for offspring communication instead of local files
const OFFSPRING_CLOUD_MODE = process.env.HERALD_OFFSPRING_CLOUD === "true";

const VERSION = "1.34.5";

// Self-routing description - teaches Claude when to call Herald
const HERALD_DESCRIPTION = `AI-native pattern learning for CEDA.

AUTHORIZATION GATES (CRITICAL):
Before multi-file operations (>3 files), module scaffolding, or bulk changes:
1. Present synthesis/plan to user
2. Ask: "Proceed? [Y/continue/adjust]"
3. WAIT for explicit approval before writing

Autonomous (no gate): reading, searching, planning, single-file edits, commits.
Gated: multi-file creation, module scaffolding, bulk operations.

Why: User steering > execution speed. Long uninterrupted runs block collaboration.

WHEN TO OFFER REFLECTION:
When you notice FRICTION (multiple iterations, debugging spirals, corrections, confusion)
or FLOW (clean first-pass execution, good instincts, smooth outcomes),
offer: "That was [rough/smooth]. Want me to capture this for pattern learning?"

IMPORTANT: Always ask user permission before calling herald_reflect.

Herald learns signal→outcome mappings to help future sessions.`;

// Auto-sync buffer on startup (future: HERALD_AUTO_SYNC=false to disable)
const AUTO_SYNC_ON_STARTUP = process.env.HERALD_AUTO_SYNC !== "false";

// AI API keys for Herald's voice and AI-native simulation
// SECURITY: Never bundle API keys in npm packages
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

// Session persistence - context-isolated paths
function getHeraldDir(): string {
  return join(homedir(), ".herald", HERALD_ORG, HERALD_PROJECT, HERALD_USER);
}

function getSessionFile(): string {
  return join(getHeraldDir(), "session");
}

function getBufferFile(): string {
  return join(getHeraldDir(), "insight_buffer.json");
}

interface BufferedInsight {
  insight: string;
  topic?: string;
  targetVault?: string;
  sourceVault?: string;
  org: string;
  project: string;
  user: string;
  bufferedAt: string;
  // CEDA-100: Track buffer type for proper sync routing
  type?: 'insight' | 'reflection';
  // Reflection-specific fields (when type='reflection')
  feeling?: 'stuck' | 'success';
  session?: string;
  method?: 'direct' | 'simulation';
}

// CEDA-64: Session reflection tracking (in-memory, clears on restart)
interface SessionReflection {
  id: string;
  session: string;
  feeling: "stuck" | "success";
  insight: string;
  method: "direct" | "simulation";
  timestamp: string;
}

// In-memory session reflections array (clears on restart)
const sessionReflections: SessionReflection[] = [];

function addSessionReflection(reflection: Omit<SessionReflection, "id" | "timestamp">): SessionReflection {
  const newReflection: SessionReflection = {
    ...reflection,
    id: `sr-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    timestamp: new Date().toISOString(),
  };
  sessionReflections.push(newReflection);
  return newReflection;
}

function getSessionReflectionsSummary(): {
  count: number;
  patterns: number;
  antipatterns: number;
  reflections: SessionReflection[];
} {
  const patterns = sessionReflections.filter(r => r.feeling === "success").length;
  const antipatterns = sessionReflections.filter(r => r.feeling === "stuck").length;
  return {
    count: sessionReflections.length,
    patterns,
    antipatterns,
    reflections: sessionReflections,
  };
}

function bufferInsight(payload: Omit<BufferedInsight, "bufferedAt">): void {
  ensureHeraldDir();
  const bufferFile = getBufferFile();
  let buffer: BufferedInsight[] = [];
  if (existsSync(bufferFile)) {
    try {
      buffer = JSON.parse(readFileSync(bufferFile, "utf-8"));
    } catch (error) {
      console.error(`[Herald] Buffer parse error in bufferInsight: ${error}`);
      console.error(`[Herald] Starting with fresh buffer`);
      buffer = [];
    }
  }
  buffer.push({ ...payload, bufferedAt: new Date().toISOString() });
  try {
    writeFileSync(bufferFile, JSON.stringify(buffer, null, 2));
  } catch (error) {
    console.error(`[Herald] Failed to write buffer: ${error}`);
    console.error(`[Herald] Insight may be lost - check disk space and permissions`);
  }
}

function getBufferedInsights(): BufferedInsight[] {
  const bufferFile = getBufferFile();
  if (existsSync(bufferFile)) {
    try {
      return JSON.parse(readFileSync(bufferFile, "utf-8"));
    } catch (error) {
      console.error(`[Herald] Buffer corrupted: ${error}`);
      console.error(`[Herald] Clearing corrupted buffer - insights may be lost`);
      try {
        unlinkSync(bufferFile);
      } catch {
        // Ignore cleanup errors
      }
      return [];
    }
  }
  return [];
}

function clearBuffer(): void {
  const bufferFile = getBufferFile();
  if (existsSync(bufferFile)) {
    unlinkSync(bufferFile);
  }
}

function saveFailedInsights(failed: BufferedInsight[]): void {
  if (failed.length === 0) {
    clearBuffer();
  } else {
    ensureHeraldDir();
    try {
      writeFileSync(getBufferFile(), JSON.stringify(failed, null, 2));
    } catch (error) {
      console.error(`[Herald] Failed to save failed insights: ${error}`);
      console.error(`[Herald] ${failed.length} insight(s) may be lost`);
    }
  }
}

function ensureHeraldDir(): void {
  const dir = getHeraldDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function saveSession(sessionId: string): void {
  ensureHeraldDir();
  writeFileSync(getSessionFile(), sessionId, "utf-8");
}

function loadSession(): string | null {
  const sessionFile = getSessionFile();
  if (existsSync(sessionFile)) {
    return readFileSync(sessionFile, "utf-8").trim();
  }
  return null;
}

function clearSession(): void {
  const sessionFile = getSessionFile();
  if (existsSync(sessionFile)) {
    unlinkSync(sessionFile);
  }
}

function getContextString(): string {
  return `${HERALD_ORG}:${HERALD_PROJECT}:${HERALD_USER}`;
}

const HERALD_SYSTEM_PROMPT = `You are Herald, the voice of CEDA (Cognitive Event-Driven Architecture).
You help humans design module structures through natural conversation.

You have access to CEDA's cognitive capabilities:
- Predict: Generate structure predictions from requirements
- Refine: Improve predictions with additional requirements
- Session: Track conversation history

When users describe what they want, you:
1. Call CEDA to generate/refine predictions
2. Explain the results in natural language
3. Ask clarifying questions when needed

Keep responses concise and focused. You're a helpful assistant, not verbose.
When showing module structures, summarize the key sections and fields.`;

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

async function callClaude(systemPrompt: string, messages: Message[]): Promise<string> {
  if (!ANTHROPIC_API_KEY) {
    return "Claude voice unavailable. Set ANTHROPIC_API_KEY environment variable to enable chat mode.";
  }

  const anthropicMessages = messages
    .filter(m => m.role !== "system")
    .map(m => ({ role: m.role, content: m.content }));

  const systemContent = messages
    .filter(m => m.role === "system")
    .map(m => m.content)
    .join("\n\n");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: systemPrompt + (systemContent ? "\n\n" + systemContent : ""),
      messages: anthropicMessages.length > 0 ? anthropicMessages : [{ role: "user", content: "Hello" }],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    return `Claude error: ${error}`;
  }

  const data = await response.json() as { content: Array<{ text?: string }> };
  return data.content[0]?.text || "No response from Claude";
}

// ============================================
// AI-NATIVE SIMULATION - AI-to-AI reflection
// ============================================

interface AIClient {
  provider: "anthropic" | "openai";
  key: string;
}

interface ExtractedPattern {
  signal: string;
  outcome: "pattern" | "antipattern";
  reinforcement: string;
  warning: string;
}

function getAIClient(): AIClient | null {
  if (ANTHROPIC_API_KEY) {
    return { provider: "anthropic", key: ANTHROPIC_API_KEY };
  }
  if (OPENAI_API_KEY) {
    return { provider: "openai", key: OPENAI_API_KEY };
  }
  return null;
}

function buildReflectionPrompt(session: string, feeling: string, insight: string): string {
  return `You are a pattern extraction AI analyzing a development session.

Session context: ${session}
User feeling: ${feeling}
User insight: ${insight}

Your task: Extract the signal→outcome mapping.

SIGNAL: The specific action, decision, or behavior that LED to the outcome.
        Not what happened, but what CAUSED it. Be specific and actionable.

OUTCOME: "${feeling === "stuck" ? "antipattern" : "pattern"}" (based on user feeling)

REINFORCEMENT: If this is a good pattern - what should an AI assistant say to encourage
               this behavior when detected in future sessions? Keep it brief, supportive.

WARNING: If this is an antipattern - what should an AI assistant say to prevent this?
         Keep it brief, helpful, not lecturing.

Respond ONLY with valid JSON (no markdown, no explanation):
{"signal":"...","outcome":"pattern|antipattern","reinforcement":"...","warning":"..."}`;
}

async function callAIForReflection(client: AIClient, prompt: string): Promise<ExtractedPattern> {
  if (client.provider === "anthropic") {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": client.key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",  // Fast, cheap for reflection
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const data = await response.json() as { content: Array<{ text?: string }> };
    const text = data.content[0]?.text || "{}";
    return JSON.parse(text) as ExtractedPattern;
  }

  if (client.provider === "openai") {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${client.key}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",  // Fast, cheap for reflection
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json() as { choices: Array<{ message: { content: string } }> };
    const text = data.choices[0]?.message?.content || "{}";
    return JSON.parse(text) as ExtractedPattern;
  }

  throw new Error(`Unknown AI provider: ${client.provider}`);
}

async function translateAndExecute(userInput: string, conversationHistory: Message[]): Promise<string> {
  const sessionId = loadSession();

  const interpretSystemPrompt = `You interpret user requests for CEDA.
Respond with JSON only: {"action": "predict"|"refine"|"info"|"accept"|"reject", "input": "the user's requirement"}
- predict: User wants to create something new
- refine: User wants to modify/add to current design (requires active session)
- info: User is asking a question
- accept: User approves the current design
- reject: User rejects/wants to start over

Current session: ${sessionId || "none"}`;

  const interpretation = await callClaude(interpretSystemPrompt, [
    { role: "user", content: userInput }
  ]);

  let cedaResult: Record<string, unknown> | null = null;
  let action = "info";

  try {
    const parsed = JSON.parse(interpretation) as { action: string; input: string };
    action = parsed.action;
    const input = parsed.input;

    if (action === "predict") {
      cedaResult = await callCedaAPI("/api/predict", "POST", {
        input,
        config: { enableAutoFix: true, maxAutoFixAttempts: 3 },
      });
      if (cedaResult && typeof cedaResult.sessionId === "string") {
        saveSession(cedaResult.sessionId);
      }
    } else if (action === "refine" && sessionId) {
      cedaResult = await callCedaAPI("/api/refine", "POST", {
        sessionId,
        refinement: input,
      });
    } else if (action === "accept" && sessionId) {
      cedaResult = await callCedaAPI("/api/feedback", "POST", {
        sessionId,
        accepted: true,
      });
      clearSession();
    } else if (action === "reject") {
      clearSession();
      cedaResult = { success: true, status: "Session cleared" };
    }
  } catch {
    // Claude didn't return valid JSON, treat as info request
  }

  let responseContext = "";
  if (cedaResult) {
    responseContext = `\n\nCEDA ${action} result:\n${JSON.stringify(cedaResult, null, 2)}\n\nSummarize this naturally for the user.`;
  }

  const responseMessages: Message[] = [
    ...conversationHistory,
    { role: "user", content: userInput },
  ];

  return await callClaude(HERALD_SYSTEM_PROMPT + responseContext, responseMessages);
}

async function runChatMode(): Promise<void> {
  const contextStr = getContextString();
  console.log(`
Herald v${VERSION} - Chat Mode
Context: ${contextStr}
Type your requirements in natural language. Type 'exit' to quit.
──────────────────────────────────────────────────────────────
`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const conversationHistory: Message[] = [];
  const currentSession = loadSession();

  if (currentSession) {
    console.log(`Resuming session: ${currentSession}\n`);
  }

  const prompt = (): void => {
    rl.question("You: ", async (input) => {
      const trimmed = input.trim();

      if (trimmed.toLowerCase() === "exit" || trimmed.toLowerCase() === "quit") {
        console.log("\nGoodbye!");
        rl.close();
        return;
      }

      if (!trimmed) {
        prompt();
        return;
      }

      conversationHistory.push({ role: "user", content: trimmed });
      const response = await translateAndExecute(trimmed, conversationHistory);
      conversationHistory.push({ role: "assistant", content: response });

      console.log(`\nHerald: ${response}\n`);
      prompt();
    });
  };

  prompt();
}

function getAuthHeader(): string | null {
  if (CEDA_API_TOKEN) {
    return `Bearer ${CEDA_API_TOKEN}`;
  }
  if (CEDA_API_USER && CEDA_API_PASS) {
    const basicAuth = Buffer.from(`${CEDA_API_USER}:${CEDA_API_PASS}`).toString("base64");
    return `Basic ${basicAuth}`;
  }
  return null;
}

async function callCedaAPI(endpoint: string, method = "GET", body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!CEDA_API_URL) {
    return {
      success: false,
      error: "HERALD_API_URL not configured. Run: export HERALD_API_URL=https://getceda.com"
    };
  }

  let url = `${CEDA_API_URL}${endpoint}`;
  // Only add tenant params to endpoints that need them (patterns, session queries)
  // Don't add to simple endpoints like /api/stats, /health
  const needsTenantParams = endpoint.startsWith("/api/patterns") ||
                            endpoint.startsWith("/api/session/") ||
                            endpoint.startsWith("/api/observations");
  if (method === "GET" && needsTenantParams) {
    const separator = endpoint.includes("?") ? "&" : "?";
    url += `${separator}org=${HERALD_ORG}&project=${HERALD_PROJECT}&user=${HERALD_USER}`;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const authHeader = getAuthHeader();
  if (authHeader) {
    headers["Authorization"] = authHeader;
  }

  let enrichedBody = body;
  if (method === "POST" && body && typeof body === "object") {
    enrichedBody = {
      ...body,
      org: HERALD_ORG,
      project: HERALD_PROJECT,
      user: HERALD_USER,
    };
  }

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: enrichedBody ? JSON.stringify(enrichedBody) : undefined,
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
    }

    return await response.json() as Record<string, unknown>;
  } catch (error) {
    return { success: false, error: `Connection failed: ${error}` };
  }
}

// ============================================
// CLI MODE - Human-friendly commands
// ============================================

function printUsage(): void {
  const currentSession = loadSession();
  const contextStr = getContextString();
  const sessionDir = getHeraldDir();

  console.log(`
Herald MCP v${VERSION} - AI-native interface to CEDA

Context: ${contextStr}
Session: ${currentSession || "(none)"}
Path:    ${sessionDir}

Usage:
  herald-mcp <command> [options]

Commands:
  Setup:
    login                     Authenticate with GitHub (opens browser)
    logout                    Clear stored authentication
    init                      Initialize Herald config in project
    config                    Output MCP JSON for any client

  Account:
    upgrade                   Open billing portal / view usage

  MCP Tools (when running as server):
    health                    Check CEDA system status
    stats                     Get server statistics
    patterns                  View learned patterns

  Legacy CLI:
    chat                      Natural conversation mode
    predict "<signal>"        Start new prediction
    refine "<text>"           Refine current session
    observe yes|no            Record feedback & close session
    new                       Clear session, start fresh

Examples:
  npx @spilno/herald-mcp login              # Authenticate
  npx @spilno/herald-mcp config             # Get MCP config
  npx @spilno/herald-mcp init               # Setup in project
  npx @spilno/herald-mcp upgrade            # Manage subscription

Environment:
  CEDA_URL            CEDA server URL (default: https://getceda.com)
  CEDA_TOKEN          Auth token (auto-set after login)

MCP Mode:
  When piped, Herald speaks JSON-RPC for AI agents.
`);
}

function formatOutput(data: Record<string, unknown>): void {
  if (data.error) {
    console.error(`Error: ${data.error}`);
    process.exit(1);
  }

  if (data.sessionId) {
    console.log(`\nSession: ${data.sessionId}\n`);
  }

  console.log(JSON.stringify(data, null, 2));
}

async function runCLI(args: string[]): Promise<void> {
  const command = args[0]?.toLowerCase();

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  if (command === "--version" || command === "-v") {
    console.log(`herald-mcp v${VERSION}`);
    return;
  }

  switch (command) {
    case "init": {
      await runInit(args.slice(1));
      break;
    }

    case "login": {
      await runLogin(args.slice(1));
      break;
    }

    case "logout": {
      await runLogout(args.slice(1));
      break;
    }

    case "config": {
      await runConfig(args.slice(1));
      break;
    }

    case "upgrade": {
      await runUpgrade(args.slice(1));
      break;
    }

    case "chat": {
      await runChat();
      break;
    }

    case "health": {
      const result = await callCedaAPI("/health");
      formatOutput(result);
      break;
    }

    case "stats": {
      const result = await callCedaAPI("/api/stats");
      formatOutput(result);
      break;
    }

    case "predict": {
      const signal = args[1];
      if (!signal) {
        console.error("Error: Missing signal. Usage: herald-mcp predict \"<signal>\"");
        process.exit(1);
      }

      const result = await callCedaAPI("/api/predict", "POST", {
        input: signal,
        config: { enableAutoFix: true, maxAutoFixAttempts: 3 },
      });

      if (result.sessionId && typeof result.sessionId === "string") {
        saveSession(result.sessionId);
        console.log(`\n✓ Session saved: ${result.sessionId}\n`);
      }

      formatOutput(result);
      break;
    }

    case "refine": {
      const refinement = args[1];
      if (!refinement) {
        console.error("Error: Missing refinement. Usage: herald-mcp refine \"<refinement>\"");
        process.exit(1);
      }

      const sessionId = loadSession();
      if (!sessionId) {
        console.error("Error: No active session. Run 'herald-mcp predict \"...\"' first.");
        process.exit(1);
      }

      const result = await callCedaAPI("/api/refine", "POST", {
        sessionId,
        refinement,
      });

      formatOutput(result);
      break;
    }

    case "resume":
    case "session": {
      const sessionId = args[1] || loadSession();
      if (!sessionId) {
        console.error("Error: No active session. Run 'herald-mcp predict \"...\"' first.");
        process.exit(1);
      }

      const result = await callCedaAPI(`/api/session/${sessionId}`);
      formatOutput(result);
      break;
    }

    case "observe": {
      const accepted = args[1]?.toLowerCase();
      if (!accepted) {
        console.error("Error: Missing feedback. Usage: herald-mcp observe yes|no");
        process.exit(1);
      }

      const sessionId = loadSession();
      if (!sessionId) {
        console.error("Error: No active session. Run 'herald-mcp predict \"...\"' first.");
        process.exit(1);
      }

      const result = await callCedaAPI("/api/feedback", "POST", {
        sessionId,
        accepted: accepted === "yes" || accepted === "true" || accepted === "accept",
        comment: args[2],
      });

      clearSession();
      console.log("\n✓ Session closed.\n");
      formatOutput(result);
      break;
    }

    case "new": {
      clearSession();
      console.log("✓ Session cleared. Ready for new prediction.");
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exit(1);
  }
}

// ============================================
// MCP MODE - JSON-RPC for AI agents
// ============================================

const server = new Server(
  { name: "herald", version: VERSION, description: HERALD_DESCRIPTION },
  { capabilities: { tools: {}, resources: {} } }
);

const tools: Tool[] = [
  {
    name: "herald_help",
    description: "Get started with Herald MCP - shows available tools, quick examples, and links to documentation",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "herald_health",
    description: "Check Herald and CEDA system status",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "herald_context",
    description: `Get or refresh Herald's context (company/project/user).

Context is derived from git (trusted) or path (fallback).
Use refresh=true after cloning a repo or changing directories to update context.

Returns: Current context including trust level and source.`,
    inputSchema: {
      type: "object",
      properties: {
        refresh: {
          type: "boolean",
          description: "Re-derive context from current directory's git info"
        }
      }
    },
  },
  {
    name: "herald_stats",
    description: "Get CEDA server statistics and loaded patterns info",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "herald_gate",
    description: `Request authorization before large operations.

WHEN TO USE:
Call this BEFORE multi-file operations (>3 files), module scaffolding, or bulk changes.

This tool:
1. Formats a clear authorization request for the user
2. Returns a gate_id for tracking
3. Records the operation scope for audit

After calling this tool, WAIT for explicit user approval before proceeding.
User may respond: Y/yes/proceed (approved), adjust (modify scope), or N/no (denied).

Example flow:
1. You complete synthesis/planning
2. Call herald_gate with operation summary
3. Tool returns formatted request
4. STOP and wait for user response
5. Only proceed if user approves`,
    inputSchema: {
      type: "object",
      properties: {
        operation: {
          type: "string",
          description: "What operation needs authorization (e.g., 'Create bh-incidents module')"
        },
        scope: {
          type: "string",
          description: "Scope summary (e.g., '31 files, 6 dictionaries, 4 forms')"
        },
        template: {
          type: "string",
          description: "Template/pattern being followed (e.g., 'bh-inspections')"
        },
        rationale: {
          type: "string",
          description: "Brief rationale for the operation"
        },
      },
      required: ["operation", "scope"],
    },
  },
  {
    name: "herald_predict",
    description: "Generate non-deterministic structure prediction from signal. Returns sessionId for multi-turn conversations.",
    inputSchema: {
      type: "object",
      properties: {
        signal: { type: "string", description: "Natural language input" },
        context: { type: "string", description: "Additional context" },
        session_id: { type: "string", description: "Session ID for multi-turn" },
        participant: { type: "string", description: "Participant name" },
      },
      required: ["signal"],
    },
  },
  {
    name: "herald_refine",
    description: "Refine an existing prediction with additional requirements.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Session ID from previous call" },
        refinement: { type: "string", description: "Refinement instruction" },
        context: { type: "string", description: "Additional context" },
        participant: { type: "string", description: "Participant name" },
      },
      required: ["session_id", "refinement"],
    },
  },
  {
    name: "herald_session",
    description: "Get session information including history",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Session ID to retrieve" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "herald_feedback",
    description: "Submit feedback on a prediction (accept/reject)",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Session ID" },
        accepted: { type: "boolean", description: "Whether prediction was accepted" },
        comment: { type: "string", description: "Optional feedback comment" },
      },
      required: ["session_id", "accepted"],
    },
  },
  {
    name: "herald_context_status",
    description: "Read status from Herald contexts across domains (offspring vaults)",
    inputSchema: {
      type: "object",
      properties: {
        vault: { type: "string", description: "Specific vault to query (optional)" },
      },
    },
  },
  {
    name: "herald_share_insight",
    description: "Share a pattern insight with another Herald context. Herald instances communicate through shared insights to propagate learned patterns across domains.",
    inputSchema: {
      type: "object",
      properties: {
        insight: { type: "string", description: "The insight to share" },
        target_vault: { type: "string", description: "Target vault (optional)" },
        topic: { type: "string", description: "Topic category" },
      },
      required: ["insight"],
    },
  },
  {
    name: "herald_sync",
    description: "Flush locally buffered insights to CEDA cloud. Use when insights were recorded in local mode (cloud unavailable) and need to be synced.",
    inputSchema: {
      type: "object",
      properties: {
        dry_run: { type: "boolean", description: "If true, show what would be synced without actually syncing" },
      },
    },
  },
  {
    name: "herald_query_insights",
    description: "Query accumulated insights on a topic",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Topic to query" },
        vault: { type: "string", description: "Specific vault to query (optional)" },
      },
      required: ["topic"],
    },
  },
  // CEDA-49: Session Management Tools
  {
    name: "herald_session_list",
    description: "List sessions for a company with optional filters. Returns session summaries including id, status, created/updated timestamps.",
    inputSchema: {
      type: "object",
      properties: {
        org: { type: "string", description: "Filter by org (optional, defaults to HERALD_ORG)" },
        project: { type: "string", description: "Filter by project (optional)" },
        user: { type: "string", description: "Filter by user (optional)" },
        status: { type: "string", description: "Filter by status: active, archived, or expired (optional)" },
        limit: { type: "number", description: "Maximum number of sessions to return (optional, default 100)" },
      },
    },
  },
  {
    name: "herald_session_get",
    description: "Get detailed information about a specific session including current prediction state and message history.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Session ID to retrieve" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "herald_session_history",
    description: "Get version history for a session. Shows all recorded versions with timestamps and change types.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Session ID to get history for" },
        limit: { type: "number", description: "Maximum number of versions to return (optional)" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "herald_session_rollback",
    description: "Restore a session to a previous version. Creates a new version entry recording the rollback.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Session ID to rollback" },
        version: { type: "number", description: "Version number to restore to" },
      },
      required: ["session_id", "version"],
    },
  },
  {
    name: "herald_session_archive",
    description: "Archive a session. Archived sessions are preserved but marked as inactive.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string", description: "Session ID to archive" },
      },
      required: ["session_id"],
    },
  },
  // Session Mining - Pattern/Antipattern Learning
  {
    name: "herald_reflect",
    description: `Capture a pattern or antipattern from the session.

TRIGGER WORDS: "capture", "log this", "that was smooth/rough", "reflect"

BEFORE CALLING - ASK USER:
"What specifically worked (or didn't work) here?"
User's answer goes in the 'insight' parameter.

DO NOT GUESS. The user knows what they valued. Ask them.

ABSTRACTION GUIDANCE:
Capture the PATTERN, not the SPECIFICS. Good patterns are reusable.
- BAD: "Fixed bug in /Users/john/project/auth.ts line 47"
- GOOD: "Early return pattern for auth validation reduces nesting"
- BAD: "API key sk-proj-xxx was in wrong env file"
- GOOD: "Secrets in .env.local not .env prevents accidental commits"

Example flow:
1. User: "That was smooth, capture it"
2. You: "What specifically worked here? (Describe the pattern, not specific files/values)"
3. User: "The ASCII visualization approach"
4. You call herald_reflect with insight: "ASCII visualization approach"

PRIVACY (CEDA-65):
- Client-side sanitization runs BEFORE any data leaves your machine
- API keys, tokens, passwords, file paths with usernames are auto-redacted
- Private keys and AWS credentials are BLOCKED entirely
- Use dry_run=true to preview exactly what would be transmitted

DRY RUN MODE:
Set dry_run=true to preview sanitization without storing.
Shows what would be redacted and final transmitted text.`,
    inputSchema: {
      type: "object",
      properties: {
        session: {
          type: "string",
          description: "Brief context of what happened"
        },
        feeling: {
          type: "string",
          enum: ["stuck", "success"],
          description: "stuck = friction/antipattern, success = flow/pattern"
        },
        insight: {
          type: "string",
          description: "What specifically worked or didn't - MUST ASK USER, do not guess"
        },
        dry_run: {
          type: "boolean",
          description: "If true, preview what would be captured without storing (CEDA-65)"
        },
      },
      required: ["session", "feeling", "insight"],
    },
  },
  // Query learned patterns - Claude reads this to avoid repeating mistakes
  {
    name: "herald_patterns",
    description: `Query learned patterns and antipatterns for current context.

CALL THIS AT SESSION START to learn from past sessions.

Returns:
- patterns: Things that worked (reinforce these)
- antipatterns: Things that failed (avoid these)
- meta: Which capture method works better

Use this to:
1. Avoid repeating past mistakes
2. Apply proven approaches
3. Learn from other sessions in this project`,
    inputSchema: {
      type: "object",
      properties: {
        context: {
          type: "string",
          description: "Optional context to filter patterns (e.g., 'deployment', 'debugging')"
        },
      },
    },
  },
  // AI-Native Simulation - Deep pattern extraction via AI-to-AI roleplay
  {
    name: "herald_simulate",
    description: `AI-native pattern extraction via AI-to-AI reflection.

Use when you need DEEP analysis - not just capturing, but understanding WHY.

WHEN TO USE herald_simulate vs herald_reflect:
- herald_reflect: Quick capture, obvious pattern, user knows signal
- herald_simulate: Complex situation, need AI to discover deeper signal

Requires: ANTHROPIC_API_KEY or OPENAI_API_KEY in env.

BEFORE CALLING - ASK USER:
"What specifically worked (or didn't)?"

This tool:
1. Calls another AI to roleplay as a reflection partner
2. AI extracts: signal (what caused it), outcome, reinforcement/warning text
3. Sends enriched data to CEDA with method="simulation"

CEDA learns which method works better for which contexts (meta-learning).`,
    inputSchema: {
      type: "object",
      properties: {
        session: {
          type: "string",
          description: "Context of what happened in the session"
        },
        feeling: {
          type: "string",
          enum: ["stuck", "success"],
          description: "stuck = friction/antipattern, success = flow/pattern"
        },
        insight: {
          type: "string",
          description: "User's answer to 'what worked/didn't' - MUST ASK USER"
        },
      },
      required: ["session", "feeling", "insight"],
    },
  },
  // CEDA-64: Herald Command Extensions
  {
    name: "herald_session_reflections",
    description: `Get summary of reflections captured during this MCP session.

Returns count of patterns and antipatterns captured since Herald started.
This is LOCAL tracking - clears when Herald restarts.

Use this to:
1. Review what's been captured in the current session
2. Verify reflections were recorded
3. Get a quick summary before ending a session`,
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "herald_pattern_feedback",
    description: `Provide feedback on whether a learned pattern/antipattern helped.

Call this after applying a pattern from herald_patterns to track effectiveness.
This feeds the meta-learning loop - CEDA learns which patterns actually help.

Parameters:
- pattern_id: ID of the pattern/reflection (from herald_patterns output)
- pattern_text: Alternative to ID - the pattern text to match
- outcome: "helped" or "didnt_help"

Example: After applying an antipattern warning and it prevented a mistake,
call with outcome="helped" to reinforce that pattern.`,
    inputSchema: {
      type: "object",
      properties: {
        pattern_id: {
          type: "string",
          description: "ID of the pattern/reflection to provide feedback on"
        },
        pattern_text: {
          type: "string",
          description: "Alternative: pattern text to match (if ID not available)"
        },
        outcome: {
          type: "string",
          enum: ["helped", "didnt_help"],
          description: "Whether applying this pattern helped or not"
        },
      },
      required: ["outcome"],
    },
  },
  {
    name: "herald_share_scoped",
    description: `Share an insight with other Herald contexts using scope control.

Scopes:
- "parent": Share with parent project/company (escalate learning)
- "siblings": Share with sibling projects in same company
- "all": Share globally across all contexts

Use this to propagate valuable patterns beyond the current context.
Example: A debugging pattern that worked well could be shared with siblings.`,
    inputSchema: {
      type: "object",
      properties: {
        insight: {
          type: "string",
          description: "The insight/pattern to share"
        },
        scope: {
          type: "string",
          enum: ["parent", "siblings", "all"],
          description: "Who to share with: parent, siblings, or all"
        },
        topic: {
          type: "string",
          description: "Optional topic category for the insight"
        },
      },
      required: ["insight", "scope"],
    },
  },
  // CEDA-65: GDPR Compliance Tools
  {
    name: "herald_forget",
    description: `GDPR Article 17 - Right to Erasure ("Right to be Forgotten").

Delete learned patterns and reflections from CEDA storage.

Use this when:
- User requests deletion of their data
- Compliance requires data removal
- Cleaning up test/invalid patterns

Parameters:
- pattern_id: Delete a specific pattern by ID
- session_id: Delete all patterns from a session
- all: Delete ALL patterns for current context (company/project/user)

WARNING: This action is irreversible. Data will be permanently deleted.`,
    inputSchema: {
      type: "object",
      properties: {
        pattern_id: {
          type: "string",
          description: "Specific pattern ID to delete"
        },
        session_id: {
          type: "string",
          description: "Delete all patterns from this session"
        },
        all: {
          type: "boolean",
          description: "Delete ALL patterns for current context (use with caution)"
        },
      },
    },
  },
  {
    name: "herald_export",
    description: `GDPR Article 20 - Right to Data Portability.

Export all learned patterns and reflections in a portable format.

Use this when:
- User requests a copy of their data
- Migrating data between systems
- Compliance audit requires data export

Returns all patterns for the current context (company/project/user) in the specified format.`,
    inputSchema: {
      type: "object",
      properties: {
        format: {
          type: "string",
          enum: ["json", "csv"],
          description: "Export format: json (default) or csv"
        },
      },
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// ============================================
// MCP RESOURCES - Auto-readable by Claude Code
// ============================================

// Helper to fetch patterns with cascade (reused from herald_patterns tool)
async function fetchPatternsWithCascade(): Promise<{patterns: string[], antipatterns: string[], context: string}> {
  type PatternEntry = {insight: string; scope?: string};
  const seenInsights = new Set<string>();
  const patterns: string[] = [];
  const antipatterns: string[] = [];

  const queries = [
    { scope: "user", url: `/api/herald/reflections?org=${HERALD_ORG}&project=${HERALD_PROJECT}&user=${HERALD_USER}&limit=100` },
    { scope: "project", url: `/api/herald/reflections?org=${HERALD_ORG}&project=${HERALD_PROJECT}&limit=100` },
    { scope: "org", url: `/api/herald/reflections?org=${HERALD_ORG}&limit=100` },
  ];

  for (const { scope, url } of queries) {
    try {
      const result = await callCedaAPI(url);
      const scopePatterns = (result.patterns as PatternEntry[]) || [];
      const scopeAntipatterns = (result.antipatterns as PatternEntry[]) || [];

      for (const p of scopePatterns) {
        const key = p.insight.toLowerCase().trim();
        if (!seenInsights.has(key)) {
          seenInsights.add(key);
          patterns.push(`${p.insight} [${scope}]`);
        }
      }
      for (const ap of scopeAntipatterns) {
        const key = ap.insight.toLowerCase().trim();
        if (!seenInsights.has(key)) {
          seenInsights.add(key);
          antipatterns.push(`${ap.insight} [${scope}]`);
        }
      }
    } catch {
      // Continue if a level fails
    }
  }

  return { patterns, antipatterns, context: `${HERALD_USER}→${HERALD_PROJECT}→${HERALD_ORG}` };
}

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const resources: Resource[] = [
    {
      uri: "herald://patterns",
      name: "Herald Learned Patterns",
      description: `Patterns and antipatterns learned from past sessions for ${HERALD_USER}→${HERALD_PROJECT}→${HERALD_ORG}. READ THIS AT SESSION START.`,
      mimeType: "text/plain",
    },
    {
      uri: "herald://context",
      name: "Herald Context",
      description: "Current Herald context configuration (company/project/user)",
      mimeType: "application/json",
    },
  ];
  return { resources };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  if (uri === "herald://patterns") {
    try {
      const { patterns, antipatterns, context } = await fetchPatternsWithCascade();

      let content = `# Herald Patterns for ${context}\n\n`;
      content += `**READ THIS FIRST** - These are learned patterns from past sessions.\n\n`;

      if (antipatterns.length > 0) {
        content += `## ⚠️ ANTIPATTERNS - AVOID THESE\n`;
        antipatterns.forEach((ap, i) => {
          content += `${i + 1}. ${ap}\n`;
        });
        content += `\n`;
      }

      if (patterns.length > 0) {
        content += `## ✓ PATTERNS - DO THESE\n`;
        patterns.forEach((p, i) => {
          content += `${i + 1}. ${p}\n`;
        });
        content += `\n`;
      }

      if (patterns.length === 0 && antipatterns.length === 0) {
        content += `No patterns learned yet. Capture patterns with "herald reflect" when you notice friction or flow.\n`;
      }

      content += `\n---\n*Auto-loaded from CEDA. Call herald_pattern_feedback() when a pattern helps.*\n`;

      return {
        contents: [{
          uri,
          mimeType: "text/plain",
          text: content,
        }],
      };
    } catch (error) {
      return {
        contents: [{
          uri,
          mimeType: "text/plain",
          text: `Failed to load patterns: ${error}\n\nCEDA may be unavailable.`,
        }],
      };
    }
  }

  if (uri === "herald://context") {
    const context = {
      org: HERALD_ORG,
      project: HERALD_PROJECT,
      user: HERALD_USER,
      vault: HERALD_VAULT || null,
      tags: HERALD_TAGS,
      trust: TRUST_LEVEL,
      source: CONTEXT_SOURCE,
      propagates: PROPAGATES,
      gitRemote: GIT_REMOTE,
      cedaUrl: CEDA_API_URL,
    };
    return {
      contents: [{
        uri,
        mimeType: "application/json",
        text: JSON.stringify(context, null, 2),
      }],
    };
  }

  throw new Error(`Unknown resource: ${uri}`);
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "herald_help": {
        const contextStr = getContextString();
        const helpText = `# Herald MCP v${VERSION}

Welcome to Herald - your AI-native interface to CEDA (Cognitive Event-Driven Architecture).

## Current Context
- Company: ${HERALD_ORG}
- Project: ${HERALD_PROJECT}
- User: ${HERALD_USER}

## Available Tools

**Getting Started:**
- \`herald_help\` - This guide
- \`herald_health\` - Check CEDA connection
- \`herald_stats\` - View patterns and sessions

**Core Workflow:**
1. \`herald_predict\` - Generate structure predictions from natural language
   Example: "create a safety incident module"
2. \`herald_refine\` - Improve predictions iteratively
3. \`herald_feedback\` - Accept or reject predictions (feeds learning loop)

**Sessions:**
- \`herald_session\` - View session history (legacy)

**Session Management (CEDA-49):**
- \`herald_session_list\` - List sessions with filters (company, project, user, status)
- \`herald_session_get\` - Get detailed session info including prediction state
- \`herald_session_history\` - View version history for a session
- \`herald_session_rollback\` - Restore a session to a previous version
- \`herald_session_archive\` - Archive a session (mark as inactive)

**Context Sync:**
- \`herald_context_status\` - See other Herald instances
- \`herald_share_insight\` - Share patterns across projects
- \`herald_query_insights\` - Get accumulated insights

## Quick Example

Ask me to create something:
> "Create a module for tracking safety incidents with forms for reporting and investigation"

Herald will:
1. Generate a structure prediction based on learned patterns
2. Let you refine it ("add OSHA compliance fields")
3. Learn from your feedback to improve future predictions

## Resources
- Setup Guide: https://getceda.com/docs/herald-setup-guide.md
- CEDA Backend: ${CEDA_API_URL || "not configured"}

## Tips
- Be specific in your requests - Herald learns from patterns
- Use refine to iterate on predictions
- Your feedback (accept/reject) improves CEDA for everyone
`;
        return {
          content: [{ type: "text", text: helpText }],
        };
      }

      case "herald_health": {
        const cedaHealth = await callCedaAPI("/health");
        const buffer = getBufferedInsights();
        const cloudAvailable = !cedaHealth.error;

        const config = {
          cedaUrl: CEDA_API_URL,
          org: HERALD_ORG,
          project: HERALD_PROJECT,
          user: HERALD_USER,
          vault: HERALD_VAULT || "(not set)",
          tags: HERALD_TAGS,
          trust: TRUST_LEVEL,
          source: CONTEXT_SOURCE,
          propagates: PROPAGATES,
          gitRemote: GIT_REMOTE,
        };

        const warnings: string[] = [];
        if (CONTEXT_SOURCE === 'path') {
          warnings.push(`Context derived from folder path (LOW trust)`);
          warnings.push("Add git remote for HIGH trust context");
        }
        if (!process.env.CEDA_URL && !process.env.HERALD_API_URL) {
          warnings.push("Using default CEDA_URL (getceda.com) - set CEDA_URL for custom endpoint");
        }

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              herald: {
                version: VERSION,
                config,
                warnings: warnings.length > 0 ? warnings : undefined,
              },
              ceda: cedaHealth,
              buffer: {
                size: buffer.length,
                mode: cloudAvailable ? "cloud" : "local",
                hint: buffer.length > 0 ? "Use herald_sync to flush buffered insights" : undefined,
              },
            }, null, 2)
          }],
        };
      }

      case "herald_context": {
        const refresh = args?.refresh as boolean;

        if (refresh) {
          // Re-derive context from current directory
          const newContext = loadOrDeriveContext();

          // Update module-level variables directly
          HERALD_USER = newContext.user;
          HERALD_TAGS = newContext.tags;
          HERALD_ORG = newContext.tags[0] || "";
          HERALD_PROJECT = newContext.tags[1] || newContext.tags[0] || "";
          TRUST_LEVEL = newContext.trust;
          CONTEXT_SOURCE = newContext.source;
          PROPAGATES = newContext.propagates;

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                refreshed: true,
                context: {
                  org: HERALD_ORG,
                  project: HERALD_PROJECT,
                  user: HERALD_USER,
                  tags: HERALD_TAGS,
                  trust: TRUST_LEVEL,
                  source: CONTEXT_SOURCE,
                  propagates: PROPAGATES,
                  gitRemote: newContext.gitRemote,
                },
                message: TRUST_LEVEL === 'HIGH'
                  ? `Context refreshed from git: ${newContext.gitRemote}`
                  : `Context refreshed from ${CONTEXT_SOURCE} (LOW trust)`
              }, null, 2)
            }],
          };
        }

        // Just return current context
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              context: {
                org: HERALD_ORG,
                project: HERALD_PROJECT,
                user: HERALD_USER,
                tags: HERALD_TAGS,
                trust: TRUST_LEVEL,
                source: CONTEXT_SOURCE,
                propagates: PROPAGATES,
                gitRemote: GIT_REMOTE,
              },
              hint: TRUST_LEVEL === 'LOW'
                ? "Use herald_context(refresh=true) in a git repo for HIGH trust"
                : undefined
            }, null, 2)
          }],
        };
      }

      case "herald_stats": {
        const result = await callCedaAPI("/api/stats");
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "herald_gate": {
        const operation = args?.operation as string;
        const scope = args?.scope as string;
        const template = args?.template as string | undefined;
        const rationale = args?.rationale as string | undefined;

        // Generate gate ID for tracking
        const gateId = `gate-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Format the authorization request
        let gateRequest = `\n## Authorization Required\n\n`;
        gateRequest += `**Operation:** ${operation}\n`;
        gateRequest += `**Scope:** ${scope}\n`;
        if (template) {
          gateRequest += `**Template:** Following \`${template}\` patterns\n`;
        }
        if (rationale) {
          gateRequest += `**Rationale:** ${rationale}\n`;
        }
        gateRequest += `\n---\n`;
        gateRequest += `**Proceed?** [Y/yes/proceed] [adjust] [N/no]\n`;
        gateRequest += `\n_Gate ID: ${gateId}_\n`;

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              gate_id: gateId,
              status: "awaiting_authorization",
              message: gateRequest,
              operation,
              scope,
              template: template || null,
              instruction: "STOP HERE. Wait for user response before proceeding with any file operations.",
            }, null, 2)
          }],
        };
      }

      case "herald_predict": {
        const signal = args?.signal as string;
        const contextStr = args?.context as string | undefined;
        const sessionId = args?.session_id as string | undefined;
        const participant = args?.participant as string | undefined;

        // Convert string context to CEDA's expected array format
        const context = contextStr
          ? [{ type: "user_context", value: contextStr, source: "herald" }]
          : undefined;

        const result = await callCedaAPI("/api/predict", "POST", {
          input: signal,
          context,
          sessionId,
          participant,
          config: { enableAutoFix: true, maxAutoFixAttempts: 3 },
        });

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "herald_refine": {
        const sessionId = args?.session_id as string;
        const refinement = args?.refinement as string;
        const contextStr = args?.context as string | undefined;
        const participant = args?.participant as string | undefined;

        // Convert string context to CEDA's expected array format
        const context = contextStr
          ? [{ type: "user_context", value: contextStr, source: "herald" }]
          : undefined;

        const result = await callCedaAPI("/api/refine", "POST", {
          sessionId,
          refinement,
          context,
          participant,
        });

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "herald_session": {
        const sessionId = args?.session_id as string;
        const result = await callCedaAPI(`/api/session/${sessionId}`);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "herald_feedback": {
        const sessionId = args?.session_id as string;
        const accepted = args?.accepted as boolean;
        const comment = args?.comment as string | undefined;

        const result = await callCedaAPI("/api/feedback", "POST", {
          sessionId,
          accepted,
          comment,
        });

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "herald_context_status": {
        const vault = args?.vault as string | undefined;

        if (OFFSPRING_CLOUD_MODE) {
          const endpoint = vault ? `/api/herald/contexts?vault=${vault}` : "/api/herald/contexts";
          const result = await callCedaAPI(endpoint);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        // Local mode - read from files
        const vaults = vault ? [vault] : ["spilno", "goprint", "disrupt"];
        const statuses: Record<string, unknown> = {};

        for (const v of vaults) {
          const statusPath = join(AEGIS_OFFSPRING_PATH, v, "_status.md");
          if (existsSync(statusPath)) {
            statuses[v] = readFileSync(statusPath, "utf-8");
          }
        }

        return {
          content: [{ type: "text", text: JSON.stringify(statuses, null, 2) }],
        };
      }

      case "herald_share_insight": {
        const insight = args?.insight as string;
        const targetVault = args?.target_vault as string | undefined;
        const topic = args?.topic as string | undefined;

        const payload = {
          insight,
          topic,
          targetVault,
          sourceVault: HERALD_VAULT || undefined,
          org: HERALD_ORG,
          project: HERALD_PROJECT,
          user: HERALD_USER,
        };

        // Cloud-first: try to POST to CEDA, buffer locally on failure
        // Map Herald's vault terminology to CEDA's context terminology
        // Default toContext to "all" for guest mode / when no target specified
        try {
          const result = await callCedaAPI("/api/herald/insight", "POST", {
            insight,
            toContext: targetVault || "all",  // Required by CEDA, default to broadcast
            topic,
            fromContext: HERALD_VAULT || `${HERALD_ORG}/${HERALD_PROJECT}`,
          });

          // Check if API returned an error
          if (result.error) {
            bufferInsight(payload);
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  success: true,
                  mode: "local",
                  message: "Insight buffered locally (cloud returned error)",
                  error: result.error,
                  bufferSize: getBufferedInsights().length,
                  hint: "Use herald_sync to flush buffer when cloud recovers",
                }, null, 2)
              }],
            };
          }

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                ...result,
                mode: "cloud",
              }, null, 2)
            }],
          };
        } catch (error) {
          // Cloud unavailable - buffer locally
          bufferInsight(payload);
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: true,
                mode: "local",
                message: "Insight buffered locally (cloud unavailable)",
                bufferSize: getBufferedInsights().length,
                hint: "Use herald_sync to flush buffer when cloud recovers",
              }, null, 2)
            }],
          };
        }
      }

      case "herald_sync": {
        const dryRun = args?.dry_run as boolean | undefined;
        const buffer = getBufferedInsights();

        if (buffer.length === 0) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: true,
                message: "Buffer empty, nothing to sync",
                synced: 0,
              }, null, 2)
            }],
          };
        }

        if (dryRun) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                dryRun: true,
                wouldSync: buffer.length,
                insights: buffer.map(b => ({
                  topic: b.topic,
                  insight: b.insight.substring(0, 100) + (b.insight.length > 100 ? "..." : ""),
                  bufferedAt: b.bufferedAt,
                })),
              }, null, 2)
            }],
          };
        }

        const synced: BufferedInsight[] = [];
        const failed: BufferedInsight[] = [];

        for (const item of buffer) {
          try {
            let result;

            // CEDA-100: Route based on buffer item type
            if (item.type === "reflection") {
              // Reflections go to /api/herald/reflect (stored in PlanetScale, shown in dashboard)
              result = await callCedaAPI("/api/herald/reflect", "POST", {
                session: item.session || item.insight,
                feeling: item.feeling || "success",
                insight: item.insight,
                method: item.method || "direct",
                org: item.org,
                project: item.project,
                user: item.user,
              });
            } else {
              // Insights (default) go to /api/herald/insight (legacy behavior)
              result = await callCedaAPI("/api/herald/insight", "POST", {
                insight: item.insight,
                topic: item.topic,
                toContext: item.targetVault || "all",
                fromContext: item.sourceVault,
              });
            }

            if (result.error) {
              failed.push(item);
            } else {
              synced.push(item);
            }
          } catch {
            failed.push(item);
          }
        }

        // Save only failed items back to buffer
        saveFailedInsights(failed);

        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: true,
              message: failed.length === 0 ? "All insights synced to CEDA" : "Partial sync completed",
              synced: synced.length,
              failed: failed.length,
              remainingBuffer: failed.length,
            }, null, 2)
          }],
        };
      }

      case "herald_query_insights": {
        const topic = args?.topic as string;
        const vault = args?.vault as string | undefined;

        if (OFFSPRING_CLOUD_MODE) {
          const endpoint = vault
            ? `/api/herald/insights?topic=${encodeURIComponent(topic)}&vault=${vault}`
            : `/api/herald/insights?topic=${encodeURIComponent(topic)}`;
          const result = await callCedaAPI(endpoint);
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }

        return {
          content: [{ type: "text", text: JSON.stringify({ insights: [], message: "Local mode - no shared insights" }, null, 2) }],
        };
      }

      // CEDA-49: Session Management Tools
      case "herald_session_list": {
        const company = args?.company as string | undefined;
        const project = args?.project as string | undefined;
        const user = args?.user as string | undefined;
        const status = args?.status as string | undefined;
        const limit = args?.limit as number | undefined;

        const params = new URLSearchParams();
        params.set("company", company || HERALD_ORG);
        if (project) params.set("project", project);
        if (user) params.set("user", user);
        if (status) params.set("status", status);
        if (limit) params.set("limit", String(limit));

        const result = await callCedaAPI(`/api/sessions?${params.toString()}`);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "herald_session_get": {
        const sessionId = args?.session_id as string;
        const result = await callCedaAPI(`/api/session/${sessionId}`);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "herald_session_history": {
        const sessionId = args?.session_id as string;
        const limit = args?.limit as number | undefined;

        let endpoint = `/api/session/${sessionId}/history`;
        if (limit) {
          endpoint += `?limit=${limit}`;
        }

        const result = await callCedaAPI(endpoint);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "herald_session_rollback": {
        const sessionId = args?.session_id as string;
        const version = args?.version as number;

        const result = await callCedaAPI(
          `/api/session/${sessionId}/rollback?version=${version}`,
          "POST"
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "herald_session_archive": {
        const sessionId = args?.session_id as string;

        const result = await callCedaAPI(`/api/session/${sessionId}`, "PUT", {
          status: "archived",
        });
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "herald_reflect": {
        const session = args?.session as string;
        const feeling = args?.feeling as "stuck" | "success";
        const insight = args?.insight as string;
        const dryRun = args?.dry_run as boolean | undefined;

        // CEDA-65: Client-side sanitization preview (no network required)
        const sessionPreview = previewSanitization(session);
        const insightPreview = previewSanitization(insight);

        // Check if content would be blocked
        if (sessionPreview.wouldBlock || insightPreview.wouldBlock) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: false,
                mode: "blocked",
                error: "Content contains restricted data that cannot be transmitted",
                blockReason: sessionPreview.blockReason || insightPreview.blockReason,
                detectedTypes: [...sessionPreview.detectedTypes, ...insightPreview.detectedTypes],
                hint: "Remove private keys, AWS credentials, or other restricted data before capturing.",
              }, null, 2)
            }],
            isError: true,
          };
        }

        // Dry-run mode - show sanitization preview without storing
        if (dryRun) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: true,
                mode: "dry-run",
                message: "Preview of what would be captured (no data stored or transmitted)",
                feeling,
                sanitization: {
                  session: {
                    original: session,
                    sanitized: sessionPreview.sanitized,
                    wouldSanitize: sessionPreview.wouldSanitize,
                    detectedTypes: sessionPreview.detectedTypes,
                    classification: sessionPreview.classification,
                  },
                  insight: {
                    original: insight,
                    sanitized: insightPreview.sanitized,
                    wouldSanitize: insightPreview.wouldSanitize,
                    detectedTypes: insightPreview.detectedTypes,
                    classification: insightPreview.classification,
                  },
                },
                hint: insightPreview.wouldSanitize || sessionPreview.wouldSanitize
                  ? "Some content will be redacted. Consider using more abstract descriptions."
                  : "Content looks clean. Safe to capture.",
              }, null, 2)
            }],
          };
        }

        // Sanitize before transmission
        const sanitizedSession = sessionPreview.sanitized;
        const sanitizedInsight = insightPreview.sanitized;

        // CEDA-64: Track reflection locally for session summary
        addSessionReflection({
          session,
          feeling,
          insight,
          method: "direct",
        });

        // Call CEDA's reflect endpoint with SANITIZED insight
        try {
          const result = await callCedaAPI("/api/herald/reflect", "POST", {
            session: sanitizedSession,
            feeling,
            insight: sanitizedInsight,  // Sanitized - no PII/secrets transmitted
            method: "direct",  // Track capture method for meta-learning
            org: HERALD_ORG,
            project: HERALD_PROJECT,
            user: HERALD_USER,
            vault: HERALD_VAULT || undefined,
          });

          if (result.error) {
            // If cloud fails, store locally for later processing (also sanitized)
            // CEDA-100: Mark as reflection type for proper sync routing
            bufferInsight({
              insight: sanitizedInsight,
              session: sanitizedSession,
              feeling,
              method: "direct",
              type: "reflection",
              topic: feeling === "stuck" ? "antipattern" : "pattern",
              org: HERALD_ORG,
              project: HERALD_PROJECT,
              user: HERALD_USER,
            });

            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  success: true,
                  mode: "local",
                  message: "Reflection buffered locally (cloud unavailable)",
                  feeling,
                  insight,
                  hint: "CEDA will process this when synced. Use herald_sync to flush buffer.",
                  buffered: true,
                }, null, 2)
              }],
            };
          }

          // Cloud processed successfully
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: true,
                mode: "cloud",
                feeling,
                insight,
                message: feeling === "stuck"
                  ? `Antipattern captured: "${insight}"`
                  : `Pattern captured: "${insight}"`,
                context: {
                  org: HERALD_ORG,
                  project: HERALD_PROJECT,
                  tags: HERALD_TAGS,
                  trust: TRUST_LEVEL,
                  propagates: PROPAGATES,
                },
                ...result,
              }, null, 2)
            }],
          };
        } catch (error) {
          // Network error - buffer locally (sanitized)
          // CEDA-100: Mark as reflection type for proper sync routing
          bufferInsight({
            insight: sanitizedInsight,
            session: sanitizedSession,
            feeling,
            method: "direct",
            type: "reflection",
            topic: feeling === "stuck" ? "antipattern" : "pattern",
            org: HERALD_ORG,
            project: HERALD_PROJECT,
            user: HERALD_USER,
          });

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: true,
                mode: "local",
                message: "Reflection buffered locally (cloud unreachable)",
                feeling,
                insight: sanitizedInsight,
                hint: "Use herald_sync when cloud recovers.",
                buffered: true,
                sanitized: sessionPreview.wouldSanitize || insightPreview.wouldSanitize,
              }, null, 2)
            }],
          };
        }
      }

      case "herald_patterns": {
        // Query learned patterns with inheritance: user → project → company
        // More specific patterns take precedence over broader ones
        try {
          type PatternEntry = {insight: string; signal?: string; reinforcement?: string; warning?: string; scope?: string};

          // Helper to dedupe patterns by insight text (first occurrence wins)
          const seenInsights = new Set<string>();
          const dedupePatterns = (items: PatternEntry[], scope: string): PatternEntry[] => {
            return items.filter(item => {
              const key = item.insight.toLowerCase().trim();
              if (seenInsights.has(key)) return false;
              seenInsights.add(key);
              return true;
            }).map(item => ({ ...item, scope }));
          };

          // CEDA-95: Cascade queries with minLevel=1 to only return graduated patterns (not observations)
          // Observations (level 0) are raw captures; patterns (level 1+) are validated
          const queries = [
            { scope: "user", url: `/api/herald/reflections?org=${HERALD_ORG}&project=${HERALD_PROJECT}&user=${HERALD_USER}&limit=100&minLevel=1` },
            { scope: "project", url: `/api/herald/reflections?org=${HERALD_ORG}&project=${HERALD_PROJECT}&limit=100&minLevel=1` },
            { scope: "org", url: `/api/herald/reflections?org=${HERALD_ORG}&limit=100&minLevel=1` },
          ];

          const patterns: PatternEntry[] = [];
          const antipatterns: PatternEntry[] = [];

          // Query each level, dedupe as we go (user patterns win over project, project over company)
          for (const { scope, url } of queries) {
            try {
              const result = await callCedaAPI(url);
              const scopePatterns = (result.patterns as PatternEntry[]) || [];
              const scopeAntipatterns = (result.antipatterns as PatternEntry[]) || [];

              patterns.push(...dedupePatterns(scopePatterns, scope));
              antipatterns.push(...dedupePatterns(scopeAntipatterns, scope));
            } catch {
              // Continue if a level fails (e.g., user not set)
            }
          }

          const metaResult = await callCedaAPI("/api/herald/meta-patterns");
          const metaPatterns = (metaResult.metaPatterns as Array<{recommendedMethod: string; confidence: number}>) || [];

          // Build readable summary with scope indicators
          let summary = `## Learned Patterns for ${HERALD_USER}→${HERALD_PROJECT}→${HERALD_ORG}\n\n`;

          if (antipatterns.length > 0) {
            summary += `### ⚠️ Antipatterns (avoid these)\n`;
            antipatterns.forEach((ap, i) => {
              const scopeTag = ap.scope ? ` [${ap.scope}]` : "";
              summary += `${i + 1}. ${ap.insight}${scopeTag}`;
              if (ap.warning) summary += `\n   → ${ap.warning}`;
              summary += `\n`;
            });
            summary += `\n`;
          }

          if (patterns.length > 0) {
            summary += `### ✓ Patterns (do these)\n`;
            patterns.forEach((p, i) => {
              const scopeTag = p.scope ? ` [${p.scope}]` : "";
              summary += `${i + 1}. ${p.insight}${scopeTag}`;
              if (p.reinforcement) summary += `\n   → ${p.reinforcement}`;
              summary += `\n`;
            });
            summary += `\n`;
          }

          if (metaPatterns.length > 0) {
            const meta = metaPatterns[0];
            summary += `### Meta-learning\n`;
            summary += `Recommended capture method: ${meta.recommendedMethod} (${(meta.confidence * 100).toFixed(0)}% confidence)\n`;
          }

          if (patterns.length === 0 && antipatterns.length === 0) {
            summary = `No patterns learned yet for ${HERALD_USER}→${HERALD_PROJECT}→${HERALD_ORG}.\n\nCapture patterns with "herald reflect" or "herald simulate" when you notice friction or flow.`;
          }

          return {
            content: [{
              type: "text",
              text: summary,
            }],
          };

        } catch (error) {
          return {
            content: [{
              type: "text",
              text: `Failed to query patterns: ${error}\n\nCEDA may be unavailable.`,
            }],
          };
        }
      }

      case "herald_simulate": {
        const session = args?.session as string;
        const feeling = args?.feeling as "stuck" | "success";
        const insight = args?.insight as string;

        // CEDA-65: Client-side sanitization
        const simSessionPreview = previewSanitization(session);
        const simInsightPreview = previewSanitization(insight);

        // Block restricted content
        if (simSessionPreview.wouldBlock || simInsightPreview.wouldBlock) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: false,
                mode: "blocked",
                error: "Content contains restricted data that cannot be transmitted",
                blockReason: simSessionPreview.blockReason || simInsightPreview.blockReason,
                hint: "Remove private keys, AWS credentials, or other restricted data before capturing.",
              }, null, 2)
            }],
            isError: true,
          };
        }

        const simSanitizedSession = simSessionPreview.sanitized;
        const simSanitizedInsight = simInsightPreview.sanitized;

        // CEDA-64: Track reflection locally for session summary
        addSessionReflection({
          session,
          feeling,
          insight,
          method: "simulation",
        });

        // Check for AI API key
        const aiClient = getAIClient();
        if (!aiClient) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: false,
                error: "No AI key configured",
                hint: "Add ANTHROPIC_API_KEY or OPENAI_API_KEY to env in .claude/settings.local.json",
                fallback: "Use herald_reflect for direct capture instead",
              }, null, 2)
            }],
          };
        }

        try {
          // Build prompt and call AI for reflection (use sanitized input)
          const prompt = buildReflectionPrompt(simSanitizedSession, feeling, simSanitizedInsight);
          const extracted = await callAIForReflection(aiClient, prompt);

          // Sanitize AI-extracted fields too
          const sanitizedSignal = sanitize(extracted.signal || "").sanitizedText;
          const sanitizedReinforcement = extracted.reinforcement ? sanitize(extracted.reinforcement).sanitizedText : undefined;
          const sanitizedWarning = extracted.warning ? sanitize(extracted.warning).sanitizedText : undefined;

          // Send enriched data to CEDA (all sanitized)
          const result = await callCedaAPI("/api/herald/reflect", "POST", {
            session: simSanitizedSession,
            feeling,
            insight: simSanitizedInsight,
            method: "simulation",  // Track capture method
            // AI-extracted fields (sanitized)
            signal: sanitizedSignal,
            outcome: extracted.outcome,
            reinforcement: sanitizedReinforcement,
            warning: sanitizedWarning,
            org: HERALD_ORG,
            project: HERALD_PROJECT,
            user: HERALD_USER,
            vault: HERALD_VAULT || undefined,
          });

          if (result.error) {
            // Cloud failed but we have AI extraction - buffer with enriched data (sanitized)
            // CEDA-100: Mark as reflection type for proper sync routing
            bufferInsight({
              insight: simSanitizedInsight,
              session: simSanitizedSession,
              feeling,
              method: "simulation",
              type: "reflection",
              topic: extracted.outcome,
              org: HERALD_ORG,
              project: HERALD_PROJECT,
              user: HERALD_USER,
            });

            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  success: true,
                  mode: "local",
                  method: "simulation",
                  message: "AI reflection complete, buffered locally (cloud unavailable)",
                  extracted: {
                    signal: extracted.signal,
                    outcome: extracted.outcome,
                    reinforcement: extracted.reinforcement,
                    warning: extracted.warning,
                  },
                  hint: "Use herald_sync to flush to CEDA when cloud recovers",
                }, null, 2)
              }],
            };
          }

          // Success - AI reflection sent to CEDA
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: true,
                mode: "cloud",
                method: "simulation",
                provider: aiClient.provider,
                message: extracted.outcome === "pattern"
                  ? `Pattern extracted via AI reflection`
                  : `Antipattern extracted via AI reflection`,
                extracted: {
                  signal: extracted.signal,
                  outcome: extracted.outcome,
                  reinforcement: extracted.reinforcement,
                  warning: extracted.warning,
                },
                insight,
                ...result,
              }, null, 2)
            }],
          };

        } catch (error) {
          // AI call failed
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: false,
                error: `AI reflection failed: ${error}`,
                provider: aiClient.provider,
                hint: "Check API key validity. Use herald_reflect for direct capture as fallback.",
              }, null, 2)
            }],
          };
        }
      }

      // CEDA-64: Herald Command Extensions - Handlers
      case "herald_session_reflections": {
        const summary = getSessionReflectionsSummary();
        
        let message = `## Session Reflections Summary\n\n`;
        message += `**Total captured:** ${summary.count}\n`;
        message += `- Patterns (success): ${summary.patterns}\n`;
        message += `- Antipatterns (stuck): ${summary.antipatterns}\n\n`;
        
        if (summary.reflections.length > 0) {
          message += `### Captured This Session:\n`;
          summary.reflections.forEach((r, i) => {
            const icon = r.feeling === "success" ? "+" : "-";
            message += `${i + 1}. [${icon}] ${r.insight} (${r.method}, ${r.timestamp})\n`;
          });
        } else {
          message += `No reflections captured yet. Use herald_reflect or herald_simulate to capture patterns.`;
        }
        
        return {
          content: [{
            type: "text",
            text: message,
          }],
        };
      }

      case "herald_pattern_feedback": {
        const patternId = args?.pattern_id as string | undefined;
        const patternText = args?.pattern_text as string | undefined;
        const outcome = args?.outcome as "helped" | "didnt_help";

        if (!patternId && !patternText) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: false,
                error: "Either pattern_id or pattern_text is required",
              }, null, 2)
            }],
            isError: true,
          };
        }

        try {
          const result = await callCedaAPI("/api/herald/feedback", "POST", {
            patternId,
            patternText,
            outcome,
            helped: outcome === "helped",
            org: HERALD_ORG,
            project: HERALD_PROJECT,
            user: HERALD_USER,
          });

          if (result.error) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  success: false,
                  error: result.error,
                  hint: "Pattern feedback could not be recorded. The pattern may not exist.",
                }, null, 2)
              }],
            };
          }

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: true,
                message: outcome === "helped"
                  ? "Feedback recorded: pattern helped! This reinforces the pattern."
                  : "Feedback recorded: pattern didn't help. This will be factored into future recommendations.",
                ...result,
              }, null, 2)
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: false,
                error: `Failed to record feedback: ${error}`,
                hint: "CEDA may be unavailable. Try again later.",
              }, null, 2)
            }],
          };
        }
      }

      case "herald_share_scoped": {
        const insight = args?.insight as string;
        const scope = args?.scope as "parent" | "siblings" | "all";
        const topic = args?.topic as string | undefined;

        try {
          const result = await callCedaAPI("/api/herald/share", "POST", {
            insight,
            scope,
            topic,
            sourceCompany: HERALD_ORG,
            sourceProject: HERALD_PROJECT,
            sourceUser: HERALD_USER,
            sourceVault: HERALD_VAULT || undefined,
          });

          if (result.error) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  success: false,
                  error: result.error,
                  hint: "Insight could not be shared. Check scope and try again.",
                }, null, 2)
              }],
            };
          }

          const scopeDescription = {
            parent: "parent project/company",
            siblings: "sibling projects",
            all: "all contexts globally",
          };

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: true,
                message: `Insight shared with ${scopeDescription[scope]}`,
                scope,
                topic: topic || "general",
                ...result,
              }, null, 2)
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: false,
                error: `Failed to share insight: ${error}`,
                hint: "CEDA may be unavailable. Try again later.",
              }, null, 2)
            }],
          };
        }
      }

      // CEDA-65: GDPR Compliance Tools - Handlers
      case "herald_forget": {
        const patternId = args?.pattern_id as string | undefined;
        const sessionId = args?.session_id as string | undefined;
        const deleteAll = args?.all as boolean | undefined;

        if (!patternId && !sessionId && !deleteAll) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: false,
                error: "At least one parameter required: pattern_id, session_id, or all",
                hint: "Specify what data to delete",
              }, null, 2)
            }],
            isError: true,
          };
        }

        try {
          const result = await callCedaAPI("/api/herald/forget", "DELETE", {
            patternId,
            sessionId,
            all: deleteAll,
            org: HERALD_ORG,
            project: HERALD_PROJECT,
            user: HERALD_USER,
          });

          if (result.error) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  success: false,
                  error: result.error,
                  hint: "Data deletion failed. Check parameters and try again.",
                }, null, 2)
              }],
            };
          }

          let message = "Data deleted successfully (GDPR Art. 17)";
          if (patternId) {
            message = `Pattern ${patternId} deleted`;
          } else if (sessionId) {
            message = `All patterns from session ${sessionId} deleted`;
          } else if (deleteAll) {
            message = `All patterns for ${HERALD_ORG}/${HERALD_PROJECT}/${HERALD_USER} deleted`;
          }

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: true,
                message,
                gdprArticle: "Article 17 - Right to Erasure",
                ...result,
              }, null, 2)
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: false,
                error: `Failed to delete data: ${error}`,
                hint: "CEDA may be unavailable. Try again later.",
              }, null, 2)
            }],
          };
        }
      }

      case "herald_export": {
        const format = (args?.format as string) || "json";

        try {
          const result = await callCedaAPI(
            `/api/herald/export?org=${HERALD_ORG}&project=${HERALD_PROJECT}&user=${HERALD_USER}&format=${format}`
          );

          if (result.error) {
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  success: false,
                  error: result.error,
                  hint: "Data export failed. Try again later.",
                }, null, 2)
              }],
            };
          }

          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: true,
                message: `Data exported in ${format.toUpperCase()} format (GDPR Art. 20)`,
                gdprArticle: "Article 20 - Right to Data Portability",
                format,
                context: `${HERALD_ORG}/${HERALD_PROJECT}/${HERALD_USER}`,
                ...result,
              }, null, 2)
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                success: false,
                error: `Failed to export data: ${error}`,
                hint: "CEDA may be unavailable. Try again later.",
              }, null, 2)
            }],
          };
        }
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (error) {
    return {
      content: [{ type: "text", text: `Error: ${error}` }],
      isError: true,
    };
  }
});

/**
 * CEDA-100: Check npm registry for updates
 * Non-blocking - runs in background, just informs user
 */
function checkForUpdates(): void {
  // Non-blocking version check
  fetch("https://registry.npmjs.org/@spilno/herald-mcp/latest", {
    headers: { "Accept": "application/json" },
  })
    .then(res => res.json())
    .then(data => {
      const latest = data.version;
      if (latest && latest !== VERSION) {
        console.error(`\n╔════════════════════════════════════════════════════════════╗`);
        console.error(`║  UPDATE AVAILABLE: v${VERSION} → v${latest}`.padEnd(61) + `║`);
        console.error(`║  Run: rm -rf ~/.npm/_npx/*herald* && /mcp                   ║`);
        console.error(`╚════════════════════════════════════════════════════════════╝\n`);
      }
    })
    .catch(() => {
      // Silent fail - don't block startup for version check
    });
}

async function autoSyncBuffer(): Promise<void> {
  if (!AUTO_SYNC_ON_STARTUP) return;

  const buffer = getBufferedInsights();
  if (buffer.length === 0) return;

  console.error(`[Herald] Auto-syncing ${buffer.length} buffered insight(s)...`);

  const synced: BufferedInsight[] = [];
  const failed: BufferedInsight[] = [];

  for (const item of buffer) {
    try {
      const result = await callCedaAPI("/api/herald/insight", "POST", {
        insight: item.insight,
        topic: item.topic,
        toContext: item.targetVault || "all",  // CEDA expects toContext
        fromContext: item.sourceVault,         // CEDA expects fromContext
      });

      if (result.error) {
        failed.push(item);
      } else {
        synced.push(item);
      }
    } catch {
      failed.push(item);
    }
  }

  saveFailedInsights(failed);

  if (synced.length > 0) {
    console.error(`[Herald] Synced ${synced.length} insight(s) to cloud`);
  }
  if (failed.length > 0) {
    console.error(`[Herald] ${failed.length} insight(s) failed - will retry on next startup`);
  }
}

/**
 * CEDA-82: Verify trust with CEDA server
 * If user registered via GitHub OAuth and has access to current repo,
 * CEDA returns verified context with HIGH trust.
 * Otherwise, trust remains as locally detected.
 */
async function verifyWithCeda(): Promise<void> {
  // Only verify if we have a git remote (potential HIGH trust)
  if (!GIT_REMOTE) {
    console.error(`[Herald] No git remote - skipping verification (trust: ${TRUST_LEVEL})`);
    return;
  }

  try {
    const result = await callCedaAPI("/api/auth/verify", "POST", {
      gitRemote: GIT_REMOTE,
      user: HERALD_USER,
    });

    if (result.verified === true && result.context) {
      // Server verified - user has access to this repo
      const ctx = result.context as Record<string, unknown>;
      VERIFIED_CONTEXT = {
        verified: true,
        org: (ctx.org || ctx.company) as string,
        project: ctx.project as string,
        trust: ctx.trust as TrustLevel,
        tags: ctx.tags as string[],
      };

      // Upgrade trust to server-verified
      TRUST_LEVEL = VERIFIED_CONTEXT.trust || 'HIGH';
      PROPAGATES = true;
      CONTEXT_SOURCE = 'verified';

      console.error(`[Herald] Verified with CEDA: ${VERIFIED_CONTEXT.org}/${VERIFIED_CONTEXT.project} (trust: HIGH)`);
    } else {
      // Not verified - user not registered or no access to this repo
      // Keep local trust level (which may be HIGH from git, but unverified)
      const reason = result.error || 'User not registered for this repository';
      console.error(`[Herald] Not verified: ${reason} (trust: ${TRUST_LEVEL}, unverified)`);

      // Optionally downgrade to LOW if strict mode
      if (process.env.HERALD_STRICT_TRUST === 'true') {
        TRUST_LEVEL = 'LOW';
        PROPAGATES = false;
        console.error(`[Herald] Strict mode: downgraded to LOW trust`);
      }
    }
  } catch (error) {
    // CEDA unreachable - keep local trust
    console.error(`[Herald] Verification failed (CEDA unreachable): ${error}`);
    console.error(`[Herald] Using local trust: ${TRUST_LEVEL}`);
  }
}

async function sendStartupHeartbeat(): Promise<void> {
  // Fire-and-forget heartbeat - don't block startup
  try {
    await callCedaAPI("/api/herald/heartbeat", "POST", {
      event: "startup",
      version: VERSION,
      user: HERALD_USER,
      tags: HERALD_TAGS,
      trust: TRUST_LEVEL,
      propagates: PROPAGATES,
      contextSource: CONTEXT_SOURCE,
      gitRemote: GIT_REMOTE,
      platform: process.platform,
      nodeVersion: process.version,
    });
  } catch {
    // Silent fail - don't block MCP startup
  }
}

async function runMCP(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // CEDA-82: Verify trust with CEDA server before announcing
  // This may upgrade trust if user is registered
  await verifyWithCeda();

  console.error(`Herald MCP v${VERSION} running`);
  console.error(`User: ${HERALD_USER} | Tags: [${HERALD_TAGS.join(", ")}]`);
  console.error(`Trust: ${TRUST_LEVEL} (${CONTEXT_SOURCE})${PROPAGATES ? " | Propagates: YES" : ""}`);
  if (VERIFIED_CONTEXT?.verified) {
    console.error(`Context: ${VERIFIED_CONTEXT.org}/${VERIFIED_CONTEXT.project} (server-verified)`);
  }

  // CEDA-100: Version check - inform user if update available
  checkForUpdates();

  // Send startup heartbeat for visibility (non-blocking)
  sendStartupHeartbeat();

  // Auto-sync buffered insights on startup
  await autoSyncBuffer();
}

// ============================================
// ENTRY POINT - Detect mode
// ============================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // If we have CLI arguments, run CLI mode
  if (args.length > 0) {
    await runCLI(args);
    return;
  }

  // If stdout is a TTY (human at terminal), show help
  // Using stdout because npx may not have stdin as TTY
  if (process.stdout.isTTY) {
    printUsage();
    return;
  }

  // Otherwise, run MCP server (AI agent calling via pipe)
  await runMCP();
}

main().catch(console.error);
