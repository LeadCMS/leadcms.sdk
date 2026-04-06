/**
 * Tests for sequence language-based directory routing.
 *
 * Sequences should be stored in language subdirectories when the sequence
 * language differs from the configured defaultLanguage, mirroring the
 * behavior of content files:
 *
 *   defaultLanguage: "en"
 *   - sequence with language "en"    → .leadcms/sequences/my-sequence.json
 *   - sequence with language "en-US" → .leadcms/sequences/en-US/my-sequence.json
 *   - sequence with language "ru-RU" → .leadcms/sequences/ru-RU/my-sequence.json
 *
 * TDD: Tests written first to drive the implementation.
 */

import fsPromises from 'fs/promises';
import path from 'path';
import os from 'os';
import { jest } from '@jest/globals';
import { createTestConfig, createDataServiceMock } from './test-helpers';

// ── Temp directories ───────────────────────────────────────────────────
const tmpRoot = path.join(os.tmpdir(), 'leadcms-seq-lang-dirs');
const sequencesDir = path.join(tmpRoot, 'sequences');

// ── Mocks ──────────────────────────────────────────────────────────────
jest.mock('../src/lib/config.js', () => ({
  getConfig: jest.fn(() =>
    createTestConfig({ sequencesDir, defaultLanguage: 'en' }),
  ),
}));

jest.mock('../src/lib/data-service.js', () => ({
  leadCMSDataService: createDataServiceMock({
    getAllSegments: jest.fn(() => Promise.resolve([])),
    getAllEmailTemplates: jest.fn(() => Promise.resolve([])),
    getAllSequences: jest.fn(() => Promise.resolve([])),
    isApiKeyConfigured: jest.fn(() => true),
  }),
}));

// Sequence sync queue for the axios mock
let sequenceSyncQueue: Array<{ items: any[]; deleted: number[]; token: string }> = [];

jest.mock('axios', () => {
  const mockGet = jest.fn((url: string, _opts?: any) => {
    if (url.includes('/api/sequences/sync')) {
      const urlObj = new URL(url);
      const sentToken = urlObj.searchParams.get('syncToken') || '';
      const pending = sequenceSyncQueue[0];

      if (pending && sentToken !== pending.token) {
        return Promise.resolve({
          status: 200,
          data: { items: pending.items, deleted: pending.deleted },
          headers: { 'x-next-sync-token': pending.token },
        });
      }
      if (pending && sentToken === pending.token) {
        sequenceSyncQueue.shift();
      }
      return Promise.resolve({
        status: 200,
        data: { items: [], deleted: [] },
        headers: { 'x-next-sync-token': sentToken || 'done' },
      });
    }

    return Promise.resolve({ status: 200, data: {}, headers: {} });
  });

  const mockInstance: any = jest.fn(mockGet);
  mockInstance.get = mockGet;
  mockInstance.interceptors = {
    request: { use: jest.fn() },
    response: { use: jest.fn() },
  };
  mockInstance.default = mockInstance;
  return { __esModule: true, default: mockInstance };
});

// ── Setup / Teardown ───────────────────────────────────────────────────
beforeEach(async () => {
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
  await fsPromises.mkdir(sequencesDir, { recursive: true });
  sequenceSyncQueue = [];
});

afterEach(async () => {
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

// ── Helpers ────────────────────────────────────────────────────────────

function makeSequence(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    name: 'Test Sequence',
    description: null,
    language: 'en',
    stopOnReply: true,
    useContactTimeZone: false,
    timeZone: 0,
    status: 'Draft',
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: null,
    steps: [],
    ...overrides,
  };
}

/** Recursively list all .json files relative to a base directory. */
async function listJsonFiles(dir: string, base?: string): Promise<string[]> {
  base = base || dir;
  const files: string[] = [];
  try {
    const entries = await fsPromises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await listJsonFiles(fullPath, base)));
      } else if (entry.name.endsWith('.json')) {
        files.push(path.relative(base, fullPath));
      }
    }
  } catch { /* directory doesn't exist */ }
  return files.sort();
}

// ════════════════════════════════════════════════════════════════════════
//  Pull: language-based directory routing
// ════════════════════════════════════════════════════════════════════════

