/**
 * Core handler logic for Herald MCP system, prediction, and gate tools.
 *
 * 10 tools: help, health, context, stats, gate, predict, refine, session,
 * feedback, context_status.
 */

import type {
  HandlerDeps,
  ToolResult,
  BufferedInsight,
  LoadedContext,
  TrustLevel,
  ContextUpdate,
} from "./types.js";
import { buildEngagementContext } from "../talk-to-data-handlers.js";

// ---------------------------------------------------------------------------
// Extended deps for core handlers
// ---------------------------------------------------------------------------

export interface CoreHandlerDeps extends HandlerDeps {
  version: string;
  cedaUrl: string;
  vault: string;
  vaultsPath: string;
  vaultsCloud: boolean;
  tags: string[];
  trustLevel: TrustLevel;
  contextSource: string;
  propagates: boolean;
  gitRemote: string;
  getBufferedInsights: () => BufferedInsight[];
  loadOrDeriveContext: () => LoadedContext;
  fs: {
    existsSync: (p: string) => boolean;
    readFileSync: (p: string, enc: string) => string;
  };
}

// ---------------------------------------------------------------------------
// herald_help
// ---------------------------------------------------------------------------

export function handleHelp(
  _args: Record<string, unknown>,
  deps: CoreHandlerDeps,
): ToolResult {
  const helpText = `# Herald MCP v${deps.version}

Welcome to Herald - your AI-native interface to CEDA (Cognitive Event-Driven Architecture).

## Current Context
- Org: ${deps.config.org}
- Project: ${deps.config.project}
- User: ${deps.config.user}

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
- \`herald_session_list\` - List sessions with filters (org, project, user, status)
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
- CEDA Backend: ${deps.cedaUrl || "not configured"}

## Tips
- Be specific in your requests - Herald learns from patterns
- Use refine to iterate on predictions
- Your feedback (accept/reject) improves CEDA for everyone
`;

  return { content: [{ type: "text", text: helpText }] };
}

// ---------------------------------------------------------------------------
// herald_health
// ---------------------------------------------------------------------------

export async function handleHealth(
  _args: Record<string, unknown>,
  deps: CoreHandlerDeps,
): Promise<ToolResult> {
  const cedaHealth = await deps.callCedaAPI("/health");
  const buffer = deps.getBufferedInsights();
  const cloudAvailable = !cedaHealth.error;

  const config = {
    cedaUrl: deps.cedaUrl,
    org: deps.config.org,
    project: deps.config.project,
    user: deps.config.user,
    vault: deps.vault || "(not set)",
    tags: deps.tags,
    trust: deps.trustLevel,
    source: deps.contextSource,
    propagates: deps.propagates,
    gitRemote: deps.gitRemote,
  };

  const warnings: string[] = [];
  if (deps.contextSource === "path") {
    warnings.push("Context derived from folder path (LOW trust)");
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
          version: deps.version,
          config,
          warnings: warnings.length > 0 ? warnings : undefined,
        },
        ceda: cedaHealth,
        buffer: {
          size: buffer.length,
          mode: cloudAvailable ? "cloud" : "local",
          hint: buffer.length > 0 ? "Use herald_sync to flush buffered insights" : undefined,
        },
      }, null, 2),
    }],
  };
}

// ---------------------------------------------------------------------------
// herald_context
// ---------------------------------------------------------------------------

export interface ContextResult {
  result: ToolResult;
  newContext?: ContextUpdate;
}

export function handleContext(
  args: Record<string, unknown>,
  deps: CoreHandlerDeps,
): ContextResult {
  const refresh = args?.refresh as boolean;

  if (refresh) {
    const newContext = deps.loadOrDeriveContext();

    const newOrg = newContext.tags[0] || "";
    const newProject = newContext.tags[1] || newContext.tags[0] || "";

    return {
      result: {
        content: [{
          type: "text",
          text: JSON.stringify({
            refreshed: true,
            context: {
              org: newOrg,
              project: newProject,
              user: newContext.user,
              tags: newContext.tags,
              trust: newContext.trust,
              source: newContext.source,
              propagates: newContext.propagates,
              gitRemote: newContext.gitRemote,
            },
            message: newContext.trust === "HIGH"
              ? `Context refreshed from git: ${newContext.gitRemote}`
              : `Context refreshed from ${newContext.source} (LOW trust)`,
          }, null, 2),
        }],
      },
      newContext: {
        user: newContext.user,
        tags: newContext.tags,
        org: newOrg,
        project: newProject,
        trustLevel: newContext.trust,
        contextSource: newContext.source,
        propagates: newContext.propagates,
        gitRemote: newContext.gitRemote || "",
      },
    };
  }

  return {
    result: {
      content: [{
        type: "text",
        text: JSON.stringify({
          context: {
            org: deps.config.org,
            project: deps.config.project,
            user: deps.config.user,
            tags: deps.tags,
            trust: deps.trustLevel,
            source: deps.contextSource,
            propagates: deps.propagates,
            gitRemote: deps.gitRemote,
          },
          hint: deps.trustLevel === "LOW"
            ? "Use herald_context(refresh=true) in a git repo for HIGH trust"
            : undefined,
        }, null, 2),
      }],
    },
  };
}

