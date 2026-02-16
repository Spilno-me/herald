/**
 * #772: Unit tests for Talk-to-Data integration tools
 *
 * Tests the 4 new tools:
 * - herald_query_analytics
 * - herald_query_reflections
 * - herald_search_knowledge
 * - herald_scaffold_module
 */

import * as fs from 'fs';
import * as path from 'path';

describe('#772: Talk-to-Data Tools', () => {
  const cliPath = path.join(process.cwd(), 'src', 'cli.ts');
  let cliContent: string;

  beforeAll(() => {
    cliContent = fs.readFileSync(cliPath, 'utf-8');
  });

  describe('Tool definitions', () => {
    it('should have herald_query_analytics tool defined', () => {
      expect(cliContent).toContain('name: "herald_query_analytics"');
      expect(cliContent).toContain('Query company analytics');
    });

    it('should have herald_query_reflections tool defined', () => {
      expect(cliContent).toContain('name: "herald_query_reflections"');
      expect(cliContent).toContain('Query captured reflections');
    });

    it('should have herald_search_knowledge tool defined', () => {
      expect(cliContent).toContain('name: "herald_search_knowledge"');
      expect(cliContent).toContain('Search the private knowledge base');
    });

    it('should have herald_scaffold_module tool defined', () => {
      expect(cliContent).toContain('name: "herald_scaffold_module"');
      expect(cliContent).toContain('Scaffold a new module directory structure');
    });
  });

  describe('Tool input schemas', () => {
    it('herald_query_analytics should require category', () => {
      expect(cliContent).toMatch(
        /herald_query_analytics[\s\S]*?required.*\["category"\]/,
      );
    });

    it('herald_query_analytics should have category enum with valid values', () => {
      expect(cliContent).toMatch(
        /herald_query_analytics[\s\S]*?"metrics".*"trends".*"patterns".*"users".*"system"/,
      );
    });

    it('herald_query_reflections should have feeling enum with success and stuck', () => {
      expect(cliContent).toMatch(
        /herald_query_reflections[\s\S]*?"success".*"stuck"/,
      );
    });

    it('herald_search_knowledge should require query', () => {
      expect(cliContent).toMatch(
        /herald_search_knowledge[\s\S]*?required.*\["query"\]/,
      );
    });

    it('herald_search_knowledge should have limit and org optional properties', () => {
      expect(cliContent).toMatch(
        /herald_search_knowledge[\s\S]*?limit[\s\S]*?Maximum number of results/,
      );
      expect(cliContent).toMatch(
        /herald_search_knowledge[\s\S]*?org[\s\S]*?Organization slug/,
      );
    });

    it('herald_scaffold_module should require module_name, display_name, and entities', () => {
      expect(cliContent).toMatch(
        /herald_scaffold_module[\s\S]*?required.*"module_name".*"display_name".*"entities"/,
      );
    });
  });

  describe('Tool handlers', () => {
    it('herald_query_analytics handler should call /api/analytics/', () => {
      expect(cliContent).toContain('case "herald_query_analytics"');
      expect(cliContent).toMatch(
        /case "herald_query_analytics"[\s\S]*?\/api\/analytics\//,
      );
    });

    it('herald_query_reflections handler should call /api/herald/reflections', () => {
      expect(cliContent).toContain('case "herald_query_reflections"');
      expect(cliContent).toMatch(
        /case "herald_query_reflections"[\s\S]*?\/api\/herald\/reflections/,
      );
    });

    it('herald_search_knowledge handler should POST to /api/documents/search', () => {
      expect(cliContent).toContain('case "herald_search_knowledge"');
      expect(cliContent).toMatch(
        /case "herald_search_knowledge"[\s\S]*?\/api\/documents\/search.*POST/,
      );
    });

    it('herald_scaffold_module handler should write files', () => {
      expect(cliContent).toContain('case "herald_scaffold_module"');
      expect(cliContent).toMatch(
        /case "herald_scaffold_module"[\s\S]*?writeFileSync/,
      );
    });
  });

  describe('Bug regression: herald_search_knowledge callCedaAPI', () => {
    it('should call callCedaAPI with string method "POST", not an object', () => {
      // Extract the herald_search_knowledge handler block
      const handlerMatch = cliContent.match(
        /case "herald_search_knowledge"[\s\S]*?(?=case "|default:)/,
      );
      expect(handlerMatch).not.toBeNull();

      const handler = handlerMatch![0];

      // Must use callCedaAPI('/api/documents/search', 'POST', { ... })
      // NOT callCedaAPI('/api/documents/search', { method: 'POST', ... })
      expect(handler).toMatch(/callCedaAPI\(\s*['"]\/api\/documents\/search['"]\s*,\s*['"]POST['"]\s*,/);
      expect(handler).not.toContain('method: \'POST\'');
      expect(handler).not.toContain('method: "POST"');
    });

    it('should not JSON.stringify the request body (callCedaAPI handles serialization)', () => {
      const handlerMatch = cliContent.match(
        /case "herald_search_knowledge"[\s\S]*?(?=case "|default:)/,
      );
      expect(handlerMatch).not.toBeNull();

      const handler = handlerMatch![0];
      // The callCedaAPI call itself should NOT wrap body in JSON.stringify
      // (JSON.stringify in the return statement for formatting the response is fine)
      expect(handler).not.toMatch(/callCedaAPI\([^)]*JSON\.stringify/);
    });
  });
});
