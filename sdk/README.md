# @ceda/herald-sdk

HTTP client for CEDA Herald API. Works in Node.js, Edge runtimes, and browsers.

## Installation

```bash
npm install @ceda/herald-sdk
```

## Usage

```typescript
import { Herald } from "@ceda/herald-sdk";

const herald = new Herald({
  apiKey: "your-api-key",
  context: {
    org: "your-org",
    project: "your-project", // optional
    user: "your-user", // optional
  },
});

// Capture a pattern reflection
const { id } = await herald.reflect({
  session: "session-123",
  feeling: "success",
  insight: "Using TypeScript strict mode caught a bug early",
});

// Get patterns
const patterns = await herald.patterns({
  topic: "typescript", // optional filter
});

// Provide feedback on a pattern
await herald.feedback({
  patternId: "pattern-456",
  outcome: "helped",
});
```

## API

### `new Herald(config)`

Create a new Herald client.

```typescript
interface HeraldConfig {
  apiKey: string;
  baseUrl?: string; // defaults to https://api.getceda.com
  context: {
    org: string;
    project?: string;
    user?: string;
  };
}
```

### `herald.reflect(params)`

Capture a pattern reflection.

```typescript
interface ReflectParams {
  session: string;
  feeling: "success" | "stuck";
  insight: string;
}

// Returns: { id: string }
```

### `herald.patterns(params?)`

Get patterns matching the context.

```typescript
interface PatternsParams {
  topic?: string;
}

// Returns: Pattern[]
```

### `herald.feedback(params)`

Provide feedback on a pattern.

```typescript
interface FeedbackParams {
  patternId: string;
  outcome: "helped" | "didnt_help";
}

// Returns: void
```

## Types

All types are exported for TypeScript users:

```typescript
import type {
  Herald,
  HeraldConfig,
  ReflectParams,
  ReflectResponse,
  PatternsParams,
  Pattern,
  FeedbackParams,
  HeraldError,
} from "@ceda/herald-sdk";
```

## Environment Support

This SDK uses only the Fetch API and works in:

- Node.js 18+
- Cloudflare Workers
- Vercel Edge Functions
- Deno
- Browsers

## License

MIT