// ---------------------------------------------------------------------------
// herald_stats
// ---------------------------------------------------------------------------

export async function handleStats(
  _args: Record<string, unknown>,
  deps: CoreHandlerDeps,
): Promise<ToolResult> {
  const result = await deps.callCedaAPI("/api/stats");
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}

// ---------------------------------------------------------------------------
// herald_gate
// ---------------------------------------------------------------------------

export function handleGate(
  args: Record<string, unknown>,
  _deps: CoreHandlerDeps,
): ToolResult {
  const operation = args?.operation as string;
  const scope = args?.scope as string;
  const template = args?.template as string | undefined;
  const rationale = args?.rationale as string | undefined;

  const gateId = `gate-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  let gateRequest = `\n## Authorization Required\n\n`;
  gateRequest += `**Operation:** ${operation}\n`;
  gateRequest += `**Scope:** ${scope}\n`;
  if (template) gateRequest += `**Template:** Following \`${template}\` patterns\n`;
  if (rationale) gateRequest += `**Rationale:** ${rationale}\n`;
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
      }, null, 2),
    }],
  };
}

// ---------------------------------------------------------------------------
// herald_predict
// ---------------------------------------------------------------------------

export async function handlePredict(
  args: Record<string, unknown>,
  deps: CoreHandlerDeps,
): Promise<ToolResult> {
  const signal = args?.signal as string;
  const contextStr = args?.context as string | undefined;
  const sessionId = args?.session_id as string | undefined;
  const participant = args?.participant as string | undefined;
  const engagementCtx = args?.engagement_context as Record<string, unknown> | undefined;

  const context = buildEngagementContext(contextStr, engagementCtx);

  await deps.emitProgress(1, 3);
  const result = await deps.callCedaAPI("/api/predict", "POST", {
    input: signal,
    context,
    sessionId,
    participant,
    config: { enableAutoFix: true, maxAutoFixAttempts: 3 },
  });
  await deps.emitProgress(2, 3);

  const response = {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
  await deps.emitProgress(3, 3);
  return response;
}

// ---------------------------------------------------------------------------
// herald_refine
// ---------------------------------------------------------------------------

export async function handleRefine(
  args: Record<string, unknown>,
  deps: CoreHandlerDeps,
): Promise<ToolResult> {
  const sessionId = args?.session_id as string;
  const refinement = args?.refinement as string;
  const contextStr = args?.context as string | undefined;
  const participant = args?.participant as string | undefined;
  const engagementCtx = args?.engagement_context as Record<string, unknown> | undefined;

  const context = buildEngagementContext(contextStr, engagementCtx);

  await deps.emitProgress(1, 3);
  const result = await deps.callCedaAPI("/api/refine", "POST", {
    sessionId,
    refinement,
    context,
    participant,
  });
  await deps.emitProgress(2, 3);

  const response = {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
  await deps.emitProgress(3, 3);
  return response;
}

// ---------------------------------------------------------------------------
// herald_session
// ---------------------------------------------------------------------------

export async function handleSession(
  args: Record<string, unknown>,
  deps: CoreHandlerDeps,
): Promise<ToolResult> {
  const sessionId = args?.session_id as string;
  const result = await deps.callCedaAPI(`/api/session/${sessionId}`);
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}

// ---------------------------------------------------------------------------
// herald_feedback
// ---------------------------------------------------------------------------

export async function handleFeedback(
  args: Record<string, unknown>,
  deps: CoreHandlerDeps,
): Promise<ToolResult> {
  const sessionId = args?.session_id as string;
  const accepted = args?.accepted as boolean;
  const comment = args?.comment as string | undefined;

  const result = await deps.callCedaAPI("/api/feedback", "POST", {
    sessionId,
    accepted,
    comment,
  });

  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
}

// ---------------------------------------------------------------------------
// herald_context_status
// ---------------------------------------------------------------------------

export async function handleContextStatus(
  args: Record<string, unknown>,
  deps: CoreHandlerDeps,
): Promise<ToolResult> {
  const vault = args?.vault as string | undefined;

  if (deps.vaultsCloud) {
    const endpoint = vault ? `/api/herald/contexts?vault=${vault}` : "/api/herald/contexts";
    const result = await deps.callCedaAPI(endpoint);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }

  // Local mode - read from files
  const vaults = vault ? [vault] : ["spilno", "goprint", "disrupt"];
  const statuses: Record<string, unknown> = {};

  for (const v of vaults) {
    const { join } = await import("path");
    const statusPath = join(deps.vaultsPath, v, "_status.md");
    if (deps.fs.existsSync(statusPath)) {
      statuses[v] = deps.fs.readFileSync(statusPath, "utf-8");
    }
  }

  return { content: [{ type: "text", text: JSON.stringify(statuses, null, 2) }] };
}
