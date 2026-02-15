/**
 * CEDA-64: Unit tests for Herald MCP Command Extensions
 *
 * Tests the 3 new command extension tools:
 * - herald_session_reflections
 * - herald_pattern_feedback
 * - herald_share_scoped
 */

import * as fs from 'fs';
import * as path from 'path';

describe('CEDA-64: Herald Command Extensions', () => {
  const indexPath = path.join(process.cwd(), 'src', 'cli.ts');
  let indexContent: string;

  beforeAll(() => {
    indexContent = fs.readFileSync(indexPath, 'utf-8');
  });

  describe('Tool definitions', () => {
    it('should have herald_session_reflections tool defined', () => {
      expect(indexContent).toContain('name: "herald_session_reflections"');
      expect(indexContent).toContain('Get summary of reflections captured during this MCP session');
    });

    it('should have herald_pattern_feedback tool defined', () => {
      expect(indexContent).toContain('name: "herald_pattern_feedback"');
      expect(indexContent).toContain('Provide feedback on whether a learned pattern/antipattern helped');
    });

    it('should have herald_share_scoped tool defined', () => {
      expect(indexContent).toContain('name: "herald_share_scoped"');
      expect(indexContent).toContain('Share an insight with other Herald contexts using scope control');
    });
  });

  describe('Tool input schemas', () => {
    it('herald_session_reflections should have no required properties', () => {
      // Check that the tool has empty properties (no required inputs)
      expect(indexContent).toMatch(/herald_session_reflections[\s\S]*?inputSchema[\s\S]*?properties:\s*\{\}/);
    });

    it('herald_pattern_feedback should have pattern_id, pattern_text, and outcome properties', () => {
      expect(indexContent).toMatch(/herald_pattern_feedback[\s\S]*?pattern_id.*ID of the pattern/);
      expect(indexContent).toMatch(/herald_pattern_feedback[\s\S]*?pattern_text.*Alternative.*pattern text to match/);
      expect(indexContent).toMatch(/herald_pattern_feedback[\s\S]*?outcome.*helped.*didnt_help/);
      expect(indexContent).toMatch(/herald_pattern_feedback[\s\S]*?required.*outcome/);
    });

    it('herald_share_scoped should have insight, scope, and topic properties', () => {
      expect(indexContent).toContain('name: "herald_share_scoped"');
      expect(indexContent).toContain('"parent", "siblings", "all"');
      expect(indexContent).toContain('Optional topic category for the insight');
      expect(indexContent).toContain('required: ["insight", "scope"]');
    });
  });

  describe('Tool handlers', () => {
    it('herald_session_reflections handler should call getSessionReflectionsSummary', () => {
      expect(indexContent).toContain('case "herald_session_reflections"');
      expect(indexContent).toMatch(/case "herald_session_reflections"[\s\S]*?getSessionReflectionsSummary/);
    });

    it('herald_pattern_feedback handler should POST to /api/herald/feedback endpoint', () => {
      expect(indexContent).toContain('case "herald_pattern_feedback"');
      expect(indexContent).toMatch(/case "herald_pattern_feedback"[\s\S]*?\/api\/herald\/feedback.*POST/);
    });

    it('herald_share_scoped handler should POST to /api/herald/share endpoint', () => {
      expect(indexContent).toContain('case "herald_share_scoped"');
      expect(indexContent).toMatch(/case "herald_share_scoped"[\s\S]*?\/api\/herald\/share.*POST/);
    });
  });

  describe('Session reflection tracking', () => {
    it('should have SessionReflection interface defined', () => {
      expect(indexContent).toContain('interface SessionReflection');
      expect(indexContent).toMatch(/SessionReflection[\s\S]*?id:\s*string/);
      expect(indexContent).toMatch(/SessionReflection[\s\S]*?session:\s*string/);
      expect(indexContent).toMatch(/SessionReflection[\s\S]*?feeling:\s*"stuck"\s*\|\s*"success"/);
      expect(indexContent).toMatch(/SessionReflection[\s\S]*?insight:\s*string/);
      expect(indexContent).toMatch(/SessionReflection[\s\S]*?method:\s*"direct"\s*\|\s*"simulation"/);
      expect(indexContent).toMatch(/SessionReflection[\s\S]*?timestamp:\s*string/);
    });

    it('should have sessionReflections array defined', () => {
      expect(indexContent).toContain('const sessionReflections: SessionReflection[] = []');
    });

    it('should have addSessionReflection function defined', () => {
      expect(indexContent).toContain('function addSessionReflection');
    });

    it('should have getSessionReflectionsSummary function defined', () => {
      expect(indexContent).toContain('function getSessionReflectionsSummary');
    });

    it('herald_reflect should track reflections locally', () => {
      expect(indexContent).toMatch(/case "herald_reflect"[\s\S]*?addSessionReflection/);
    });

    it('herald_simulate should track reflections locally', () => {
      expect(indexContent).toMatch(/case "herald_simulate"[\s\S]*?addSessionReflection/);
    });
  });

  describe('Version', () => {
    it('should be version 1.19.0 in index.ts', () => {
      expect(indexContent).toContain('const VERSION = "1.19.0"');
    });

    it('should have matching version in package.json', () => {
      const packagePath = path.join(process.cwd(), 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
      expect(packageJson.version).toBe('1.19.0');
    });
  });

  describe('CEDA-64 comment markers', () => {
    it('should have CEDA-64 comment in tool definitions', () => {
      expect(indexContent).toContain('// CEDA-64: Herald Command Extensions');
    });

    it('should have CEDA-64 comment in session reflection tracking', () => {
      expect(indexContent).toContain('// CEDA-64: Session reflection tracking');
    });

    it('should have CEDA-64 comment in tool handlers', () => {
      expect(indexContent).toContain('// CEDA-64: Herald Command Extensions - Handlers');
    });

    it('should have CEDA-64 comment in herald_reflect handler', () => {
      expect(indexContent).toMatch(/case "herald_reflect"[\s\S]*?CEDA-64: Track reflection locally/);
    });

    it('should have CEDA-64 comment in herald_simulate handler', () => {
      expect(indexContent).toMatch(/case "herald_simulate"[\s\S]*?CEDA-64: Track reflection locally/);
    });
  });
});