describe('pull-sequences language directory routing', () => {
  it('should save default-language sequences in the root sequences directory', async () => {
    sequenceSyncQueue.push({
      items: [makeSequence({ id: 1, name: 'Welcome Flow', language: 'en' })],
      deleted: [],
      token: 'tok-1',
    });

    const { pullLeadCMSSequences } = await import('../src/scripts/pull-sequences');
    await pullLeadCMSSequences({ reset: true });

    const files = await listJsonFiles(sequencesDir);
    expect(files).toContain('welcome-flow.json');
    // Should NOT be in a subdirectory
    expect(files.find(f => f.includes('/'))).toBeUndefined();
  });

  it('should save non-default-language sequences in language subdirectories', async () => {
    sequenceSyncQueue.push({
      items: [
        makeSequence({ id: 1, name: 'Welcome Flow', language: 'en-US' }),
        makeSequence({ id: 2, name: 'Onboarding', language: 'ru-RU' }),
      ],
      deleted: [],
      token: 'tok-2',
    });

    const { pullLeadCMSSequences } = await import('../src/scripts/pull-sequences');
    await pullLeadCMSSequences({ reset: true });

    const files = await listJsonFiles(sequencesDir);
    expect(files).toContain(path.join('en-US', 'welcome-flow.json'));
    expect(files).toContain(path.join('ru-RU', 'onboarding.json'));
    // Should NOT be in the root
    expect(files.find(f => !f.includes('/'))).toBeUndefined();
  });

  it('should handle mixed languages: default in root, others in subdirectories', async () => {
    sequenceSyncQueue.push({
      items: [
        makeSequence({ id: 1, name: 'Welcome Flow', language: 'en' }),
        makeSequence({ id: 2, name: 'Welcome Flow', language: 'ru-RU' }),
        makeSequence({ id: 3, name: 'Onboarding', language: 'en-US' }),
      ],
      deleted: [],
      token: 'tok-3',
    });

    const { pullLeadCMSSequences } = await import('../src/scripts/pull-sequences');
    await pullLeadCMSSequences({ reset: true });

    const files = await listJsonFiles(sequencesDir);
    expect(files).toContain('welcome-flow.json');
    expect(files).toContain(path.join('ru-RU', 'welcome-flow.json'));
    expect(files).toContain(path.join('en-US', 'onboarding.json'));
  });

  it('should delete non-default-language sequence files in subdirectories', async () => {
    // First pull: create a sequence
    sequenceSyncQueue.push({
      items: [makeSequence({ id: 1, name: 'Welcome Flow', language: 'ru-RU' })],
      deleted: [],
      token: 'tok-4a',
    });

    const { pullLeadCMSSequences } = await import('../src/scripts/pull-sequences');
    await pullLeadCMSSequences({ reset: true });

    let files = await listJsonFiles(sequencesDir);
    expect(files).toContain(path.join('ru-RU', 'welcome-flow.json'));

    // Second pull: delete it
    sequenceSyncQueue.push({
      items: [],
      deleted: [1],
      token: 'tok-4b',
    });

    await pullLeadCMSSequences();

    files = await listJsonFiles(sequencesDir);
    expect(files.find(f => f.includes('welcome-flow.json'))).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════
//  Push: reading sequences from language subdirectories
// ════════════════════════════════════════════════════════════════════════

describe('push-sequences reads from language subdirectories', () => {
  it('should discover sequences in both root and language subdirectories', async () => {
    // Create sequences in various locations
    const rootSeq = {
      id: 1,
      name: 'Welcome Flow',
      language: 'en',
      steps: [],
    };
    const ruSeq = {
      id: 2,
      name: 'Welcome Flow',
      language: 'ru-RU',
      steps: [],
    };
    const enUsSeq = {
      id: 3,
      name: 'Onboarding',
      language: 'en-US',
      steps: [],
    };

    await fsPromises.writeFile(
      path.join(sequencesDir, 'welcome-flow.json'),
      JSON.stringify(rootSeq, null, 2),
    );
    await fsPromises.mkdir(path.join(sequencesDir, 'ru-RU'), { recursive: true });
    await fsPromises.writeFile(
      path.join(sequencesDir, 'ru-RU', 'welcome-flow.json'),
      JSON.stringify(ruSeq, null, 2),
    );
    await fsPromises.mkdir(path.join(sequencesDir, 'en-US'), { recursive: true });
    await fsPromises.writeFile(
      path.join(sequencesDir, 'en-US', 'onboarding.json'),
      JSON.stringify(enUsSeq, null, 2),
    );

    const { buildSequenceStatus } = await import('../src/scripts/push-sequences');
    const result = await buildSequenceStatus({});

    expect(result.totalLocal).toBe(3);
  });
});

// ════════════════════════════════════════════════════════════════════════
//  getSequenceFilePath: exported function unit test
// ════════════════════════════════════════════════════════════════════════

describe('getSequenceFilePath language routing', () => {
  it('should return root path for default language', async () => {
    const { getSequenceFilePath } = await import('../src/scripts/pull-sequences');
    const filePath = getSequenceFilePath({
      name: 'My Sequence',
      language: 'en',
    } as any);
    expect(filePath).toBe(path.join(sequencesDir, 'my-sequence.json'));
  });

  it('should return language subdirectory path for non-default language', async () => {
    const { getSequenceFilePath } = await import('../src/scripts/pull-sequences');
    const filePath = getSequenceFilePath({
      name: 'My Sequence',
      language: 'ru-RU',
    } as any);
    expect(filePath).toBe(path.join(sequencesDir, 'ru-RU', 'my-sequence.json'));
  });

  it('should return language subdirectory path for en-US when default is en', async () => {
    const { getSequenceFilePath } = await import('../src/scripts/pull-sequences');
    const filePath = getSequenceFilePath({
      name: 'My Sequence',
      language: 'en-US',
    } as any);
    expect(filePath).toBe(path.join(sequencesDir, 'en-US', 'my-sequence.json'));
  });
});
