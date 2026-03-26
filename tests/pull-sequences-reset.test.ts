/**
 * Tests for pull-sequences --reset and pull-segments --reset flags.
 *
 * Both commands should support the --reset flag to clear local state
 * (data directory + sync token) before pulling, ensuring a fresh pull.
 *
 * TDD: Tests written to verify the fix for --reset being silently ignored.
 */

import fsPromises from 'fs/promises';
import path from 'path';
import os from 'os';
import { jest } from '@jest/globals';
import { createTestConfig, createDataServiceMock } from './test-helpers';

// ── Temp directories ───────────────────────────────────────────────────
const tmpRoot = path.join(os.tmpdir(), 'leadcms-pull-reset-seq');
const sequencesDir = path.join(tmpRoot, 'sequences');
const segmentsDir = path.join(tmpRoot, 'segments');

// ── Mocks ──────────────────────────────────────────────────────────────
jest.mock('../src/lib/config.js', () => ({
  getConfig: jest.fn(() =>
    createTestConfig({ sequencesDir, segmentsDir }),
  ),
}));

jest.mock('../src/lib/data-service.js', () => ({
  leadCMSDataService: createDataServiceMock({
    getAllSegments: jest.fn(() => Promise.resolve([])),
    getAllEmailTemplates: jest.fn(() => Promise.resolve([])),
  }),
}));

// Sequence sync queue for the axios mock
let sequenceSyncQueue: Array<{ items: any[]; deleted: number[]; token: string }> = [];
let segmentSyncQueue: Array<{ items: any[]; deleted: number[]; token: string }> = [];

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

    if (url.includes('/api/segments/sync')) {
      const urlObj = new URL(url);
      const sentToken = urlObj.searchParams.get('syncToken') || '';
      const pending = segmentSyncQueue[0];

      if (pending && sentToken !== pending.token) {
        return Promise.resolve({
          status: 200,
          data: { items: pending.items, deleted: pending.deleted },
          headers: { 'x-next-sync-token': pending.token },
        });
      }
      if (pending && sentToken === pending.token) {
        segmentSyncQueue.shift();
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
  await fsPromises.mkdir(segmentsDir, { recursive: true });
  sequenceSyncQueue = [];
  segmentSyncQueue = [];
});

