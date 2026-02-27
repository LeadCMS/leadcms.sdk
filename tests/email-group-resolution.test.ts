import { jest } from '@jest/globals';

// Mock the data service before importing the module under test
const mockCreateEmailGroup = jest.fn<(data: { name: string; language: string }) => Promise<any>>();

jest.mock('../src/lib/data-service.js', () => ({
  leadCMSDataService: {
    createEmailGroup: mockCreateEmailGroup,
    isApiKeyConfigured: jest.fn(() => true),
  },
}));

import {
  normalizeGroupKey,
  resolveEmailGroupId,
  buildGroupIndex,
  createMissingEmailGroups,
  getEffectiveGroupName,
} from '../src/scripts/push-email-templates';
import type { EmailGroupItem, LocalEmailTemplateItem } from '../src/scripts/push-email-templates';

function makeLocalTemplate(overrides: Partial<LocalEmailTemplateItem> = {}): LocalEmailTemplateItem {
  return {
    filePath: '/tmp/test/template.html',
    locale: 'en',
    groupFolder: 'notifications',
    metadata: {
      name: 'Welcome',
      subject: 'Hello',
      fromEmail: 'team@example.com',
      fromName: 'Team',
      language: 'en',
    },
    body: '<body>Hello</body>',
    ...overrides,
  };
}

function makeGroup(overrides: Partial<EmailGroupItem> = {}): EmailGroupItem {
  return {
    id: 1,
    name: 'Notifications',
    language: 'en',
    ...overrides,
  };
}

describe('normalizeGroupKey', () => {
  it('normalizes ASCII group names to lowercase with hyphens', () => {
    expect(normalizeGroupKey('Notifications')).toBe('notifications');
    expect(normalizeGroupKey('User Emails')).toBe('user-emails');
    expect(normalizeGroupKey('  Some Group  ')).toBe('some-group');
  });

  it('handles Cyrillic group names', () => {
    const result = normalizeGroupKey('По запросу');
    expect(result).toBe('по-запросу');
    expect(result.length).toBeGreaterThan(0);
  });

  it('handles Cyrillic group name with multiple words', () => {
    const result = normalizeGroupKey('Онбординг при регистрации');
    expect(result).toBe('онбординг-при-регистрации');
    expect(result.length).toBeGreaterThan(0);
  });

  it('handles Chinese characters', () => {
    const result = normalizeGroupKey('通知邮件');
    expect(result).toBe('通知邮件');
    expect(result.length).toBeGreaterThan(0);
  });

  it('handles Japanese characters', () => {
    const result = normalizeGroupKey('メール通知');
    expect(result).toBe('メール通知');
    expect(result.length).toBeGreaterThan(0);
  });

  it('handles mixed Latin and non-Latin characters', () => {
    const result = normalizeGroupKey('Email По запросу');
    expect(result).toBe('email-по-запросу');
    expect(result.length).toBeGreaterThan(0);
  });

  it('collapses multiple spaces and underscores into single hyphens', () => {
    expect(normalizeGroupKey('some   group')).toBe('some-group');
    expect(normalizeGroupKey('some_group')).toBe('some-group');
    expect(normalizeGroupKey('some _ group')).toBe('some-group');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeGroupKey('')).toBe('');
    expect(normalizeGroupKey('   ')).toBe('');
  });
});

describe('buildGroupIndex', () => {
  it('indexes groups by normalized key', () => {
    const groups: EmailGroupItem[] = [
      makeGroup({ id: 1, name: 'Notifications', language: 'en' }),
      makeGroup({ id: 2, name: 'Notifications', language: 'ru-RU' }),
    ];

    const index = buildGroupIndex(groups);
    expect(index.has('notifications')).toBe(true);
    expect(index.get('notifications')).toHaveLength(2);
  });

  it('indexes Cyrillic group names correctly', () => {
    const groups: EmailGroupItem[] = [
      makeGroup({ id: 1, name: 'По запросу', language: 'ru-RU' }),
      makeGroup({ id: 2, name: 'Онбординг при регистрации', language: 'ru-RU' }),
    ];

    const index = buildGroupIndex(groups);
    expect(index.has('по-запросу')).toBe(true);
    expect(index.get('по-запросу')).toHaveLength(1);
    expect(index.has('онбординг-при-регистрации')).toBe(true);
    expect(index.get('онбординг-при-регистрации')).toHaveLength(1);
  });

  it('skips groups with empty names', () => {
    const groups: EmailGroupItem[] = [
      makeGroup({ id: 1, name: '', language: 'en' }),
    ];

    const index = buildGroupIndex(groups);
    expect(index.size).toBe(0);
  });
});

