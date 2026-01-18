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
import { updateClaudeMdContent, fetchLearnedPatterns, type HeraldContext } from "./templates/claude-md.js";
import { getHookifyRulesContent } from "./templates/hookify-rules.js";

function buildHeraldConfig(company: string, project: string) {
  return {
    mcpServers: {
      herald: {
        command: "npx",
        args: ["@spilno/herald-mcp@latest"],
        env: {
          CEDA_URL: "https://getceda.com",
          HERALD_COMPANY: company,
          HERALD_PROJECT: project
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
  npx @spilno/herald-mcp@latest init

That's it. Company and project default to folder name.

Options:
  --sync, -s          Sync patterns to CLAUDE.md (quick update, no full init)
  --hookify           Generate hookify rules for auto pattern reminders
  --company, -c       Override company (default: folder name)
  --project, -p       Override project (default: folder name)
  --user, -u          Override user (default: "default")
  --force, -f         Overwrite existing config
  --no-claude-md      Skip CLAUDE.md modification
  --help, -h          Show this help

Examples:
  npx @spilno/herald-mcp@latest init
  npx @spilno/herald-mcp@latest init --sync          # Just sync patterns
  npx @spilno/herald-mcp@latest init --hookify       # Add auto-reminders
  npx @spilno/herald-mcp@latest init --company goprint

Then start Claude Code and say "herald health" to verify.
`);
}

export interface InitOptions {
  force?: boolean;
  help?: boolean;
  company?: string;
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
    } else if (arg === "--company" || arg === "-c") {
      options.company = args[++i];
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
  let company = options.company || projectName;
  let project = options.project || projectName;
  let user = options.user || "default";

  if (existsSync(mcpJsonPath)) {
    try {
      const mcpConfig = JSON.parse(readFileSync(mcpJsonPath, "utf-8"));
      const heraldEnv = mcpConfig.mcpServers?.herald?.env || {};
      company = options.company || heraldEnv.HERALD_COMPANY || projectName;
      project = options.project || heraldEnv.HERALD_PROJECT || projectName;
      user = options.user || heraldEnv.HERALD_USER || "default";
    } catch { /* ignore */ }
  }

  const context: HeraldContext = { company, project, user };
  const cedaUrl = "https://getceda.com";

  console.log(`Syncing patterns for ${user}→${project}→${company}...`);
  const learnedPatterns = await fetchLearnedPatterns(cedaUrl, company, project, user);

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
  const company = options.company || projectName;
  const project = options.project || projectName;

  const context: HeraldContext = {
    company,
    project,
    user: options.user || "default",
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

  const heraldConfig = buildHeraldConfig(company, project);
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
    const learnedPatterns = await fetchLearnedPatterns(cedaUrl, company, project);

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

  console.log(`
✓ Herald configured

  Company:  ${company}
  Project:  ${project}
  Backend:  https://getceda.com

Next: Start Claude Code in this directory.
      Say "herald health" to verify.

Capture patterns:
      Say "Herald reflect - that was smooth"
      Claude asks what worked → you answer → saved.
`);
}
