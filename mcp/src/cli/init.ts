#!/usr/bin/env node
/**
 * Herald MCP Init CLI
 * 
 * Creates .claude/settings.json with Herald MCP configuration
 * and updates CLAUDE.md with Herald integration instructions.
 * 
 * Usage: npx @spilno/herald-mcp init [options]
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { updateClaudeMdContent, fetchLearnedPatterns, type HeraldContext } from "./templates/claude-md.js";
import { getHookifyRulesContent } from "./templates/hookify-rules.js";
import { deriveUser } from "../shared/git-utils.js";

function buildHeraldConfig() {
  // CEDA-105: Pure git derivation - no HERALD_* env vars needed
  // org/project/user all derived from git remote and git config
  // Auth: Global token from ~/.herald/token.json (via `herald login`)
  return {
    mcpServers: {
      herald: {
        command: "npx",
        args: ["@spilno/herald-mcp@latest"],
        env: {
          CEDA_URL: "https://getceda.com"
          // No CEDA_TOKEN needed here - uses global ~/.herald/token.json
        }
      }
    }
  };
}

function printInitHelp(): void {
  console.log(`
Herald MCP Init - One command setup for CEDA pattern learning

Usage:
  cd your-project
  herald-mcp init

Context (org/project/user) is derived from git automatically.

Options:
  --sync, -s          Sync patterns to CLAUDE.md (quick update, no full init)
  --hookify           Generate hookify rules for auto pattern reminders
  --force, -f         Overwrite existing config
  --no-claude-md      Skip CLAUDE.md modification
  --help, -h          Show this help

Examples:
  herald-mcp init                    # Basic setup
  herald-mcp init --sync             # Just sync patterns
  herald-mcp init --hookify          # Add auto-reminders

After init:
  1. Add CEDA_TOKEN from getceda.com to .mcp.json
  2. Start Claude Code
  3. Say "herald health" to verify
`);
}

export interface InitOptions {
  force?: boolean;
  help?: boolean;
  org?: string;
  project?: string;
  user?: string;
  noClaudeMd?: boolean;
  sync?: boolean;  // Just sync patterns to CLAUDE.md
  hookify?: boolean;  // Generate hookify rules
}

export function parseInitArgs(args: string[]): InitOptions {
  const options: InitOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--force" || arg === "-f") {
      options.force = true;
    } else if (arg === "--org" || arg === "-c") {
      options.org = args[++i];
    } else if (arg === "--project" || arg === "-p") {
      options.project = args[++i];
    } else if (arg === "--user" || arg === "-u") {
      options.user = args[++i];
    } else if (arg === "--no-claude-md") {
      options.noClaudeMd = true;
    } else if (arg === "--sync" || arg === "-s") {
      options.sync = true;
    } else if (arg === "--hookify") {
      options.hookify = true;
    }
  }

  return options;
}

async function runSyncPatterns(cwd: string, claudeMdPath: string, options: InitOptions): Promise<void> {
  const projectName = basename(cwd);
  const mcpJsonPath = join(cwd, ".mcp.json");

  // Try to get context from .mcp.json, fall back to folder name
  let org = options.org || projectName;
  let project = options.project || projectName;
  let user = options.user || deriveUser();

  if (existsSync(mcpJsonPath)) {
    try {
      const mcpConfig = JSON.parse(readFileSync(mcpJsonPath, "utf-8"));
      const heraldEnv = mcpConfig.mcpServers?.herald?.env || {};
      // Support both HERALD_ORG (new) and HERALD_ORG (legacy)
      org = options.org || heraldEnv.HERALD_ORG || heraldEnv.HERALD_ORG || projectName;
      project = options.project || heraldEnv.HERALD_PROJECT || projectName;
      user = options.user || heraldEnv.HERALD_USER || deriveUser();
    } catch { /* ignore */ }
  }

  const context: HeraldContext = { org, project, user };
  const cedaUrl = "https://getceda.com";

  console.log(`Syncing patterns for ${user}→${project}→${org}...`);
  const learnedPatterns = await fetchLearnedPatterns(cedaUrl, org, project, user);

  if (!learnedPatterns) {
    console.log("Failed to fetch patterns from CEDA");
    return;
  }

  const totalPatterns = learnedPatterns.patterns.length + learnedPatterns.antipatterns.length;
  console.log(`Found ${totalPatterns} patterns (${learnedPatterns.patterns.length} success, ${learnedPatterns.antipatterns.length} antipatterns)`);

  let existingClaudeMd: string | null = null;
  if (existsSync(claudeMdPath)) {
    existingClaudeMd = readFileSync(claudeMdPath, "utf-8");
  }

  const updatedClaudeMd = updateClaudeMdContent(existingClaudeMd, context, projectName, learnedPatterns);
  writeFileSync(claudeMdPath, updatedClaudeMd, "utf-8");

  console.log(`✓ CLAUDE.md updated with ${totalPatterns} patterns`);
  console.log(`\nPatterns are now baked into CLAUDE.md for offline access.`);
}