describe('resolveEmailGroupId', () => {
  it('returns existing emailGroupId from metadata if present', () => {
    const template = makeLocalTemplate({
      metadata: { emailGroupId: 42 },
    });
    const index = new Map<string, EmailGroupItem[]>();

    expect(resolveEmailGroupId(template, index)).toBe(42);
  });

  it('resolves group by groupName in metadata', () => {
    const template = makeLocalTemplate({
      metadata: { groupName: 'Notifications' },
    });
    const index = buildGroupIndex([
      makeGroup({ id: 10, name: 'Notifications', language: 'en' }),
    ]);

    expect(resolveEmailGroupId(template, index)).toBe(10);
  });

  it('resolves Cyrillic group by groupName in metadata', () => {
    const template = makeLocalTemplate({
      locale: 'ru-RU',
      metadata: { groupName: 'По запросу' },
    });
    const index = buildGroupIndex([
      makeGroup({ id: 15, name: 'По запросу', language: 'ru-RU' }),
    ]);

    expect(resolveEmailGroupId(template, index)).toBe(15);
  });

  it('resolves group by folder name fallback', () => {
    const template = makeLocalTemplate({
      groupFolder: 'По запросу',
      locale: 'ru-RU',
      metadata: {},
    });
    const index = buildGroupIndex([
      makeGroup({ id: 20, name: 'По запросу', language: 'ru-RU' }),
    ]);

    expect(resolveEmailGroupId(template, index)).toBe(20);
  });

  it('returns null when group does not exist in index', () => {
    const template = makeLocalTemplate({
      metadata: { groupName: 'Nonexistent' },
    });
    const index = new Map<string, EmailGroupItem[]>();

    expect(resolveEmailGroupId(template, index)).toBeNull();
  });

  it('prefers locale-matched group over any-locale fallback', () => {
    const template = makeLocalTemplate({
      locale: 'ru-RU',
      metadata: { groupName: 'По запросу' },
    });
    const index = buildGroupIndex([
      makeGroup({ id: 30, name: 'По запросу', language: 'en' }),
      makeGroup({ id: 31, name: 'По запросу', language: 'ru-RU' }),
    ]);

    expect(resolveEmailGroupId(template, index)).toBe(31);
  });
});

describe('getEffectiveGroupName', () => {
  it('returns groupName from metadata when present', () => {
    const template = makeLocalTemplate({
      metadata: { groupName: 'По запросу' },
    });
    expect(getEffectiveGroupName(template)).toBe('По запросу');
  });

  it('falls back to groupFolder', () => {
    const template = makeLocalTemplate({
      groupFolder: 'Онбординг при регистрации',
      metadata: {},
    });
    expect(getEffectiveGroupName(template)).toBe('Онбординг при регистрации');
  });

  it('returns null for ungrouped templates', () => {
    const template = makeLocalTemplate({
      groupFolder: 'ungrouped',
      metadata: {},
    });
    expect(getEffectiveGroupName(template)).toBeNull();
  });
});

