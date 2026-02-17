/**
 * Pattern learning handler logic for Herald MCP.
 *
 * 6 tools: reflect, patterns, simulate, session_reflections,
 * pattern_feedback, share_scoped.
 */

import type {
  HandlerDeps,
  ToolResult,
  BufferedInsight,
  SessionReflection,
  SessionReflectionsSummary,
  AIClient,
  ExtractedPattern,
  SanitizationPreview,
  TrustLevel,
} from "./types.js";

// ---------------------------------------------------------------------------
// Extended deps for pattern handlers
// ---------------------------------------------------------------------------

export interface PatternHandlerDeps extends HandlerDeps {
  vault: string;
  tags: string[];
  trustLevel: TrustLevel;
  propagates: boolean;
  sanitize: (text: string) => { sanitizedText: string };
  previewSanitization: (text: string) => SanitizationPreview;
  bufferInsight: (payload: Omit<BufferedInsight, "bufferedAt">) => void;
  addSessionReflection: (r: Omit<SessionReflection, "id" | "timestamp">) => SessionReflection;
  getSessionReflectionsSummary: () => SessionReflectionsSummary;
  getAIClient: () => AIClient | null;
  buildReflectionPrompt: (session: string, feeling: string, insight: string) => string;
  callAIForReflection: (client: AIClient, prompt: string) => Promise<ExtractedPattern>;
}

// ---------------------------------------------------------------------------
// herald_reflect
// ---------------------------------------------------------------------------

export async function handleReflect(
  args: Record<string, unknown>,
  deps: PatternHandlerDeps,
): Promise<ToolResult> {
  const session = args?.session as string;
  const feeling = args?.feeling as "stuck" | "success";
  const insight = args?.insight as string;
  const dryRun = args?.dry_run as boolean | undefined;

  // CEDA-65: Client-side sanitization preview (no network required)
  const sessionPreview = deps.previewSanitization(session);
  const insightPreview = deps.previewSanitization(insight);

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
        }, null, 2),
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
        }, null, 2),
      }],
    };
  }

  // Sanitize before transmission
  const sanitizedSession = sessionPreview.sanitized;
  const sanitizedInsight = insightPreview.sanitized;

  // CEDA-64: Track reflection locally for session summary
  deps.addSessionReflection({
    session,
    feeling,
    insight,
    method: "direct",
  });

  // Call CEDA's reflect endpoint with SANITIZED insight
  try {
    const result = await deps.callCedaAPI("/api/herald/reflect", "POST", {
      session: sanitizedSession,
      feeling,
      insight: sanitizedInsight,
      method: "direct",
      org: deps.config.org,
      project: deps.config.project,
      user: deps.config.user,
      vault: deps.vault || undefined,
    });

    if (result.error) {
      // CEDA-100: Mark as reflection type for proper sync routing
      deps.bufferInsight({
        insight: sanitizedInsight,
        session: sanitizedSession,
        feeling,
        method: "direct",
        type: "reflection",
        topic: feeling === "stuck" ? "antipattern" : "pattern",
        org: deps.config.org,
        project: deps.config.project,
        user: deps.config.user,
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
          }, null, 2),
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
            org: deps.config.org,
            project: deps.config.project,
            tags: deps.tags,
            trust: deps.trustLevel,
            propagates: deps.propagates,
          },
          ...result,
        }, null, 2),
      }],
    };
  } catch (_error) {
    // Network error - buffer locally (sanitized)
    deps.bufferInsight({
      insight: sanitizedInsight,
      session: sanitizedSession,
      feeling,
      method: "direct",
      type: "reflection",
      topic: feeling === "stuck" ? "antipattern" : "pattern",
      org: deps.config.org,
      project: deps.config.project,
      user: deps.config.user,
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
        }, null, 2),
      }],
    };
  }
}

// ---------------------------------------------------------------------------
// herald_patterns
// ---------------------------------------------------------------------------