export async function runInit(args: string[] = []): Promise<void> {
  const options = parseInitArgs(args);

  if (options.help) {
    printInitHelp();
    return;
  }

  const cwd = process.cwd();
  const projectName = basename(cwd);
  const mcpJsonPath = join(cwd, ".mcp.json");
  const claudeMdPath = join(cwd, "CLAUDE.md");

  // Quick sync mode: just update CLAUDE.md with latest patterns
  if (options.sync) {
    return runSyncPatterns(cwd, claudeMdPath, options);
  }

  // Zero-config: derive from folder name, flags override
  const org = options.org || projectName;
  const project = options.project || projectName;

  const context: HeraldContext = {
    org,
    project,
    user: options.user || deriveUser(),
  };

  // Check for old herald configs and warn about migration
  const oldClaudeDir = join(cwd, ".claude");
  const oldSettingsPath = join(oldClaudeDir, "settings.local.json");
  if (existsSync(oldSettingsPath)) {
    try {
      const oldConfig = JSON.parse(readFileSync(oldSettingsPath, "utf-8"));
      if (oldConfig.mcpServers?.herald) {
        console.log("⚠️  Found old Herald config in .claude/settings.local.json");
        console.log("   This location is no longer supported. Migrating to .mcp.json");
      }
    } catch { /* ignore */ }
  }

  if (existsSync(mcpJsonPath) && !options.force) {
    console.log(`
.mcp.json already exists.

To view current config:
  cat .mcp.json

To overwrite:
  npx @spilno/herald-mcp init --force
`);
    return;
  }

  const heraldConfig = buildHeraldConfig();
  let finalConfig = heraldConfig;

  if (existsSync(mcpJsonPath)) {
    try {
      const existingContent = readFileSync(mcpJsonPath, "utf-8");
      const existingConfig = JSON.parse(existingContent);

      finalConfig = {
        ...existingConfig,
        mcpServers: {
          ...existingConfig.mcpServers,
          ...heraldConfig.mcpServers
        }
      };
      console.log("Merging with existing .mcp.json");
    } catch {
      console.log("Overwriting invalid .mcp.json");
    }
  }

  writeFileSync(mcpJsonPath, JSON.stringify(finalConfig, null, 2) + "\n", "utf-8");
  console.log("✓ Created .mcp.json");
  
  if (!options.noClaudeMd) {
    let existingClaudeMd: string | null = null;
    if (existsSync(claudeMdPath)) {
      existingClaudeMd = readFileSync(claudeMdPath, "utf-8");
    }

    // Fetch learned patterns from CEDA
    const cedaUrl = "https://getceda.com";
    console.log("Fetching learned patterns from CEDA...");
    const learnedPatterns = await fetchLearnedPatterns(cedaUrl, org, project);

    if (learnedPatterns) {
      const totalPatterns = learnedPatterns.patterns.length + learnedPatterns.antipatterns.length;
      if (totalPatterns > 0) {
        console.log(`✓ Found ${totalPatterns} patterns from past sessions`);
      }
    }

    const updatedClaudeMd = updateClaudeMdContent(existingClaudeMd, context, projectName, learnedPatterns || undefined);
    writeFileSync(claudeMdPath, updatedClaudeMd, "utf-8");

    if (existingClaudeMd) {
      console.log("Updated CLAUDE.md with Herald integration");
    } else {
      console.log("Created CLAUDE.md with Herald integration");
    }
  }

  // Generate hookify rules if requested
  if (options.hookify) {
    const claudeDir = join(cwd, ".claude");
    if (!existsSync(claudeDir)) {
      mkdirSync(claudeDir, { recursive: true });
    }

    const hookifyRules = getHookifyRulesContent();
    for (const rule of hookifyRules) {
      const rulePath = join(claudeDir, rule.filename);
      writeFileSync(rulePath, rule.content, "utf-8");
    }
    console.log(`✓ Created ${hookifyRules.length} hookify rules in .claude/`);
    console.log("  - Pattern check reminder on prompts");
    console.log("  - Pattern capture reminder on session end");
  }

  // Check if user is already logged in globally
  const globalTokenPath = join(homedir(), ".herald", "token.json");
  const hasGlobalToken = existsSync(globalTokenPath);

  if (hasGlobalToken) {
    console.log(`
✓ Herald configured

  Backend:  https://getceda.com
  Context:  Derived from git (org/project/user)
  Auth:     Using global token from ~/.herald/token.json ✓

Next steps:
  1. Start Claude Code in this directory
  2. Say "herald health" to verify

Capture patterns:
      Say "Herald reflect - that was smooth"
      Claude asks what worked → you answer → saved.
`);
  } else {
    console.log(`
✓ Herald configured

  Backend:  https://getceda.com
  Context:  Derived from git (org/project/user)

Next steps:
  1. Run: npx @spilno/herald-mcp login
     (One-time login - works for all your projects)
  2. Start Claude Code in this directory
  3. Say "herald health" to verify

Capture patterns:
      Say "Herald reflect - that was smooth"
      Claude asks what worked → you answer → saved.
`);
  }
}