describe('createMissingEmailGroups', () => {
  beforeEach(() => {
    mockCreateEmailGroup.mockReset();
  });

  it('creates missing email groups for Cyrillic names', async () => {
    const templates: LocalEmailTemplateItem[] = [
      makeLocalTemplate({
        locale: 'ru-RU',
        groupFolder: 'По запросу',
        metadata: { name: 'WS_Register', groupName: 'По запросу', language: 'ru-RU' },
      }),
    ];

    const groupIndex = new Map<string, EmailGroupItem[]>();

    mockCreateEmailGroup.mockResolvedValue({
      id: 100,
      name: 'По запросу',
      language: 'ru-RU',
    });

    const created = await createMissingEmailGroups(templates, groupIndex, false);

    expect(created).toHaveLength(1);
    expect(created[0].id).toBe(100);
    expect(created[0].name).toBe('По запросу');
    expect(mockCreateEmailGroup).toHaveBeenCalledWith({
      name: 'По запросу',
      language: 'ru-RU',
    });

    // Verify the index was updated
    expect(groupIndex.has('по-запросу')).toBe(true);
    expect(groupIndex.get('по-запросу')![0].id).toBe(100);
  });

  it('creates multiple missing Cyrillic groups', async () => {
    const templates: LocalEmailTemplateItem[] = [
      makeLocalTemplate({
        locale: 'ru-RU',
        metadata: { name: 'Template1', groupName: 'По запросу', language: 'ru-RU' },
      }),
      makeLocalTemplate({
        locale: 'ru-RU',
        metadata: { name: 'Template2', groupName: 'Онбординг при регистрации', language: 'ru-RU' },
      }),
    ];

    const groupIndex = new Map<string, EmailGroupItem[]>();

    mockCreateEmailGroup
      .mockResolvedValueOnce({ id: 100, name: 'По запросу', language: 'ru-RU' })
      .mockResolvedValueOnce({ id: 101, name: 'Онбординг при регистрации', language: 'ru-RU' });

    const created = await createMissingEmailGroups(templates, groupIndex, false);

    expect(created).toHaveLength(2);
    expect(mockCreateEmailGroup).toHaveBeenCalledTimes(2);
  });

  it('does not create groups that already exist in the index', async () => {
    const templates: LocalEmailTemplateItem[] = [
      makeLocalTemplate({
        locale: 'ru-RU',
        metadata: { name: 'WS_Register', groupName: 'По запросу', language: 'ru-RU' },
      }),
    ];

    const existingGroup = makeGroup({ id: 50, name: 'По запросу', language: 'ru-RU' });
    const groupIndex = buildGroupIndex([existingGroup]);

    const created = await createMissingEmailGroups(templates, groupIndex, false);

    expect(created).toHaveLength(0);
    expect(mockCreateEmailGroup).not.toHaveBeenCalled();
  });

  it('does not create groups in dry-run mode', async () => {
    const templates: LocalEmailTemplateItem[] = [
      makeLocalTemplate({
        locale: 'ru-RU',
        metadata: { name: 'WS_Register', groupName: 'По запросу', language: 'ru-RU' },
      }),
    ];

    const groupIndex = new Map<string, EmailGroupItem[]>();

    const created = await createMissingEmailGroups(templates, groupIndex, true);

    expect(created).toHaveLength(0);
    expect(mockCreateEmailGroup).not.toHaveBeenCalled();
  });

  it('deduplicates groups — creates each missing group only once', async () => {
    const templates: LocalEmailTemplateItem[] = [
      makeLocalTemplate({
        locale: 'ru-RU',
        metadata: { name: 'Template1', groupName: 'По запросу', language: 'ru-RU' },
      }),
      makeLocalTemplate({
        locale: 'ru-RU',
        metadata: { name: 'Template2', groupName: 'По запросу', language: 'ru-RU' },
      }),
      makeLocalTemplate({
        locale: 'ru-RU',
        metadata: { name: 'Template3', groupName: 'По запросу', language: 'ru-RU' },
      }),
    ];

    const groupIndex = new Map<string, EmailGroupItem[]>();

    mockCreateEmailGroup.mockResolvedValue({
      id: 100,
      name: 'По запросу',
      language: 'ru-RU',
    });

    const created = await createMissingEmailGroups(templates, groupIndex, false);

    expect(created).toHaveLength(1);
    expect(mockCreateEmailGroup).toHaveBeenCalledTimes(1);
  });

  it('handles API error gracefully during group creation', async () => {
    const templates: LocalEmailTemplateItem[] = [
      makeLocalTemplate({
        locale: 'ru-RU',
        metadata: { name: 'WS_Register', groupName: 'По запросу', language: 'ru-RU' },
      }),
    ];

    const groupIndex = new Map<string, EmailGroupItem[]>();

    mockCreateEmailGroup.mockRejectedValue(new Error('API error'));

    const created = await createMissingEmailGroups(templates, groupIndex, false);

    expect(created).toHaveLength(0);
    expect(mockCreateEmailGroup).toHaveBeenCalledTimes(1);
  });
});

describe('end-to-end: Cyrillic group resolution after creation', () => {
  beforeEach(() => {
    mockCreateEmailGroup.mockReset();
  });

  it('templates can resolve emailGroupId after groups are created', async () => {
    // Simulate the push flow: create groups, then resolve IDs
    const templates: LocalEmailTemplateItem[] = [
      makeLocalTemplate({
        locale: 'ru-RU',
        groupFolder: 'По запросу',
        metadata: { name: 'WS_Register', groupName: 'По запросу', language: 'ru-RU' },
      }),
      makeLocalTemplate({
        locale: 'ru-RU',
        groupFolder: 'Онбординг при регистрации',
        metadata: { name: 'WS_Onboarding', groupName: 'Онбординг при регистрации', language: 'ru-RU' },
      }),
    ];

    const groupIndex = new Map<string, EmailGroupItem[]>();

    mockCreateEmailGroup
      .mockResolvedValueOnce({ id: 100, name: 'По запросу', language: 'ru-RU' })
      .mockResolvedValueOnce({ id: 101, name: 'Онбординг при регистрации', language: 'ru-RU' });

    await createMissingEmailGroups(templates, groupIndex, false);

    // Now resolve group IDs — should find the newly created groups
    const id1 = resolveEmailGroupId(templates[0], groupIndex);
    const id2 = resolveEmailGroupId(templates[1], groupIndex);

    expect(id1).toBe(100);
    expect(id2).toBe(101);
  });

  it('templates can resolve emailGroupId by folder name for Cyrillic folders', async () => {
    const template = makeLocalTemplate({
      locale: 'ru-RU',
      groupFolder: 'По запросу',
      metadata: { name: 'WS_Register', language: 'ru-RU' },
      // No groupName in metadata — falls back to folder name
    });

    const groupIndex = new Map<string, EmailGroupItem[]>();

    mockCreateEmailGroup.mockResolvedValueOnce({
      id: 200,
      name: 'По запросу',
      language: 'ru-RU',
    });

    await createMissingEmailGroups([template], groupIndex, false);

    const resolvedId = resolveEmailGroupId(template, groupIndex);
    expect(resolvedId).toBe(200);
  });
});
