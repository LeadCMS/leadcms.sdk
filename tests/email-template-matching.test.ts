/**
 * Tests for email template matching logic (getRemoteMatch).
 * Verifies that name+language has priority over ID, mirroring how
 * content matching prioritises slug over ID.
 */

import { jest } from '@jest/globals';

jest.mock('../src/lib/data-service.js', () => ({
  leadCMSDataService: {
    isApiKeyConfigured: jest.fn(() => true),
  },
}));

import { getRemoteMatch } from '../src/scripts/push-email-templates';
import type {
  LocalEmailTemplateItem,
  RemoteEmailTemplateItem,
} from '../src/scripts/push-email-templates';

function makeLocal(overrides: Partial<LocalEmailTemplateItem> & { metadata?: Record<string, any> } = {}): LocalEmailTemplateItem {
  const { metadata: metadataOverrides, ...rest } = overrides;
  return {
    filePath: '/tmp/test/template.html',
    locale: 'en',
    groupFolder: 'notifications',
    body: '<body>Hello</body>',
    ...rest,
    metadata: {
      name: 'Welcome Email',
      subject: 'Welcome',
      fromEmail: 'team@example.com',
      fromName: 'Team',
      language: 'en',
      ...(metadataOverrides || {}),
    },
  };
}

function makeRemote(overrides: Partial<RemoteEmailTemplateItem> = {}): RemoteEmailTemplateItem {
  return {
    id: 1,
    name: 'Welcome Email',
    subject: 'Welcome',
    fromEmail: 'team@example.com',
    fromName: 'Team',
    language: 'en',
    emailGroupId: 10,
    ...overrides,
  };
}

