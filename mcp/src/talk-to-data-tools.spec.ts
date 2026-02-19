/**
 * #772: Unit tests for Talk-to-Data integration tools
 *
 * Real services with mocked I/O boundaries (no DB, no network).
 * Tests: buildEngagementContext, handleQueryAnalytics, handleQueryReflections,
 *        handleSearchKnowledge, handleScaffoldModule
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import {
  buildEngagementContext,
  handleQueryAnalytics,
  handleQueryReflections,
  handleSearchKnowledge,
  handleScaffoldModule,
  type HandlerDeps,
  type ScaffoldFsDeps,
} from "./talk-to-data-handlers.js";

// ---------------------------------------------------------------------------
// Shared mock factory
// ---------------------------------------------------------------------------

type MockedCallCedaAPI = jest.MockedFunction<HandlerDeps["callCedaAPI"]>;
const apiMock = (deps: HandlerDeps) => deps.callCedaAPI as MockedCallCedaAPI;

function makeDeps(overrides?: Partial<HandlerDeps>): HandlerDeps {
  return {
    callCedaAPI: jest.fn<HandlerDeps["callCedaAPI"]>().mockResolvedValue({ success: true }),
    emitProgress: jest.fn<HandlerDeps["emitProgress"]>().mockResolvedValue(undefined),
    config: { org: "test-org", project: "test-proj", user: "test-user" },
    ...overrides,
  };
}

function makeFsDeps(): { fs: ScaffoldFsDeps; written: Map<string, string>; dirs: string[] } {
  const written = new Map<string, string>();
  const dirs: string[] = [];
  return {
    written,
    dirs,
    fs: {
      existsSync: jest.fn<ScaffoldFsDeps["existsSync"]>().mockReturnValue(false),
      mkdirSync: jest.fn<ScaffoldFsDeps["mkdirSync"]>().mockImplementation((p: string) => { dirs.push(p); }),
      writeFileSync: jest.fn<ScaffoldFsDeps["writeFileSync"]>().mockImplementation((p: string, data: string) => { written.set(p, data); }),
    },
  };
}

// ---------------------------------------------------------------------------
// buildEngagementContext
// ---------------------------------------------------------------------------

describe("buildEngagementContext", () => {
  it("should return undefined when no context provided", () => {
    expect(buildEngagementContext()).toBeUndefined();
  });

  it("should return user_context when only contextStr provided", () => {
    const result = buildEngagementContext("deployment notes");
    expect(result).toEqual([
      { type: "user_context", value: "deployment notes", source: "herald" },
    ]);
  });

  it("should return engagement_context when only engagementCtx provided", () => {
    const ctx = { preference: "dark-mode" };
    const result = buildEngagementContext(undefined, ctx);
    expect(result).toEqual([
      { type: "engagement_context", value: JSON.stringify(ctx), source: "emex" },
    ]);
  });

  it("should return both contexts when both provided", () => {
    const ctx = { lang: "uk" };
    const result = buildEngagementContext("user note", ctx);
    expect(result).toHaveLength(2);
    expect(result![0]).toEqual({ type: "user_context", value: "user note", source: "herald" });
    expect(result![1]).toEqual({ type: "engagement_context", value: JSON.stringify(ctx), source: "emex" });
  });
});

// ---------------------------------------------------------------------------
// handleQueryAnalytics
// ---------------------------------------------------------------------------

describe("handleQueryAnalytics", () => {
  let deps: HandlerDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  it("should call /api/analytics/{category} with org param", async () => {
    await handleQueryAnalytics({ category: "metrics" }, deps);

    expect(deps.callCedaAPI).toHaveBeenCalledTimes(1);
    const endpoint = apiMock(deps).mock.calls[0][0] as string;
    expect(endpoint).toContain("/api/analytics/metrics");
    expect(endpoint).toContain("org=test-org");
  });

  it("should include period in URL params when provided", async () => {
    await handleQueryAnalytics({ category: "trends", period: "week" }, deps);

    const endpoint = apiMock(deps).mock.calls[0][0] as string;
    expect(endpoint).toContain("period=week");
  });

  it("should use override org when provided", async () => {
    await handleQueryAnalytics({ category: "users", org: "custom-org" }, deps);

    const endpoint = apiMock(deps).mock.calls[0][0] as string;
    expect(endpoint).toContain("org=custom-org");
    expect(endpoint).not.toContain("org=test-org");
  });

  it("should include include_visualization param when true", async () => {
    await handleQueryAnalytics({ category: "metrics", include_visualization: true }, deps);

    const endpoint = apiMock(deps).mock.calls[0][0] as string;
    expect(endpoint).toContain("include_visualization=true");
  });

  it("should return text content with JSON result", async () => {
    apiMock(deps).mockResolvedValue({ total: 42 });
    const result = await handleQueryAnalytics({ category: "metrics" }, deps);

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(JSON.parse(result.content[0].text!)).toEqual({ total: 42 });
  });

  it("should append image content when visualization is present and requested", async () => {
    apiMock(deps).mockResolvedValue({
      total: 42,
      visualization: { data: "base64png", mimeType: "image/png" },
    });

    const result = await handleQueryAnalytics(
      { category: "trends", include_visualization: true },
      deps,
    );

    expect(result.content).toHaveLength(2);
    expect(result.content[1]).toEqual({ type: "image", data: "base64png", mimeType: "image/png" });
  });

  it("should default visualization mimeType to image/png", async () => {
    apiMock(deps).mockResolvedValue({
      visualization: { data: "abc" },
    });

    const result = await handleQueryAnalytics(
      { category: "trends", include_visualization: true },
      deps,
    );

    expect(result.content[1].mimeType).toBe("image/png");
  });

  it("should NOT append image when include_visualization is false", async () => {
    apiMock(deps).mockResolvedValue({
      visualization: { data: "base64png", mimeType: "image/png" },
    });

    const result = await handleQueryAnalytics({ category: "trends" }, deps);
    expect(result.content).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// handleQueryReflections
// ---------------------------------------------------------------------------

describe("handleQueryReflections", () => {
  let deps: HandlerDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  it("should call /api/herald/reflections with org param", async () => {
    await handleQueryReflections({}, deps);

    const endpoint = apiMock(deps).mock.calls[0][0] as string;
    expect(endpoint).toContain("/api/herald/reflections");
    expect(endpoint).toContain("org=test-org");
  });

  it("should include feeling filter when provided", async () => {
    await handleQueryReflections({ feeling: "stuck" }, deps);

    const endpoint = apiMock(deps).mock.calls[0][0] as string;
    expect(endpoint).toContain("feeling=stuck");
  });

  it("should include project filter when provided", async () => {
    await handleQueryReflections({ project: "backend" }, deps);

    const endpoint = apiMock(deps).mock.calls[0][0] as string;
    expect(endpoint).toContain("project=backend");
  });

  it("should include limit when provided", async () => {
    await handleQueryReflections({ limit: 10 }, deps);

    const endpoint = apiMock(deps).mock.calls[0][0] as string;
    expect(endpoint).toContain("limit=10");
  });

  it("should combine multiple filters", async () => {
    await handleQueryReflections({ feeling: "success", project: "api", limit: 5 }, deps);

    const endpoint = apiMock(deps).mock.calls[0][0] as string;
    expect(endpoint).toContain("feeling=success");
    expect(endpoint).toContain("project=api");
    expect(endpoint).toContain("limit=5");
  });

  it("should return text content with JSON result", async () => {
    apiMock(deps).mockResolvedValue({ patterns: ["a"], antipatterns: [] });
    const result = await handleQueryReflections({}, deps);

    expect(result.content[0].type).toBe("text");
    expect(JSON.parse(result.content[0].text!).patterns).toEqual(["a"]);
  });
});

// ---------------------------------------------------------------------------
// handleSearchKnowledge
// ---------------------------------------------------------------------------

describe("handleSearchKnowledge", () => {
  let deps: HandlerDeps;

  beforeEach(() => {
    deps = makeDeps();
  });

  it("should POST to /api/documents/search", async () => {
    await handleSearchKnowledge({ query: "onboarding docs" }, deps);

    expect(deps.callCedaAPI).toHaveBeenCalledWith(
      "/api/documents/search",
      "POST",
      expect.objectContaining({ query: "onboarding docs" }),
    );
  });

  it("should send method=POST (not an object with method key)", async () => {
    await handleSearchKnowledge({ query: "test" }, deps);

    const callArgs = apiMock(deps).mock.calls[0];
    expect(callArgs[1]).toBe("POST");
  });

  it("should default limit to 5", async () => {
    await handleSearchKnowledge({ query: "test" }, deps);

    const body = apiMock(deps).mock.calls[0][2] as Record<string, unknown>;
    expect(body.limit).toBe(5);
  });

  it("should use provided limit", async () => {
    await handleSearchKnowledge({ query: "test", limit: 20 }, deps);

    const body = apiMock(deps).mock.calls[0][2] as Record<string, unknown>;
    expect(body.limit).toBe(20);
  });

  it("should use config org by default", async () => {
    await handleSearchKnowledge({ query: "test" }, deps);

    const body = apiMock(deps).mock.calls[0][2] as Record<string, unknown>;
    expect(body.org).toBe("test-org");
  });

  it("should use override org when provided", async () => {
    await handleSearchKnowledge({ query: "test", org: "other-org" }, deps);

    const body = apiMock(deps).mock.calls[0][2] as Record<string, unknown>;
    expect(body.org).toBe("other-org");
  });

  it("should always send user=herald and type=knowledge", async () => {
    await handleSearchKnowledge({ query: "test" }, deps);

    const body = apiMock(deps).mock.calls[0][2] as Record<string, unknown>;
    expect(body.user).toBe("herald");
    expect(body.type).toBe("knowledge");
  });

  it("should pass engagement_context when provided", async () => {
    const ctx = { preference: "concise" };
    await handleSearchKnowledge({ query: "test", engagement_context: ctx }, deps);

    const body = apiMock(deps).mock.calls[0][2] as Record<string, unknown>;
    expect(body.engagement_context).toEqual(ctx);
  });

  it("should not include engagement_context key when not provided", async () => {
    await handleSearchKnowledge({ query: "test" }, deps);

    const body = apiMock(deps).mock.calls[0][2] as Record<string, unknown>;
    expect(body.engagement_context).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// handleScaffoldModule
// ---------------------------------------------------------------------------

describe("handleScaffoldModule", () => {
  it("should create 4 directories recursively", () => {
    const { fs, dirs } = makeFsDeps();

    handleScaffoldModule(
      { module_name: "visitor", display_name: "Visitor Mgmt", entities: [] },
      fs,
      "/root/emex",
    );

    expect(dirs).toHaveLength(4);
    expect(dirs[0]).toContain("modules");
    expect(dirs[0]).toContain("visitor");
  });

  it("should skip mkdir when directory already exists", () => {
    const { fs } = makeFsDeps();
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    handleScaffoldModule(
      { module_name: "vm", display_name: "VM", entities: [] },
      fs,
      "/root/emex",
    );

    expect(fs.mkdirSync).not.toHaveBeenCalled();
  });

  it("should write module.yml with correct content", () => {
    const { fs, written } = makeFsDeps();

    handleScaffoldModule(
      {
        module_name: "visitor",
        display_name: "Visitor Management",
        description: "Manages visitors",
        entities: [{ name: "Visit" }, { name: "Guest" }],
      },
      fs,
      "/root/emex",
    );

    // Find the module.yml write
    const ymlPath = Array.from(written.keys()).find(k => k.endsWith("module.yml"));
    expect(ymlPath).toBeDefined();

    const yml = written.get(ymlPath!)!;
    expect(yml).toContain("name: Visitor Management");
    expect(yml).toContain("version: 1.0.0");
    expect(yml).toContain("description: Manages visitors");
    expect(yml).toContain(JSON.stringify(["Visit", "Guest"]));
  });

  it("should use display_name as description fallback", () => {
    const { fs, written } = makeFsDeps();

    handleScaffoldModule(
      { module_name: "vm", display_name: "VM Module", entities: [] },
      fs,
      "/root/emex",
    );

    const ymlPath = Array.from(written.keys()).find(k => k.endsWith("module.yml"));
    const yml = written.get(ymlPath!)!;
    expect(yml).toContain("description: VM Module");
  });

  it("should write seed.ts with entity placeholders", () => {
    const { fs, written } = makeFsDeps();

    handleScaffoldModule(
      {
        module_name: "visitor",
        display_name: "Visitor",
        entities: [{ name: "Visit" }],
      },
      fs,
      "/root/emex",
    );

    const seedPath = Array.from(written.keys()).find(k => k.endsWith("seed.ts"));
    expect(seedPath).toBeDefined();

    const seed = written.get(seedPath!)!;
    expect(seed).toContain("modules/visitor");
    expect(seed).toContain("Seed Visit");
    expect(seed).toContain("prisma.visit.create");
    expect(seed).toContain("createModuleEntryPoint");
  });

  it("should return success result with module path", () => {
    const { fs } = makeFsDeps();

    const result = handleScaffoldModule(
      { module_name: "visitor", display_name: "Visitor", entities: [] },
      fs,
      "/root/emex",
    );

    const body = JSON.parse(result.content[0].text!);
    expect(body.success).toBe(true);
    expect(body.message).toContain("visitor");
    expect(body.path).toContain("visitor");
  });

  it("should return error result when fs throws", () => {
    const { fs } = makeFsDeps();
    (fs.mkdirSync as jest.Mock).mockImplementation(() => { throw new Error("EACCES"); });

    const result = handleScaffoldModule(
      { module_name: "fail", display_name: "Fail", entities: [] },
      fs,
      "/root/emex",
    );

    const body = JSON.parse(result.content[0].text!);
    expect(body.success).toBe(false);
    expect(body.error).toContain("EACCES");
  });
});
