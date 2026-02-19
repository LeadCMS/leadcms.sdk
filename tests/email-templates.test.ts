import {
  parseEmailTemplateFileContent,
  transformEmailTemplateRemoteToLocalFormat,
  formatEmailTemplateForApi,
} from '../src/lib/email-template-transformation';
import { hasContentDifferences } from '../src/lib/content-transformation';
import { threeWayMerge, isLocallyModified } from '../src/lib/content-merge';

describe('email template HTML frontmatter', () => {
  it('parses HTML comment frontmatter and body', () => {
    const input = `<!--
---
name: "Welcome"
subject: "Hello"
fromEmail: "team@example.com"
groupName: "Notifications"
---
-->
<body>Hi</body>`;

    const parsed = parseEmailTemplateFileContent(input);
    expect(parsed.metadata.name).toBe('Welcome');
    expect(parsed.metadata.subject).toBe('Hello');
    expect(parsed.metadata.fromEmail).toBe('team@example.com');
    expect(parsed.metadata.groupName).toBe('Notifications');
    expect(parsed.body).toBe('<body>Hi</body>');
  });

  it('still parses legacy emailGroupId from frontmatter', () => {
    const input = `<!--
---
name: "Legacy"
emailGroupId: 12
---
-->
<body>Hi</body>`;

    const parsed = parseEmailTemplateFileContent(input);
    expect(parsed.metadata.emailGroupId).toBe(12);
  });

  it('serializes remote template into HTML with groupName instead of emailGroupId', () => {
    const remote = {
      id: 5,
      name: 'Reset Password',
      subject: 'Reset',
      fromEmail: 'support@example.com',
      fromName: 'Support',
      language: 'en',
      emailGroupId: 2,
      emailGroup: { id: 2, name: 'Notifications' },
      bodyTemplate: '<img src="/api/media/emails/reset.png" />',
    };

    const output = transformEmailTemplateRemoteToLocalFormat(remote);
    expect(output).toContain('<!--');
    expect(output).toContain('name: Reset Password');
    expect(output).toContain('groupName: Notifications');
    expect(output).not.toContain('emailGroupId');
    expect(output).toContain('/media/emails/reset.png');
  });

  it('does not include emailGroupId in serialized output', () => {
    const remote = {
      id: 5,
      name: 'Welcome',
      subject: 'Hello',
      emailGroupId: 3,
      bodyTemplate: '<body>Hi</body>',
    };

    const output = transformEmailTemplateRemoteToLocalFormat(remote);
    expect(output).not.toContain('emailGroupId');
  });

  it('formats local template for API with media path replacement', () => {
    const local = {
      metadata: {
        name: 'Welcome',
        subject: 'Hello',
        fromEmail: 'team@example.com',
        fromName: 'Team',
        language: 'en',
        emailGroupId: 9,
      },
      body: '<img src="/media/emails/welcome.png" />',
    };

    const payload = formatEmailTemplateForApi(local);
    expect(payload.bodyTemplate).toContain('/api/media/emails/welcome.png');
    expect(payload.emailGroupId).toBe(9);
  });

  it('does not send groupName to the API', () => {
    const local = {
      metadata: {
        name: 'Welcome',
        subject: 'Hello',
        fromEmail: 'team@example.com',
        fromName: 'Team',
        language: 'en',
        emailGroupId: 9,
        groupName: 'Notifications',
      },
      body: '<body>Hi</body>',
    };

    const payload = formatEmailTemplateForApi(local);
    expect(payload.emailGroupId).toBe(9);
    expect(payload.groupName).toBeUndefined();
  });

  it('does not include groupName when emailGroup is null (API sync response)', () => {
    // The sync API returns emailGroup: null even when emailGroupId is set.
    // Without enrichment, groupName should be absent.
    const remote = {
      id: 3,
      name: 'Acknowledgment',
      subject: 'Thank You',
      fromEmail: 'support@example.com',
      fromName: 'Support',
      language: 'en',
      emailGroupId: 1,
      emailGroup: null,
      bodyTemplate: '<body>Thanks</body>',
    };

    const output = transformEmailTemplateRemoteToLocalFormat(remote);
    expect(output).toContain('name: Acknowledgment');
    expect(output).not.toContain('groupName');
    expect(output).not.toContain('emailGroupId');
  });

  it('includes groupName when emailGroup is enriched before transformation', () => {
    // After enrichment (fetch-leadcms-email-templates resolves groups),
    // the template should include groupName.
    const remote = {
      id: 3,
      name: 'Acknowledgment',
      subject: 'Thank You',
      fromEmail: 'support@example.com',
      fromName: 'Support',
      language: 'en',
      emailGroupId: 1,
      emailGroup: { id: 1, name: 'Transactional', language: 'en' },
      bodyTemplate: '<body>Thanks</body>',
    };

    const output = transformEmailTemplateRemoteToLocalFormat(remote);
    expect(output).toContain('groupName: Transactional');
    expect(output).not.toContain('emailGroupId');
  });

  it('roundtrip: enriched remote produces identical output to local file (no false diff)', () => {
    // Simulate a template freshly pulled with enriched emailGroup
    const remote = {
      id: 3,
      name: 'Acknowledgment',
      subject: 'Thank You for Your Feedback',
      fromEmail: 'support@leadcms.ai',
      fromName: 'Support Team',
      language: 'en',
      emailGroupId: 1,
      emailGroup: { id: 1, name: 'Transactional', language: 'en' },
      createdAt: '2025-05-26T06:25:45.803122Z',
      bodyTemplate: '<body>Thanks</body>',
    };

    // Transform to local format (simulates what pull writes to disk)
    const localContent = transformEmailTemplateRemoteToLocalFormat(remote);

    // Re-transform the same enriched remote (simulates what status compares against)
    const statusContent = transformEmailTemplateRemoteToLocalFormat(remote);

    // These should be identical — no false "modified" detection
    expect(hasContentDifferences(localContent, statusContent)).toBe(false);
  });

  it('roundtrip: unenriched remote (emailGroup: null) produces different output than enriched local', () => {
    const enrichedRemote = {
      id: 3,
      name: 'Acknowledgment',
      subject: 'Thank You',
      fromEmail: 'support@example.com',
      fromName: 'Support',
      language: 'en',
      emailGroupId: 1,
      emailGroup: { id: 1, name: 'Transactional', language: 'en' },
      bodyTemplate: '<body>Thanks</body>',
    };

    const unenrichedRemote = {
      ...enrichedRemote,
      emailGroup: null,
    };

    const enrichedOutput = transformEmailTemplateRemoteToLocalFormat(enrichedRemote);
    const unenrichedOutput = transformEmailTemplateRemoteToLocalFormat(unenrichedRemote);

    // Without enrichment, groupName is missing — so the outputs differ
    expect(hasContentDifferences(enrichedOutput, unenrichedOutput)).toBe(true);
    expect(enrichedOutput).toContain('groupName: Transactional');
    expect(unenrichedOutput).not.toContain('groupName');
  });

  describe('timestamp precision normalization', () => {
    it('does not flag as different when only timestamp precision differs (6 vs 7 digits)', () => {
      const remote6 = {
        id: 1,
        name: 'Welcome',
        subject: 'Hello',
        fromEmail: 'team@example.com',
        fromName: 'Team',
        language: 'en',
        emailGroupId: 1,
        emailGroup: { id: 1, name: 'Notifications', language: 'en' },
        createdAt: '2026-02-19T16:57:53.063594Z',
        updatedAt: '2026-02-19T16:57:53.063594Z',
        bodyTemplate: '<body>Hello</body>',
      };

      const remote7 = {
        ...remote6,
        createdAt: '2026-02-19T16:57:53.0635946Z',
        updatedAt: '2026-02-19T16:57:53.0635946Z',
      };

      const local6 = transformEmailTemplateRemoteToLocalFormat(remote6);
      const local7 = transformEmailTemplateRemoteToLocalFormat(remote7);

      // Should not detect any differences — only timestamp precision changed
      expect(hasContentDifferences(local6, local7)).toBe(false);
    });

    it('does not flag as different when trailing zeros differ', () => {
      const remote1 = {
        id: 2,
        name: 'Reset',
        subject: 'Reset Password',
        fromEmail: 'security@example.com',
        fromName: 'Security',
        language: 'en',
        updatedAt: '2026-02-19T16:57:53.060000Z',
        bodyTemplate: '<body>Reset</body>',
      };

      const remote2 = {
        ...remote1,
        updatedAt: '2026-02-19T16:57:53.06Z',
      };

      const local1 = transformEmailTemplateRemoteToLocalFormat(remote1);
      const local2 = transformEmailTemplateRemoteToLocalFormat(remote2);

      expect(hasContentDifferences(local1, local2)).toBe(false);
    });

    it('still detects real differences alongside timestamp precision differences', () => {
      const remote1 = {
        id: 1,
        name: 'Welcome',
        subject: 'Hello',
        fromEmail: 'team@example.com',
        fromName: 'Team',
        language: 'en',
        updatedAt: '2026-02-19T16:57:53.063594Z',
        bodyTemplate: '<body>Hello</body>',
      };

      const remote2 = {
        ...remote1,
        subject: 'Hi there',
        updatedAt: '2026-02-19T16:57:53.0635946Z',
      };

      const local1 = transformEmailTemplateRemoteToLocalFormat(remote1);
      const local2 = transformEmailTemplateRemoteToLocalFormat(remote2);

      // Subject changed — should detect differences despite timestamp normalization
      expect(hasContentDifferences(local1, local2)).toBe(true);
    });
  });

  describe('three-way merge for email templates', () => {
    const makeTemplate = (overrides: Record<string, any> = {}) => ({
      id: 1,
      name: 'Welcome',
      subject: 'Hello',
      fromEmail: 'team@example.com',
      fromName: 'Team',
      language: 'en',
      emailGroupId: 1,
      emailGroup: { id: 1, name: 'Notifications', language: 'en' },
      createdAt: '2026-01-01T00:00:00.000000Z',
      updatedAt: '2026-01-01T00:00:00.000000Z',
      bodyTemplate: '<body>Welcome to our platform!</body>',
      ...overrides,
    });

    it('detects no local modification when files match (isLocallyModified)', () => {
      const remote = makeTemplate();
      const baseContent = transformEmailTemplateRemoteToLocalFormat(remote);
      const localContent = baseContent; // local unchanged

      expect(isLocallyModified(baseContent, localContent)).toBe(false);
    });

    it('detects no local modification despite timestamp precision difference', () => {
      const base = makeTemplate({ updatedAt: '2026-01-01T00:00:00.123456Z' });
      const baseContent = transformEmailTemplateRemoteToLocalFormat(base);
      // Simulate local file with different precision (7 digits)
      const localContent = baseContent.replace('123456Z', '1234567Z');

      expect(isLocallyModified(baseContent, localContent)).toBe(false);
    });

    it('detects local modification when subject is changed', () => {
      const remote = makeTemplate();
      const baseContent = transformEmailTemplateRemoteToLocalFormat(remote);
      const localContent = baseContent.replace('subject: Hello', 'subject: Welcome aboard');

      expect(isLocallyModified(baseContent, localContent)).toBe(true);
    });

    it('auto-merges non-overlapping local and remote changes', () => {
      const base = makeTemplate();
      const local = makeTemplate({ subject: 'Welcome aboard' });
      const remote = makeTemplate({
        bodyTemplate: '<body>Welcome! We are glad to have you.</body>',
        updatedAt: '2026-02-01T00:00:00.000000Z',
      });

      const baseContent = transformEmailTemplateRemoteToLocalFormat(base);
      const localContent = transformEmailTemplateRemoteToLocalFormat(local);
      const remoteContent = transformEmailTemplateRemoteToLocalFormat(remote);

      const result = threeWayMerge(baseContent, localContent, remoteContent);

      expect(result.success).toBe(true);
      expect(result.hasConflicts).toBe(false);
      // Local subject change preserved
      expect(result.merged).toContain('subject: Welcome aboard');
      // Remote body change preserved
      expect(result.merged).toContain('We are glad to have you');
      // Server-controlled updatedAt takes remote value
      expect(result.merged).toContain('2026-02-01');
    });

    it('detects conflict when both sides change the same field', () => {
      const base = makeTemplate();
      const local = makeTemplate({ subject: 'Welcome aboard' });
      const remote = makeTemplate({
        subject: 'Greetings',
        updatedAt: '2026-02-01T00:00:00.000000Z',
      });

      const baseContent = transformEmailTemplateRemoteToLocalFormat(base);
      const localContent = transformEmailTemplateRemoteToLocalFormat(local);
      const remoteContent = transformEmailTemplateRemoteToLocalFormat(remote);

      const result = threeWayMerge(baseContent, localContent, remoteContent);

      expect(result.success).toBe(false);
      expect(result.hasConflicts).toBe(true);
      expect(result.conflictCount).toBeGreaterThanOrEqual(1);
      expect(result.merged).toContain('<<<<<<< local');
      expect(result.merged).toContain('>>>>>>> remote');
    });

    it('auto-resolves server-controlled fields (updatedAt/createdAt) without conflict', () => {
      const base = makeTemplate({
        updatedAt: '2026-01-01T00:00:00.000000Z',
        createdAt: '2026-01-01T00:00:00.000000Z',
      });
      const local = makeTemplate({
        subject: 'Updated locally',
        updatedAt: '2026-01-01T00:00:00.000000Z',
        createdAt: '2026-01-01T00:00:00.000000Z',
      });
      const remote = makeTemplate({
        updatedAt: '2026-02-15T12:00:00.000000Z',
        createdAt: '2026-01-01T00:00:00.000000Z',
      });

      const baseContent = transformEmailTemplateRemoteToLocalFormat(base);
      const localContent = transformEmailTemplateRemoteToLocalFormat(local);
      const remoteContent = transformEmailTemplateRemoteToLocalFormat(remote);

      const result = threeWayMerge(baseContent, localContent, remoteContent);

      // updatedAt differs on both sides but should be auto-resolved as server-controlled
      expect(result.success).toBe(true);
      expect(result.hasConflicts).toBe(false);
      // Remote updatedAt wins
      expect(result.merged).toContain('2026-02-15');
      // Local subject change preserved
      expect(result.merged).toContain('subject: Updated locally');
    });
  });
});
