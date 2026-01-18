# @spilno/herald-mcp

> AI-native interface to [CEDA](https://getceda.com) — pattern memory for AI agents.

Herald bridges AI agents and CEDA's cognitive pattern memory. Your AI remembers what worked.

## Why Herald?

AI agents start fresh each session. Herald gives them memory:

| Without Herald | With Herald |
|----------------|-------------|
| AI forgets past sessions | Patterns persist across sessions |
| Same mistakes repeated | Antipatterns prevent failures |
| Generic responses | Context-aware predictions |
| No learning curve | Knowledge compounds |

## SDK Usage

```bash
npm i @spilno/herald-mcp
```

```typescript
import { herald } from '@spilno/herald-mcp';

herald.learned('What worked');
herald.gotStuck('What failed');
```

## Quick Start

### MCP Server (for AI agents like Claude)

```bash
cd your-project
npx @spilno/herald-mcp init
```

### SDK (for programmatic access)

```typescript
import { herald } from '@spilno/herald-mcp';

// Capture a pattern (something that worked)
await herald.learned('Always run tests before committing');

// Capture an antipattern (something that failed)
await herald.gotStuck('Forgot to check existing tests before refactoring');

// Query patterns
const patterns = await herald.recall();

// Configure (optional - uses git context by default)
herald.configure({ baseUrl: 'https://custom.ceda.com', token: 'your-token' });
```

**What this does:**
1. Creates `.mcp.json` with Herald MCP configuration
2. Fetches learned patterns from CEDA (if any exist)
3. Creates/updates `CLAUDE.md` with patterns baked in

Company and project default to your folder name. Zero config.

## Interactive Chat

For humans who want to capture patterns directly from the terminal:

```bash
npx @spilno/herald-mcp chat
```

```
Herald Pattern Journal

Commands:
  /learned <insight>  - capture what worked
  /stuck <insight>    - capture what failed
  /recall [topic]     - see your patterns
  /quit               - exit

> /learned Error boundaries prevent silent failures
Pattern captured

> /stuck Forgot to await in test setup
Antipattern captured

> /recall testing
Patterns:
  - Error boundaries prevent silent failures
Antipatterns:
  - Forgot to await in test setup

> /quit
Bye! Your patterns are saved.
```

No AI key needed. Just pattern capture and recall.

## Init Options

```bash
npx @spilno/herald-mcp init [options]
```

| Option | Description |
|--------|-------------|
| `--sync`, `-s` | Just sync patterns to CLAUDE.md (quick update) |
| `--hookify` | Generate hookify rules for auto pattern reminders |
| `--company`, `-c` | Override company (default: folder name) |
| `--project`, `-p` | Override project (default: folder name) |
| `--user`, `-u` | Override user (default: "default") |
| `--force`, `-f` | Overwrite existing config |
| `--help`, `-h` | Show help |

**Examples:**
```bash
# Basic setup (zero config)
npx @spilno/herald-mcp init

# Sync latest patterns to CLAUDE.md
npx @spilno/herald-mcp init --sync

# Add auto-reminder hooks
npx @spilno/herald-mcp init --hookify

# Custom context
npx @spilno/herald-mcp init --company acme --project safety
```

## Pattern Inheritance

Patterns cascade from specific to broad:

```
user (your personal patterns)
  ↓ inherits from
project (team patterns)
  ↓ inherits from
company (org-wide patterns)
```

More specific patterns take precedence. If you have a pattern and your company has the same one, yours wins.

## MCP Resources

Herald exposes patterns as MCP resources (auto-readable by Claude Code):

| Resource | Description |
|----------|-------------|
| `herald://patterns` | Learned patterns for current context |
| `herald://context` | Current configuration (company/project/user) |

## Core Tools

| Tool | Purpose |
|------|---------|
| `herald_patterns` | Query what worked before (with inheritance) |
| `herald_reflect` | Capture patterns and antipatterns |
| `herald_predict` | Generate structure from natural language |
| `herald_refine` | Refine predictions with feedback |
| `herald_feedback` | Reinforce helpful patterns |

### Pattern Capture

When something works or fails, capture it:

```
User: "Herald reflect - that was smooth"
Claude: "What specifically worked?"
User: "The ASCII visualization approach"
→ Pattern captured, available in future sessions
```

```
User: "Herald reflect - that was rough"
Claude: "What went wrong?"
User: "Forgot to check existing tests before refactoring"
→ Antipattern captured, Claude will avoid this
```

## Hookify Integration

Add auto-reminders with `--hookify`:

```bash
npx @spilno/herald-mcp init --hookify
```

This creates rules in `.claude/` that:
- **On prompt**: Remind to check patterns at session start
- **On session end**: Remind to capture patterns before leaving

Requires [hookify plugin](https://github.com/anthropics/claude-code/tree/main/plugins/hookify).

## Configuration

### Files Created

| File | Purpose |
|------|---------|
| `.mcp.json` | MCP server configuration for Claude Code |
| `CLAUDE.md` | Project instructions with baked patterns |
| `.claude/hookify.*.local.md` | Auto-reminder rules (if --hookify) |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CEDA_URL` | https://getceda.com | CEDA backend URL |
| `HERALD_COMPANY` | folder name | Company context |
| `HERALD_PROJECT` | folder name | Project context |
| `HERALD_USER` | "default" | User context |

## How It Works

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Claude    │────▶│   Herald    │────▶│    CEDA     │
│   Code      │     │   (MCP)     │     │  (Pattern   │
│             │◀────│             │◀────│   Memory)   │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │
       │            ┌──────┴──────┐
       │            │ Patterns    │
       └───────────▶│ Antipatterns│
    (auto-reads     │ Inheritance │
     resources)     └─────────────┘
```

1. **Session Start**: Claude reads `herald://patterns` resource
2. **During Work**: Patterns guide behavior
3. **Session End**: Capture new patterns with `herald_reflect`
4. **Next Session**: New patterns available automatically

## What is CEDA?

CEDA (Cognitive Event-Driven Architecture) is pattern memory for AI:

- **Patterns**: Approaches that worked (weighted by effectiveness)
- **Antipatterns**: Approaches that failed (avoided in predictions)
- **Feedback loop**: Patterns strengthen or decay based on outcomes

Unlike RAG (retrieves content), CEDA retrieves **what worked**.

## SDK API

The SDK provides programmatic access to CEDA pattern memory for use in your own applications.

### Installation

```bash
npm install @spilno/herald-mcp
```

### API Reference

#### `herald.learned(insight, context?)`

Capture a pattern (something that worked).

```typescript
await herald.learned('Always run tests before committing');
await herald.learned('Use feature flags for gradual rollouts', 'deployment pipeline');
```

#### `herald.gotStuck(insight, context?)`

Capture an antipattern (something that failed).

```typescript
await herald.gotStuck('Forgot to check existing tests before refactoring');
await herald.gotStuck('Deployed without running migrations', 'production incident');
```

#### `herald.recall(topic?)`

Query learned patterns and antipatterns.

```typescript
const patterns = await herald.recall();
const deployPatterns = await herald.recall('deployment');
```

Returns an array of `Pattern` objects:

```typescript
interface Pattern {
  insight: string;
  feeling: 'success' | 'stuck';
  signal?: string;
  reinforcement?: string;
  warning?: string;
  scope?: string;
}
```

#### `herald.configure(opts)`

Configure the SDK (optional - uses git context by default).

```typescript
herald.configure({
  baseUrl: 'https://custom.ceda.com',
  token: 'your-api-token',
  company: 'acme',
  project: 'backend',
  user: 'developer'
});
```

### Context Detection

By default, the SDK automatically derives context from:

1. **Git remote** - Organization and repository name from git origin
2. **Git user** - User name from git config
3. **Path** - Falls back to folder names if not in a git repo

This means you can use the SDK without any configuration in most projects.

## Links

- **CEDA**: https://getceda.com
- **Documentation**: https://getceda.com/docs
- **GitHub**: https://github.com/Spilno-me/ceda

## License

MIT

---

*Herald v1.33.0 — Pattern memory for AI agents*