export async function handlePatterns(
  _args: Record<string, unknown>,
  deps: PatternHandlerDeps,
): Promise<ToolResult> {
  try {
    type PatternEntry = { insight: string; signal?: string; reinforcement?: string; warning?: string; scope?: string };

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

    // Level-gated cascade: user sees own (any level), project sees level>=2, org sees level>=3
    const queries = [
      { scope: "user", url: `/api/herald/reflections?org=${deps.config.org}&project=${deps.config.project}&user=${deps.config.user}&limit=50` },
      { scope: "project", url: `/api/herald/reflections?org=${deps.config.org}&project=${deps.config.project}&minLevel=2&limit=50` },
      { scope: "org", url: `/api/herald/reflections?org=${deps.config.org}&minLevel=3&limit=50` },
    ];

    const patterns: PatternEntry[] = [];
    const antipatterns: PatternEntry[] = [];

    // Query each level, dedupe as we go (user patterns win over project, project over org)
    for (const { scope, url } of queries) {
      try {
        const result = await deps.callCedaAPI(url);
        const scopePatterns = (result.patterns as PatternEntry[]) || [];
        const scopeAntipatterns = (result.antipatterns as PatternEntry[]) || [];

        patterns.push(...dedupePatterns(scopePatterns, scope));
        antipatterns.push(...dedupePatterns(scopeAntipatterns, scope));
      } catch {
        // Continue if a level fails
      }
    }

    const metaResult = await deps.callCedaAPI("/api/herald/meta-patterns");
    const metaPatterns = (metaResult.metaPatterns as Array<{ recommendedMethod: string; confidence: number }>) || [];

    // Build readable summary with scope indicators
    let summary = `## Learned Patterns for ${deps.config.user}→${deps.config.project}→${deps.config.org}\n\n`;

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
      summary = `No patterns learned yet for ${deps.config.user}→${deps.config.project}→${deps.config.org}.\n\nCapture patterns with "herald reflect" or "herald simulate" when you notice friction or flow.`;
    }

    return { content: [{ type: "text", text: summary }] };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `Failed to query patterns: ${error}\n\nCEDA may be unavailable.`,
      }],
    };
  }
}

// ---------------------------------------------------------------------------
// herald_simulate
// ---------------------------------------------------------------------------

