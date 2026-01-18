/**
 * CEDA-49: Unit tests for Herald MCP Session Management Tools
 *
 * Tests the 5 new session management tools:
 * - herald_session_list
 * - herald_session_get
 * - herald_session_history
 * - herald_session_rollback
 * - herald_session_archive
 */

import * as fs from 'fs';
import * as path from 'path';

describe('CEDA-49: Session Management Tools', () => {
  const indexPath = path.join(process.cwd(), 'src', 'cli.ts');
  let indexContent: string;

  beforeAll(() => {
    indexContent = fs.readFileSync(indexPath, 'utf-8');
  });

  describe('Tool definitions', () => {
    it('should have herald_session_list tool defined', () => {
      expect(indexContent).toContain('name: "herald_session_list"');
      expect(indexContent).toContain('List sessions for a company with optional filters');
    });

    it('should have herald_session_get tool defined', () => {
      expect(indexContent).toContain('name: "herald_session_get"');
      expect(indexContent).toContain('Get detailed information about a specific session');
    });

    it('should have herald_session_history tool defined', () => {
      expect(indexContent).toContain('name: "herald_session_history"');
      expect(indexContent).toContain('Get version history for a session');
    });

    it('should have herald_session_rollback tool defined', () => {
      expect(indexContent).toContain('name: "herald_session_rollback"');
      expect(indexContent).toContain('Restore a session to a previous version');
    });

    it('should have herald_session_archive tool defined', () => {
      expect(indexContent).toContain('name: "herald_session_archive"');
      expect(indexContent).toContain('Archive a session');
    });
  });

  describe('Tool input schemas', () => {
    it('herald_session_list should have optional company, project, user, status, limit properties', () => {
      // Check that the tool has the expected properties in its schema
      expect(indexContent).toMatch(/herald_session_list[\s\S]*?company.*Filter by company/);
      expect(indexContent).toMatch(/herald_session_list[\s\S]*?project.*Filter by project/);
      expect(indexContent).toMatch(/herald_session_list[\s\S]*?user.*Filter by user/);
      expect(indexContent).toMatch(/herald_session_list[\s\S]*?status.*Filter by status/);
      expect(indexContent).toMatch(/herald_session_list[\s\S]*?limit.*Maximum number of sessions/);
    });

    it('herald_session_get should require session_id', () => {
      expect(indexContent).toMatch(/herald_session_get[\s\S]*?session_id.*Session ID to retrieve/);
      expect(indexContent).toMatch(/herald_session_get[\s\S]*?required.*session_id/);
    });

    it('herald_session_history should require session_id and have optional limit', () => {
      expect(indexContent).toMatch(/herald_session_history[\s\S]*?session_id.*Session ID to get history for/);
      expect(indexContent).toMatch(/herald_session_history[\s\S]*?limit.*Maximum number of versions/);
      expect(indexContent).toMatch(/herald_session_history[\s\S]*?required.*session_id/);
    });

    it('herald_session_rollback should require session_id and version', () => {
      expect(indexContent).toMatch(/herald_session_rollback[\s\S]*?session_id.*Session ID to rollback/);
      expect(indexContent).toMatch(/herald_session_rollback[\s\S]*?version.*Version number to restore/);
      expect(indexContent).toMatch(/herald_session_rollback[\s\S]*?required.*session_id.*version/);
    });

    it('herald_session_archive should require session_id', () => {
      expect(indexContent).toMatch(/herald_session_archive[\s\S]*?session_id.*Session ID to archive/);
      expect(indexContent).toMatch(/herald_session_archive[\s\S]*?required.*session_id/);
    });
  });

  describe('Tool handlers', () => {
    it('herald_session_list handler should call /api/sessions endpoint', () => {
      expect(indexContent).toContain('case "herald_session_list"');
      expect(indexContent).toMatch(/case "herald_session_list"[\s\S]*?\/api\/sessions\?/);
    });

    it('herald_session_get handler should call /api/session/:id endpoint', () => {
      expect(indexContent).toContain('case "herald_session_get"');
      expect(indexContent).toMatch(/case "herald_session_get"[\s\S]*?\/api\/session\/\$\{sessionId\}/);
    });

    it('herald_session_history handler should call /api/session/:id/history endpoint', () => {
      expect(indexContent).toContain('case "herald_session_history"');
      expect(indexContent).toMatch(/case "herald_session_history"[\s\S]*?\/api\/session\/\$\{sessionId\}\/history/);
    });

    it('herald_session_rollback handler should POST to /api/session/:id/rollback endpoint', () => {
      expect(indexContent).toContain('case "herald_session_rollback"');
      expect(indexContent).toMatch(/case "herald_session_rollback"[\s\S]*?\/api\/session\/\$\{sessionId\}\/rollback/);
      expect(indexContent).toMatch(/case "herald_session_rollback"[\s\S]*?"POST"/);
    });

    it('herald_session_archive handler should PUT to /api/session/:id with status=archived', () => {
      expect(indexContent).toContain('case "herald_session_archive"');
      expect(indexContent).toMatch(/case "herald_session_archive"[\s\S]*?\/api\/session\/\$\{sessionId\}.*"PUT"/);
      expect(indexContent).toMatch(/case "herald_session_archive"[\s\S]*?status.*archived/);
    });
  });

  describe('herald_help documentation', () => {
    it('should include Session Management section', () => {
      expect(indexContent).toContain('Session Management (CEDA-49)');
    });

    it('should document all 5 session management tools', () => {
      // Check that herald_help includes documentation for all tools
      const helpTextMatch = indexContent.match(/herald_help[\s\S]*?Session Management \(CEDA-49\)[\s\S]*?Context Sync/);
      expect(helpTextMatch).not.toBeNull();
      
      const helpSection = helpTextMatch![0];
      expect(helpSection).toContain('herald_session_list');
      expect(helpSection).toContain('herald_session_get');
      expect(helpSection).toContain('herald_session_history');
      expect(helpSection).toContain('herald_session_rollback');
      expect(helpSection).toContain('herald_session_archive');
    });
  });

  describe('Version', () => {
    it('should have VERSION constant defined in index.ts', () => {
      expect(indexContent).toMatch(/const VERSION = "\d+\.\d+\.\d+"/);
    });

    it('should have matching version format in package.json', () => {
      const packagePath = path.join(process.cwd(), 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
      expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('CEDA-49 comment markers', () => {
    it('should have CEDA-49 comment in tool definitions', () => {
      expect(indexContent).toContain('// CEDA-49: Session Management Tools');
    });

    it('should have CEDA-49 comment in tool handlers', () => {
      // Check that there's a CEDA-49 comment before the session tool handlers
      expect(indexContent).toMatch(/\/\/ CEDA-49: Session Management Tools[\s\S]*?case "herald_session_list"/);
    });
  });
});
