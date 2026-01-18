# Herald Playbook

*Instructions for AI agents working on Herald*

---

## Project Context

Herald is the SDK and integration layer for CEDA pattern memory. It enables pattern capture and retrieval from any context.

**Repository**: github.com/Spilno-me/herald
**Related**: CEDA (pattern storage), Wave (collaborative workspace)

---

## ⚠️ MANDATORY: Herald Reflection Protocol

**You MUST call Herald at least once per task.** This is not optional.

| Situation | Action | Tool |
|-----------|--------|------|
| **Stuck** (>15 min) | Capture blocker | `herald_reflect` feeling=stuck |
| **Complex decision** | Get AI analysis | `herald_simulate` |
| **Success** | Capture what worked | `herald_reflect` feeling=success |
| **Task complete** | Reflect on outcome | `herald_reflect` |

---

## Package Structure

```
herald/
├── sdk/                    # @ceda/herald-sdk
│   ├── src/
│   │   ├── index.ts       # Main export
│   │   ├── herald.ts      # Herald client class
│   │   └── types.ts       # TypeScript types
│   ├── package.json
│   └── tsconfig.json
│
├── mcp/                    # @spilno/herald-mcp
│   ├── src/
│   │   └── index.ts       # MCP server
│   └── package.json
│
├── slack/                  # Herald Slack bot
│   ├── src/
│   │   └── index.ts       # Slack app
│   └── package.json
│
├── telegram/               # Herald Telegram bot
│   ├── src/
│   │   └── index.ts       # Telegram bot
│   └── package.json
│
└── teams/                  # Herald Teams bot (planned)
```

---

## Tech Stack

```
MUST USE
├── TypeScript (strict)
├── Node.js 20+
├── tsup (bundling)
├── pnpm (monorepo)

DEPLOY TO
├── npm (@ceda/herald-sdk, @spilno/herald-mcp)
└── Railway (bots)
```

---

## API Design

All Herald integrations use the same core API:

```typescript
interface HeraldClient {
  // Capture patterns
  reflect(opts: ReflectOptions): Promise<void>;
  simulate(opts: SimulateOptions): Promise<SimulationResult>;
  
  // Query patterns  
  patterns(opts?: PatternQuery): Promise<Pattern[]>;
  
  // Session management
  predict(signal: string): Promise<Prediction>;
  refine(sessionId: string, refinement: string): Promise<Prediction>;
}
```

---

## Quality Checklist

Before PR:
- [ ] TypeScript strict mode passes
- [ ] Tests pass
- [ ] Works with CEDA API
- [ ] Herald reflection called at least once (MANDATORY)

---

*Herald Playbook v1.0*