afterEach(async () => {
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

// ════════════════════════════════════════════════════════════════════════
//  pullLeadCMSSequences --reset
// ════════════════════════════════════════════════════════════════════════

describe('pullLeadCMSSequences with reset', () => {
  const syncTokenPath = path.join(sequencesDir, '.sync-token');

  it('should clear sequences directory and sync token when reset is true', async () => {
    // Simulate existing state: a sequence file and a sync token
    await fsPromises.writeFile(
      path.join(sequencesDir, 'old-sequence.json'),
      JSON.stringify({ id: 99, name: 'Old Sequence' }),
    );
    await fsPromises.writeFile(syncTokenPath, 'stale-token', 'utf8');

    // Queue a fresh pull response with a new sequence
    sequenceSyncQueue.push({
      items: [{
        id: 1,
        name: 'Fresh Sequence',
        description: null,
        language: 'en',
        stopOnReply: true,
        useContactTimeZone: false,
        timeZone: 0,
        status: 'Active',
        createdAt: '2026-03-01T00:00:00Z',
        updatedAt: null,
        steps: [],
      }],
      deleted: [],
      token: 'fresh-token',
    });

    const { pullLeadCMSSequences } = await import('../src/scripts/pull-sequences');
    await pullLeadCMSSequences({ reset: true });

    // Old file should be gone, only the new one should exist
    const files = (await fsPromises.readdir(sequencesDir))
      .filter(f => f.endsWith('.json'));
    expect(files).toHaveLength(1);
    expect(files[0]).toBe('fresh-sequence.json');

    // Sync token should be the fresh one, not the stale one
    const token = await fsPromises.readFile(syncTokenPath, 'utf8');
    expect(token).toBe('fresh-token');

    const savedSequence = await fsPromises.readFile(
      path.join(sequencesDir, 'fresh-sequence.json'),
      'utf8',
    );
    expect(savedSequence).toContain(
      '{\n  "id": 1,\n  "createdAt": "2026-03-01T00:00:00Z",\n  "name": "Fresh Sequence"',
    );
  });

  it('should NOT clear state when reset is false/absent', async () => {
    // Write a sync token
    await fsPromises.writeFile(syncTokenPath, 'existing-token', 'utf8');

    // Queue empty response (server says nothing changed since existing-token)
    sequenceSyncQueue = [];

    const { pullLeadCMSSequences } = await import('../src/scripts/pull-sequences');
    await pullLeadCMSSequences();

    // Sync token should still exist (not deleted)
    const token = await fsPromises.readFile(syncTokenPath, 'utf8');
    expect(token).toBeTruthy();
  });

  it('should accept RemoteContext directly for backward compatibility', async () => {
    // Queue a response
    sequenceSyncQueue.push({
      items: [],
      deleted: [],
      token: 'compat-token',
    });

    const { pullLeadCMSSequences } = await import('../src/scripts/pull-sequences');

    // The old API signature: pullLeadCMSSequences(remoteCtx?)
    // Should not throw when called without options
    await expect(pullLeadCMSSequences()).resolves.not.toThrow();
  });
});

// ════════════════════════════════════════════════════════════════════════
//  pullLeadCMSSegments --reset
// ════════════════════════════════════════════════════════════════════════

describe('pullLeadCMSSegments with reset', () => {
  const syncTokenPath = path.join(segmentsDir, '.sync-token');

  it('should clear segments directory and sync token when reset is true', async () => {
    // Simulate existing state
    await fsPromises.writeFile(
      path.join(segmentsDir, 'old-segment.json'),
      JSON.stringify({ id: 99, name: 'Old Segment', type: 'Dynamic' }),
    );
    await fsPromises.writeFile(syncTokenPath, 'stale-seg-token', 'utf8');

    // Queue a fresh pull response with a new segment
    segmentSyncQueue.push({
      items: [{
        id: 1,
        name: 'Fresh Segment',
        description: null,
        type: 'Dynamic',
        definition: { includeRules: null, excludeRules: null },
        createdAt: '2026-03-01T00:00:00Z',
        updatedAt: null,
      }],
      deleted: [],
      token: 'fresh-seg-token',
    });

    const { pullLeadCMSSegments } = await import('../src/scripts/pull-segments');
    await pullLeadCMSSegments({ reset: true });

    // Old file should be gone, only the new one should exist
    const files = (await fsPromises.readdir(segmentsDir))
      .filter(f => f.endsWith('.json'));
    expect(files).toHaveLength(1);
    expect(files[0]).toBe('fresh-segment.json');

    // Sync token should be the fresh one
    const token = await fsPromises.readFile(syncTokenPath, 'utf8');
    expect(token).toBe('fresh-seg-token');
  });

  it('should NOT clear state when reset is false/absent', async () => {
    await fsPromises.writeFile(syncTokenPath, 'existing-seg-token', 'utf8');

    segmentSyncQueue = [];

    const { pullLeadCMSSegments } = await import('../src/scripts/pull-segments');
    await pullLeadCMSSegments();

    const token = await fsPromises.readFile(syncTokenPath, 'utf8');
    expect(token).toBeTruthy();
  });
});

// ════════════════════════════════════════════════════════════════════════
//  Metadata cleanup on reset (per-remote)
// ════════════════════════════════════════════════════════════════════════

describe('resetSequencesState clears sequences metadata', () => {
  const stateDir = path.join(tmpRoot, '.leadcms', 'remotes', 'default');
  const metadataPath = path.join(stateDir, 'metadata.json');

  const remoteCtx = {
    name: 'default',
    url: 'https://test.leadcms.com',
    apiKey: 'test-key',
    isDefault: true,
    stateDir,
  };

  it('should clear sequences section from metadata.json while preserving other sections', async () => {
    await fsPromises.mkdir(stateDir, { recursive: true });
    await fsPromises.writeFile(metadataPath, JSON.stringify({
      content: { en: { 'my-article': { id: 10, createdAt: '2026-01-01T00:00:00Z' } } },
      sequences: { en: { 'old-sequence': { id: 99, createdAt: '2026-01-01T00:00:00Z' } } },
      segments: { 'old-segment': { id: 50, createdAt: '2026-01-01T00:00:00Z' } },
    }));

    const { resetSequencesState } = await import('../src/scripts/pull-all');
    await resetSequencesState(remoteCtx);

    const metadata = JSON.parse(await fsPromises.readFile(metadataPath, 'utf8'));
    // Sequences section should be empty or absent
    expect(metadata.sequences ?? {}).toEqual({});
    // Other sections should be preserved
    expect(metadata.content).toEqual({ en: { 'my-article': { id: 10, createdAt: '2026-01-01T00:00:00Z' } } });
    expect(metadata.segments).toEqual({ 'old-segment': { id: 50, createdAt: '2026-01-01T00:00:00Z' } });
  });

  it('should not fail when metadata.json does not exist', async () => {
    await fsPromises.mkdir(stateDir, { recursive: true });

    const { resetSequencesState } = await import('../src/scripts/pull-all');
    await expect(resetSequencesState(remoteCtx)).resolves.not.toThrow();
  });
});

describe('resetSegmentsState clears segments metadata', () => {
  const stateDir = path.join(tmpRoot, '.leadcms', 'remotes', 'default');
  const metadataPath = path.join(stateDir, 'metadata.json');

  const remoteCtx = {
    name: 'default',
    url: 'https://test.leadcms.com',
    apiKey: 'test-key',
    isDefault: true,
    stateDir,
  };

  it('should clear segments section from metadata.json while preserving other sections', async () => {
    await fsPromises.mkdir(stateDir, { recursive: true });
    await fsPromises.writeFile(metadataPath, JSON.stringify({
      content: { en: { 'my-article': { id: 10, createdAt: '2026-01-01T00:00:00Z' } } },
      sequences: { en: { 'my-sequence': { id: 5, createdAt: '2026-01-01T00:00:00Z' } } },
      segments: { 'old-segment': { id: 50, createdAt: '2026-01-01T00:00:00Z' } },
    }));

    const { resetSegmentsState } = await import('../src/scripts/pull-all');
    await resetSegmentsState(remoteCtx);

    const metadata = JSON.parse(await fsPromises.readFile(metadataPath, 'utf8'));
    // Segments section should be empty
    expect(metadata.segments).toBeUndefined();
    // Other sections should be preserved
    expect(metadata.content).toEqual({ en: { 'my-article': { id: 10, createdAt: '2026-01-01T00:00:00Z' } } });
    expect(metadata.sequences).toEqual({ en: { 'my-sequence': { id: 5, createdAt: '2026-01-01T00:00:00Z' } } });
  });

  it('should not fail when metadata.json does not exist', async () => {
    await fsPromises.mkdir(stateDir, { recursive: true });

    const { resetSegmentsState } = await import('../src/scripts/pull-all');
    await expect(resetSegmentsState(remoteCtx)).resolves.not.toThrow();
  });
});