describe('getRemoteMatch – email template matching', () => {
  describe('name-first matching priority', () => {
    it('should match by name + language when both name and ID are available', () => {
      const local = makeLocal({
        metadata: { id: 5, name: 'Welcome Email', language: 'en' },
      });

      const remoteTemplates = [
        makeRemote({ id: 5, name: 'Different Template', language: 'en' }),
        makeRemote({ id: 99, name: 'Welcome Email', language: 'en' }),
      ];

      const match = (getRemoteMatch as any)(local, remoteTemplates);

      // Should match by name (id=99), NOT by ID (id=5)
      expect(match).toBeDefined();
      expect(match.id).toBe(99);
      expect(match.name).toBe('Welcome Email');
    });

    it('should fall back to ID when name does not match any remote', () => {
      const local = makeLocal({
        metadata: { id: 5, name: 'Renamed Template', language: 'en' },
      });

      const remoteTemplates = [
        makeRemote({ id: 5, name: 'Old Name', language: 'en' }),
        makeRemote({ id: 10, name: 'Other Template', language: 'en' }),
      ];

      const match = (getRemoteMatch as any)(local, remoteTemplates);

      // Name "Renamed Template" doesn't exist remotely, falls back to ID 5
      expect(match).toBeDefined();
      expect(match.id).toBe(5);
    });

    it('should match by name even when local has no ID', () => {
      const local = makeLocal({
        metadata: { name: 'Welcome Email', language: 'en' },
      });

      const remoteTemplates = [
        makeRemote({ id: 1, name: 'Welcome Email', language: 'en' }),
      ];

      const match = (getRemoteMatch as any)(local, remoteTemplates);
      expect(match).toBeDefined();
      expect(match.id).toBe(1);
    });

    it('should return undefined when neither name nor ID matches', () => {
      const local = makeLocal({
        metadata: { id: 999, name: 'Nonexistent', language: 'en' },
      });

      const remoteTemplates = [
        makeRemote({ id: 1, name: 'Welcome Email', language: 'en' }),
      ];

      const match = (getRemoteMatch as any)(local, remoteTemplates);
      expect(match).toBeUndefined();
    });
  });

  describe('language-aware matching', () => {
    it('should not match templates with different languages by name', () => {
      const local = makeLocal({
        metadata: { name: 'Welcome Email', language: 'fr' },
      });

      const remoteTemplates = [
        makeRemote({ id: 1, name: 'Welcome Email', language: 'en' }),
      ];

      const match = (getRemoteMatch as any)(local, remoteTemplates);
      expect(match).toBeUndefined();
    });

    it('should match templates with same name and same language', () => {
      const local = makeLocal({
        locale: 'fr',
        metadata: { name: 'Welcome Email', language: 'fr' },
      });

      const remoteTemplates = [
        makeRemote({ id: 1, name: 'Welcome Email', language: 'en' }),
        makeRemote({ id: 2, name: 'Welcome Email', language: 'fr' }),
      ];

      const match = (getRemoteMatch as any)(local, remoteTemplates);
      expect(match).toBeDefined();
      expect(match.id).toBe(2);
    });

    it('should use locale as fallback when metadata.language is not set', () => {
      const local = makeLocal({
        locale: 'de',
        metadata: { name: 'Welcome Email', language: undefined as any },
      });
      // Ensure language is truly unset so locale is used as fallback
      delete local.metadata.language;

      const remoteTemplates = [
        makeRemote({ id: 1, name: 'Welcome Email', language: 'en' }),
        makeRemote({ id: 2, name: 'Welcome Email', language: 'de' }),
      ];

      const match = (getRemoteMatch as any)(local, remoteTemplates);
      expect(match).toBeDefined();
      expect(match.id).toBe(2);
    });
  });

  describe('conflicting ID scenario (user-reported bug)', () => {
    it('should match by name when local and remote have same ID but different template names', () => {
      // Scenario: Local template "Invoice" has id=10 (stale from old pull)
      // Remote id=10 now belongs to "Shipping Notification" (different template)
      // Remote id=25 has name "Invoice" (the actual match)
      const local = makeLocal({
        metadata: { id: 10, name: 'Invoice', language: 'en' },
      });

      const remoteTemplates = [
        makeRemote({ id: 10, name: 'Shipping Notification', language: 'en' }),
        makeRemote({ id: 25, name: 'Invoice', language: 'en' }),
      ];

      const match = (getRemoteMatch as any)(local, remoteTemplates);

      // Name takes priority: should match "Invoice" (id=25), not by ID (id=10)
      expect(match).toBeDefined();
      expect(match.id).toBe(25);
      expect(match.name).toBe('Invoice');
    });

    it('should match by name when local ID points to completely different remote template', () => {
      // Scenario: Two local templates both referencing IDs that belong to
      // different templates on remote. Name matching resolves this correctly.
      const localA = makeLocal({
        metadata: { id: 5, name: 'Password Reset', language: 'en' },
      });
      const localB = makeLocal({
        metadata: { id: 8, name: 'Account Created', language: 'en' },
      });

      const remoteTemplates = [
        makeRemote({ id: 5, name: 'Account Created', language: 'en' }),
        makeRemote({ id: 8, name: 'Password Reset', language: 'en' }),
      ];

      const matchA = (getRemoteMatch as any)(localA, remoteTemplates);
      const matchB = (getRemoteMatch as any)(localB, remoteTemplates);

      // localA (name="Password Reset") → remote id=8 (name="Password Reset")
      expect(matchA).toBeDefined();
      expect(matchA.id).toBe(8);

      // localB (name="Account Created") → remote id=5 (name="Account Created")
      expect(matchB).toBeDefined();
      expect(matchB.id).toBe(5);
    });
  });

  describe('edge cases', () => {
    it('should handle empty remote templates array', () => {
      const local = makeLocal({ metadata: { id: 1, name: 'Test', language: 'en' } });
      const match = (getRemoteMatch as any)(local, []);
      expect(match).toBeUndefined();
    });

    it('should handle local with no name and no ID', () => {
      const local = makeLocal({ metadata: { name: undefined as any, language: 'en' } });
      delete local.metadata.name;
      const remoteTemplates = [makeRemote()];
      const match = (getRemoteMatch as any)(local, remoteTemplates);
      expect(match).toBeUndefined();
    });

    it('should handle local with empty string name', () => {
      const local = makeLocal({ metadata: { name: '', id: 1, language: 'en' } });
      const remoteTemplates = [makeRemote({ id: 1 })];
      // Empty name is falsy, should fall back to ID
      const match = (getRemoteMatch as any)(local, remoteTemplates);
      expect(match).toBeDefined();
      expect(match.id).toBe(1);
    });

    it('should not match by ID when local ID is explicitly undefined', () => {
      const local = makeLocal({
        metadata: { name: 'No Match', id: undefined, language: 'en' },
      });
      const remoteTemplates = [makeRemote({ id: 1, name: 'Welcome Email' })];
      const match = (getRemoteMatch as any)(local, remoteTemplates);
      expect(match).toBeUndefined();
    });
  });
});
