/**
 * #772: Talk-to-Data handler logic, extracted for testability.
 *
 * Each handler receives its I/O dependencies (network, filesystem)
 * so tests can swap them with mocks — no DB, no network.
 */
import { join } from "path";
import type { HandlerDeps, ToolContent, ToolResult } from "./handlers/types.js";

// Re-export for backward compatibility with existing tests/consumers
export type { HandlerDeps, ToolContent, ToolResult };

const DEFAULT_SEARCH_LIMIT = 5;
const DEFAULT_MODULE_VERSION = "1.0.0";

export interface ScaffoldFsDeps {
  existsSync: (p: string) => boolean;
  mkdirSync: (p: string, opts?: { recursive?: boolean }) => void;
  writeFileSync: (p: string, data: string) => void;
}

// ---------------------------------------------------------------------------
// Engagement context builder (shared by predict / refine / search_knowledge)
// ---------------------------------------------------------------------------

export function buildEngagementContext(
  contextStr?: string,
  engagementCtx?: Record<string, unknown>,
): Array<Record<string, unknown>> | undefined {
  const context: Array<Record<string, unknown>> = [];
  if (contextStr) context.push({ type: "user_context", value: contextStr, source: "herald" });
  if (engagementCtx) context.push({ type: "engagement_context", value: JSON.stringify(engagementCtx), source: "emex" });
  return context.length > 0 ? context : undefined;
}

// ---------------------------------------------------------------------------
// herald_query_analytics
// ---------------------------------------------------------------------------

export async function handleQueryAnalytics(
  args: Record<string, unknown>,
  deps: HandlerDeps,
): Promise<ToolResult> {
  const category = args.category as string;
  const period = args.period as string | undefined;
  const org = (args.org as string) || deps.config.org;
  const includeViz = args.include_visualization as boolean | undefined;

  const params = new URLSearchParams();
  if (period) params.set("period", period);
  params.set("org", org);
  if (includeViz) params.set("include_visualization", "true");

  const endpoint = `/api/analytics/${category}${params.toString() ? "?" + params.toString() : ""}`;
  const result = await deps.callCedaAPI(endpoint);

  const content: ToolContent = [
    { type: "text", text: JSON.stringify(result, null, 2) },
  ];

  if (includeViz && result && typeof result === "object" && "visualization" in (result as Record<string, unknown>)) {
    const viz = (result as Record<string, unknown>).visualization as { data: string; mimeType: string } | undefined;
    if (viz?.data) {
      content.push({ type: "image", data: viz.data, mimeType: viz.mimeType || "image/png" });
    }
  }

  return { content };
}

// ---------------------------------------------------------------------------
// herald_query_reflections
// ---------------------------------------------------------------------------

export async function handleQueryReflections(
  args: Record<string, unknown>,
  deps: HandlerDeps,
): Promise<ToolResult> {
  const feeling = args.feeling as string | undefined;
  const project = args.project as string | undefined;
  const limit = args.limit as number | undefined;

  const params = new URLSearchParams();
  params.set("org", deps.config.org);
  if (feeling) params.set("feeling", feeling);
  if (project) params.set("project", project);
  if (limit) params.set("limit", String(limit));

  const result = await deps.callCedaAPI(`/api/herald/reflections?${params.toString()}`);
  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
}

// ---------------------------------------------------------------------------
// herald_search_knowledge
// ---------------------------------------------------------------------------

export async function handleSearchKnowledge(
  args: Record<string, unknown>,
  deps: HandlerDeps,
): Promise<ToolResult> {
  const query = args.query as string;
  const limit = (args.limit as number) || DEFAULT_SEARCH_LIMIT;
  const org = (args.org as string) || deps.config.org;
  const engagementCtx = args.engagement_context as Record<string, unknown> | undefined;

  const result = await deps.callCedaAPI("/api/documents/search", "POST", {
    query,
    org,
    user: "herald",
    type: "knowledge",
    limit,
    engagement_context: engagementCtx,
  });

  return {
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
}

// ---------------------------------------------------------------------------
// herald_scaffold_module
// ---------------------------------------------------------------------------

export function handleScaffoldModule(
  args: Record<string, unknown>,
  fs: ScaffoldFsDeps,
  moduleRoot: string,
): ToolResult {
  const moduleName = args.module_name as string;
  const displayName = args.display_name as string;
  const description = (args.description as string) || displayName;
  const entities = (args.entities as Array<{ name: string; fields?: Array<{ name: string; type: string; required?: boolean }> }>) || [];

  const moduleDir = join(moduleRoot, "modules", moduleName);
  const srcDir = join(moduleDir, "src");
  const filesDir = join(srcDir, "files");
  const configDir = join(filesDir, "config");

  try {
    if (!fs.existsSync(moduleDir)) fs.mkdirSync(moduleDir, { recursive: true });
    if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir, { recursive: true });
    if (!fs.existsSync(filesDir)) fs.mkdirSync(filesDir, { recursive: true });
    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });

    // Generate module.yml
    const moduleYml = `name: ${displayName}\nversion: ${DEFAULT_MODULE_VERSION}\ndescription: ${description}\nentities: ${JSON.stringify(entities.map(e => e.name))}`;
    fs.writeFileSync(join(configDir, "module.yml"), moduleYml);

    // Generate seed.ts
    const seedTs = `
import { createFileUtils, createModuleEntryPoint } from '@disrupt/module-installer';
import type { PrismaClient } from 'emex-prisma';

export async function seed(prisma: PrismaClient): Promise<void> {
  const fileUtils = createFileUtils({
    modulePath: 'modules/${moduleName}'
  });

  const config = await fileUtils.readYmlFile('config/module.yml');
  console.log(\`Seeding module: \${config.name}\`);

  // Auto-generated entity seeding placeholders
  ${entities.map(entity => `
  // Seed ${entity.name}
  // await prisma.${entity.name.toLowerCase()}.create({ data: { ... } });`).join("\n")}

  console.log('${displayName} seeded successfully');
}

createModuleEntryPoint(seed, {
  modulePath: 'modules/${moduleName}'
});
`;
    fs.writeFileSync(join(srcDir, "seed.ts"), seedTs.trim());

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: true,
          message: `Module ${moduleName} scaffolded successfully`,
          path: moduleDir,
        }, null, 2),
      }],
    };
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          success: false,
          error: `Failed to scaffold module: ${error}`,
        }, null, 2),
      }],
    };
  }
}
