#!/usr/bin/env node
/**
 * Post-install guidance for @spilno/herald-mcp
 */

console.log(`
╭─────────────────────────────────────────────────────────────╮
│  @spilno/herald-mcp installed                               │
╰─────────────────────────────────────────────────────────────╯

Quick Start:
  npx @spilno/herald-mcp init      Setup with Claude Code
  npx @spilno/herald-mcp chat      Interactive pattern capture

SDK Usage:
  import { herald } from '@spilno/herald-mcp';
  herald.learned('What worked');
  herald.gotStuck('What failed');

Docs: https://getceda.com/docs
`);