export async function handleSimulate(
  args: Record<string, unknown>,
  deps: PatternHandlerDeps,
): Promise<ToolResult> {
  const session = args?.session as string;
  const feeling = args?.feeling as "stuck" | "success";
  const insight = args?.insight as string;

  // CEDA-65: Client-side sanitization
  const simSessionPreview = deps.previewSanitization(session);
  const simInsightPreview = deps.previewSanitization(insight);

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
        }, null, 2),
      }],
      isError: true,
    };
  }

  const simSanitizedSession = simSessionPreview.sanitized;
  const simSanitizedInsight = simInsightPreview.sanitized;

  // CEDA-64: Track reflection locally for session summary
  deps.addSessionReflection({
    session,
    feeling,
    insight,
    method: "simulation",
  });

  // Check for AI API key
  const aiClient = deps.getAIClient();
  if (!aiClient) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: false,
          error: "No AI key configured",
          hint: "Add ANTHROPIC_API_KEY or OPENAI_API_KEY to env in .claude/settings.local.json",
          fallback: "Use herald_reflect for direct capture instead",
        }, null, 2),
      }],
    };
  }

  try {
    // Build prompt and call AI for reflection (use sanitized input)
    await deps.emitProgress(1, 4);
    const prompt = deps.buildReflectionPrompt(simSanitizedSession, feeling, simSanitizedInsight);
    const extracted = await deps.callAIForReflection(aiClient, prompt);
    await deps.emitProgress(2, 4);

    // Sanitize AI-extracted fields too
    const sanitizedSignal = deps.sanitize(extracted.signal || "").sanitizedText;
    const sanitizedReinforcement = extracted.reinforcement ? deps.sanitize(extracted.reinforcement).sanitizedText : undefined;
    const sanitizedWarning = extracted.warning ? deps.sanitize(extracted.warning).sanitizedText : undefined;
    await deps.emitProgress(3, 4);

    // Send enriched data to CEDA (all sanitized)
    const result = await deps.callCedaAPI("/api/herald/reflect", "POST", {
      session: simSanitizedSession,
      feeling,
      insight: simSanitizedInsight,
      method: "simulation",
      signal: sanitizedSignal,
      outcome: extracted.outcome,
      reinforcement: sanitizedReinforcement,
      warning: sanitizedWarning,
      org: deps.config.org,
      project: deps.config.project,
      user: deps.config.user,
      vault: deps.vault || undefined,
    });

    if (result.error) {
      // Cloud failed but we have AI extraction - buffer with enriched data
      deps.bufferInsight({
        insight: simSanitizedInsight,
        session: simSanitizedSession,
        feeling,
        method: "simulation",
        type: "reflection",
        topic: extracted.outcome,
        org: deps.config.org,
        project: deps.config.project,
        user: deps.config.user,
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
          }, null, 2),
        }],
      };
    }

    // Success - AI reflection sent to CEDA
    await deps.emitProgress(4, 4);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: true,
          mode: "cloud",
          method: "simulation",
          provider: aiClient.provider,
          message: extracted.outcome === "pattern"
            ? "Pattern extracted via AI reflection"
            : "Antipattern extracted via AI reflection",
          extracted: {
            signal: extracted.signal,
            outcome: extracted.outcome,
            reinforcement: extracted.reinforcement,
            warning: extracted.warning,
          },
          insight,
          ...result,
        }, null, 2),
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
        }, null, 2),
      }],
    };
  }
}

// ---------------------------------------------------------------------------
// herald_session_reflections
// ---------------------------------------------------------------------------

export function handleSessionReflections(
  _args: Record<string, unknown>,
  deps: PatternHandlerDeps,
): ToolResult {
  const summary = deps.getSessionReflectionsSummary();

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

  return { content: [{ type: "text", text: message }] };
}

// ---------------------------------------------------------------------------
// herald_pattern_feedback
// ---------------------------------------------------------------------------

export async function handlePatternFeedback(
  args: Record<string, unknown>,
  deps: PatternHandlerDeps,
): Promise<ToolResult> {
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
        }, null, 2),
      }],
      isError: true,
    };
  }

  try {
    const result = await deps.callCedaAPI("/api/herald/feedback", "POST", {
      patternId,
      patternText,
      outcome,
      helped: outcome === "helped",
      org: deps.config.org,
      project: deps.config.project,
      user: deps.config.user,
    });

    if (result.error) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: false,
            error: result.error,
            hint: "Pattern feedback could not be recorded. The pattern may not exist.",
          }, null, 2),
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
        }, null, 2),
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
        }, null, 2),
      }],
    };
  }
}

// ---------------------------------------------------------------------------
// herald_share_scoped
// ---------------------------------------------------------------------------

export async function handleShareScoped(
  args: Record<string, unknown>,
  deps: PatternHandlerDeps,
): Promise<ToolResult> {
  const insight = args?.insight as string;
  const scope = args?.scope as "parent" | "siblings" | "all";
  const topic = args?.topic as string | undefined;

  try {
    const result = await deps.callCedaAPI("/api/herald/share", "POST", {
      insight,
      scope,
      topic,
      sourceOrg: deps.config.org,
      sourceProject: deps.config.project,
      sourceUser: deps.config.user,
      sourceVault: deps.vault || undefined,
    });

    if (result.error) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: false,
            error: result.error,
            hint: "Insight could not be shared. Check scope and try again.",
          }, null, 2),
        }],
      };
    }

    const scopeDescription: Record<string, string> = {
      parent: "parent project/org",
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
        }, null, 2),
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
        }, null, 2),
      }],
    };
  }
}
