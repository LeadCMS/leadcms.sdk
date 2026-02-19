/**
 * Shared test utilities and mock factories for LeadCMS SDK tests.
 *
 * Provides:
 *  - createTestConfig / createDataServiceMock / createAxiosMock — low-level mocks
 *  - createSyncTestHarness — high-level harness for pull integration tests
 *  - listContentFiles / listAllFiles — filesystem assertions
 *
 * Usage (pull integration test):
 *
 *   const harness = createSyncTestHarness({ contentDir, mediaDir });
 *   jest.mock('../src/lib/config.js', () => ({
 *     getConfig: jest.fn(() => harness.config),
 *   }));
 *   jest.mock('axios', () => harness.axiosMock);
 *
 *   // in test:
 *   harness.addContentSync([item], [], 'token-1');
 *   await fetchLeadCMSContent();
 */

import path from 'path';
import fs from 'fs/promises';

// ── Low-level mock factories ───────────────────────────────────────────

/**
 * Create a standard config mock object.
 * Matches the shape returned by getConfig() in src/lib/config.ts.
 */
export function createTestConfig(overrides: Record<string, any> = {}) {
  return {
    url: 'https://test.leadcms.com',
    apiKey: 'test-key',
    defaultLanguage: 'en',
    contentDir: '/tmp/test-content',
    mediaDir: '/tmp/test-media',
    commentsDir: '/tmp/test-comments',
    emailTemplatesDir: '/tmp/test-email-templates',
    ...overrides,
  };
}

/**
 * Create a standard leadCMSDataService mock.
 * Prevents real API calls during testing.
 */
export function createDataServiceMock(overrides: Record<string, any> = {}) {
  return {
    getAllContent: jest.fn(() => Promise.resolve([])),
    getContentTypes: jest.fn(() => Promise.resolve([])),
    isMockMode: jest.fn(() => true),
    ...overrides,
  };
}

/**
 * Create a basic axios mock with interceptors support.
 * Use this for unit tests that just need to prevent real HTTP calls.
 * For pull integration tests, use createSyncTestHarness() instead.
 */
export function createAxiosMock() {
  const mockAxios: any = jest.fn(() => Promise.resolve({ data: [] }));
  mockAxios.get = jest.fn(() => Promise.resolve({ data: [], headers: {} }));
  mockAxios.post = jest.fn(() => Promise.resolve({ data: {} }));
  mockAxios.interceptors = {
    request: { use: jest.fn() },
    response: { use: jest.fn() },
  };
  mockAxios.default = mockAxios;
  return { __esModule: true, default: mockAxios };
}

// ── Filesystem helpers ─────────────────────────────────────────────────

/**
 * Recursively list all .mdx / .json content files in a directory.
 */
export async function listContentFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await listContentFiles(fullPath)));
      } else if (entry.name.endsWith('.mdx') || entry.name.endsWith('.json')) {
        files.push(fullPath);
      }
    }
  } catch {
    // directory doesn't exist yet
  }
  return files;
}

/**
 * Recursively list ALL files in a directory (any extension).
 */
export async function listAllFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await listAllFiles(fullPath)));
      } else {
        files.push(fullPath);
      }
    }
  } catch {
    // directory doesn't exist
  }
  return files;
}

// ── Pull sync test harness ─────────────────────────────────────────────

interface SyncTestHarnessOptions {
  contentDir: string;
  mediaDir: string;
  commentsDir?: string;
  /** Content types the mock API returns. Defaults to article(MDX), component(JSON), page(MDX). */
  contentTypes?: Array<{ uid: string; format: string }>;
  /** Extra config overrides merged into createTestConfig(). */
  configOverrides?: Record<string, any>;
}

/**
 * High-level harness for pull integration tests.
 *
 * Encapsulates all mocking logic (config, axios routing, sync queue management,
 * sync token cleanup) so that test files only deal with test data and assertions.
 *
 * Usage:
 *   const harness = createSyncTestHarness({ contentDir, mediaDir });
 *
 *   // Pass to jest.mock (at module level — these are captured by reference):
 *   jest.mock('../src/lib/config.js', () => ({
 *     getConfig: jest.fn(() => harness.config),
 *   }));
 *   jest.mock('axios', () => harness.axiosMock);
 *
 *   // In beforeEach:
 *   await harness.setup();
 *
 *   // In afterEach:
 *   await harness.cleanup();
 *
 *   // In each test:
 *   harness.addContentSync([item1, item2], [deletedId], 'token-1');
 *   await fetchLeadCMSContent();
 */
