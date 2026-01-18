# Herald

Pattern SDK for CEDA. Capture and retrieve patterns from anywhere.

## Packages

```
herald/
├── sdk/          # @ceda/herald-sdk - HTTP client
├── mcp/          # @spilno/herald-mcp - MCP server
├── slack/        # Herald Slack bot
├── telegram/     # Herald Telegram bot
└── teams/        # Herald Teams bot (planned)
```

## Quick Start

```bash
npm install @ceda/herald-sdk
```

```typescript
import { Herald } from '@ceda/herald-sdk';

const herald = new Herald({ apiKey: process.env.HERALD_API_KEY });

// Capture a pattern
await herald.reflect({
  session: 'my-session',
  feeling: 'success',
  insight: 'What worked and why',
});

// Query patterns
const patterns = await herald.patterns({ topic: 'authentication' });
```

## Related

- [CEDA](https://github.com/Spilno-me/ceda) — Pattern memory cloud
- [Wave](https://github.com/Spilno-me/wave) — Collaborative AI workspace

---

*Herald — Patterns everywhere*
