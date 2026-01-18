# CEDA-71: Context Persistence

## Problem

Herald derives context (tags) from path on every startup. No persistence means:
- Context can drift if user moves directories
- No way to confirm/override derived context
- Repeated derivation overhead

## Solution

Use `.mcp.json` as nano state file. Herald reads/writes context:

```
First run:  derive → confirm → store
Next runs:  load stored → use
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Claude Code                        │
├─────────────────────────────────────────────────────┤
│  .mcp.json          ← Herald reads/writes context   │
│  CLAUDE.md          ← Project instructions          │
└───────────────┬─────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────┐
│                   Herald MCP                         │
├─────────────────────────────────────────────────────┤
│  1. Read .mcp.json context (if exists)              │
│  2. Else derive from path → tags                    │
│  3. Store derived context back to .mcp.json         │
│  4. Send startup heartbeat → CEDA                   │
│  5. Load patterns for this context                  │
└───────────────┬─────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────┐
│                     CEDA                             │
├─────────────────────────────────────────────────────┤
│  Telemetry    (user, version, tags, platform)       │
│  Patterns     (by tag affinity)                     │
│  Reflections  (learned from sessions)               │
└─────────────────────────────────────────────────────┘
```

## .mcp.json Schema

```json
{
  "mcpServers": {
    "herald": {
      "command": "npx",
      "args": ["@spilno/herald-mcp@latest"],
      "env": {
        "CEDA_URL": "https://getceda.com"
      }
    }
  },
  "herald": {
    "context": {
      "tags": ["vaults", "spilno_vault"],
      "user": "oleksii",
      "derived": true,
      "derivedFrom": "path",
      "storedAt": "2026-01-16T09:30:00.000Z"
    }
  }
}
```

## Precedence (highest to lowest)

1. `env.HERALD_COMPANY/PROJECT/USER` in .mcp.json → explicit override
2. `herald.context.tags` in .mcp.json → stored context
3. Path derivation → zero-config fallback

## Implementation

### On startup (runMCP)

```typescript
async function loadOrDeriveContext(): Promise<{
  tags: string[];
  user: string;
  source: 'env' | 'stored' | 'derived';
}> {
  // 1. Check env vars (explicit override)
  if (process.env.HERALD_COMPANY) {
    return {
      tags: [process.env.HERALD_COMPANY, process.env.HERALD_PROJECT].filter(Boolean),
      user: process.env.HERALD_USER || deriveUser(),
      source: 'env'
    };
  }

  // 2. Check .mcp.json for stored context
  const mcpJson = readMcpJson();
  if (mcpJson?.herald?.context?.tags) {
    return {
      tags: mcpJson.herald.context.tags,
      user: mcpJson.herald.context.user || deriveUser(),
      source: 'stored'
    };
  }

  // 3. Derive from path and store
  const tags = deriveTags();
  const user = deriveUser();

  // Write back to .mcp.json
  await persistContext({ tags, user });

  return { tags, user, source: 'derived' };
}
```

### Read .mcp.json

```typescript
function readMcpJson(): McpJson | null {
  const mcpPath = join(process.cwd(), '.mcp.json');
  if (!existsSync(mcpPath)) return null;

  try {
    return JSON.parse(readFileSync(mcpPath, 'utf-8'));
  } catch {
    return null;
  }
}
```

### Write context to .mcp.json

```typescript
async function persistContext(context: { tags: string[]; user: string }): Promise<void> {
  const mcpPath = join(process.cwd(), '.mcp.json');

  let mcpJson: McpJson = {};
  if (existsSync(mcpPath)) {
    try {
      mcpJson = JSON.parse(readFileSync(mcpPath, 'utf-8'));
    } catch {
      // Corrupted file, start fresh
    }
  }

  // Add herald context section
  mcpJson.herald = {
    ...mcpJson.herald,
    context: {
      tags: context.tags,
      user: context.user,
      derived: true,
      derivedFrom: 'path',
      storedAt: new Date().toISOString()
    }
  };

  writeFileSync(mcpPath, JSON.stringify(mcpJson, null, 2));
  console.error(`[Herald] Context stored: tags=[${context.tags.join(', ')}]`);
}
```

## CLI Command: herald context

```bash
# Show current context
npx @spilno/herald-mcp context

# Output:
# Context: [vaults, spilno_vault]
# User: oleksii
# Source: stored (.mcp.json)

# Reset to re-derive
npx @spilno/herald-mcp context --reset
```

## Telemetry Update

Heartbeat now includes context source:

```json
{
  "event": "startup",
  "user": "oleksii",
  "version": "1.30.0",
  "tags": ["vaults", "spilno_vault"],
  "contextSource": "stored",
  "platform": "darwin"
}
```

## Migration

- Existing users with `HERALD_COMPANY/PROJECT/USER` → works unchanged
- New users → zero-config derives and stores
- Users can delete `herald.context` from .mcp.json to re-derive

## Version

Herald 1.30.0