export function createSyncTestHarness(options: SyncTestHarnessOptions) {
  const {
    contentDir,
    mediaDir,
    commentsDir = path.join(path.dirname(contentDir), 'comments'),
    contentTypes = [
      { uid: 'article', format: 'MDX' },
      { uid: 'component', format: 'JSON' },
      { uid: 'page', format: 'MDX' },
    ],
    configOverrides = {},
  } = options;

  const tmpRoot = path.dirname(contentDir);

  // ── Internal state (mutated by helper methods, read by axios mock) ──
  const state = {
    contentSyncQueue: [] as Array<{ items: any[]; deleted: number[]; token: string }>,
    mediaSyncQueue: [] as Array<{ items: any[]; deleted: any[]; token: string }>,
    contentTypes: [...contentTypes],
  };

  // ── Config object (stable reference, captured by jest.mock factory) ──
  const config = createTestConfig({
    contentDir,
    mediaDir,
    commentsDir,
    emailTemplatesDir: path.join(tmpRoot, 'email-templates'),
    ...configOverrides,
  });

  // ── Axios mock with URL-based routing ───────────────────────────────
  const mockGet = jest.fn((url: string, _opts?: any) => {
    if (url.includes('/api/config')) {
      return Promise.resolve({
        status: 200,
        data: { entities: ['Content', 'Media'] },
        headers: {},
      });
    }

    if (url.includes('/api/content-types')) {
      return Promise.resolve({
        status: 200,
        data: state.contentTypes,
        headers: {},
      });
    }

    if (url.includes('/api/content/sync')) {
      const urlObj = new URL(url);
      const sentToken = urlObj.searchParams.get('syncToken') || '';
      const pending = state.contentSyncQueue[0];

      if (pending && sentToken !== pending.token) {
        return Promise.resolve({
          status: 200,
          data: { items: pending.items, deleted: pending.deleted },
          headers: { 'x-next-sync-token': pending.token },
        });
      }
      if (pending && sentToken === pending.token) {
        state.contentSyncQueue.shift();
      }
      return Promise.resolve({
        status: 200,
        data: { items: [], deleted: [] },
        headers: { 'x-next-sync-token': sentToken || 'done' },
      });
    }

    if (url.includes('/api/media/sync')) {
      const urlObj = new URL(url);
      const sentToken = urlObj.searchParams.get('syncToken') || '';
      const pending = state.mediaSyncQueue[0];

      if (pending && sentToken !== pending.token) {
        return Promise.resolve({
          status: 200,
          data: { items: pending.items, deleted: pending.deleted },
          headers: { 'x-next-sync-token': pending.token },
        });
      }
      if (pending && sentToken === pending.token) {
        state.mediaSyncQueue.shift();
      }
      return Promise.resolve({
        status: 200,
        data: { items: [], deleted: [] },
        headers: { 'x-next-sync-token': sentToken || 'done' },
      });
    }

    return Promise.resolve({ status: 200, data: {}, headers: {} });
  });

  // Media file download mock — handles direct media file requests (not /api/media/sync)
  // downloadMediaFileDirect uses axios.get with responseType: 'arraybuffer'
  const mockGetWithMediaDownload = jest.fn((url: string, opts?: any) => {
    // If it's a media file download (arraybuffer), return a Buffer
    if (opts?.responseType === 'arraybuffer') {
      return Promise.resolve({
        status: 200,
        data: Buffer.from('mock-media-data'),
        headers: {},
      });
    }
    return mockGet(url, opts);
  });

  const mockAxiosInstance: any = jest.fn(mockGetWithMediaDownload);
  mockAxiosInstance.get = mockGetWithMediaDownload;
  mockAxiosInstance.interceptors = {
    request: { use: jest.fn() },
    response: { use: jest.fn() },
  };
  mockAxiosInstance.default = mockAxiosInstance;

  const axiosMock = { __esModule: true, default: mockAxiosInstance };

  // ── Sync token file paths (inside data directories, matching the SDK) ──
  const syncTokenPath = path.join(contentDir, '.sync-token');
  const mediaSyncTokenPath = path.join(mediaDir, '.sync-token');

  // Legacy sync token paths (SDK ≤ 3.2, in parent of contentDir)
  const legacySyncTokenPath = path.join(path.dirname(contentDir), 'sync-token.txt');
  const legacyMediaSyncTokenPath = path.join(path.dirname(contentDir), 'media-sync-token.txt');

  return {
    /** Config object — pass to jest.mock factory: `getConfig: () => harness.config` */
    config,

    /** Axios mock module — pass to jest.mock factory: `jest.mock('axios', () => harness.axiosMock)` */
    axiosMock,

    /** Queue a content sync response for the next pull call. */
    addContentSync(items: any[], deleted: number[], token: string) {
      state.contentSyncQueue.push({ items, deleted, token });
    },

    /** Queue a media sync response for the next pull call. */
    addMediaSync(items: any[], deleted: any[], token: string) {
      state.mediaSyncQueue.push({ items, deleted, token });
    },

    /** Set the content types the mock API will return. */
    setContentTypes(types: Array<{ uid: string; format: string }>) {
      state.contentTypes.length = 0;
      state.contentTypes.push(...types);
    },

    /**
     * Create temp directories and clear sync tokens & queues.
     * Call in beforeEach().
     */
    async setup() {
      await fs.rm(tmpRoot, { recursive: true, force: true });
      await fs.mkdir(contentDir, { recursive: true });
      await fs.mkdir(mediaDir, { recursive: true });
      state.contentSyncQueue.length = 0;
      state.mediaSyncQueue.length = 0;
      // Clean up both new and legacy sync token locations
      try { await fs.unlink(syncTokenPath); } catch { /* not found */ }
      try { await fs.unlink(mediaSyncTokenPath); } catch { /* not found */ }
      try { await fs.unlink(legacySyncTokenPath); } catch { /* not found */ }
      try { await fs.unlink(legacyMediaSyncTokenPath); } catch { /* not found */ }
    },

    /**
     * Remove temp directories and sync tokens.
     * Call in afterEach().
     */
    async cleanup() {
      await fs.rm(tmpRoot, { recursive: true, force: true });
      try { await fs.unlink(syncTokenPath); } catch { /* not found */ }
      try { await fs.unlink(mediaSyncTokenPath); } catch { /* not found */ }
      try { await fs.unlink(legacySyncTokenPath); } catch { /* not found */ }
      try { await fs.unlink(legacyMediaSyncTokenPath); } catch { /* not found */ }
    },
  };
}
