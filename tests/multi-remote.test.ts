/**
 * Tests for multi-remote support (Phases 2–5).
 *
 * Covers:
 * - MetadataMap read/write helpers (remote-context.ts)
 * - matchContent with metadata-map (push-leadcms-content.ts)
 * - updateLocalMetadata conditional frontmatter writes
 * - parseRemoteFlag auto-resolve in multi-remote mode
 */

import { jest } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import matter from 'gray-matter';

import {
  resolveRemote,
  lookupRemoteId,
  setRemoteId,
  lookupEmailTemplateRemoteId,
  setEmailTemplateRemoteId,
  lookupCommentRemoteId,
  setCommentRemoteId,
  getMetadataForComment,
  setMetadataForComment,
  commentKey,
  readMetadataMap,
  writeMetadataMap,
  getMetadataForContent,
  setMetadataForContent,
  contentKey,
  type RemoteContext,
  type MetadataMap,
} from '../src/lib/remote-context';

import { createTestConfig, createDataServiceMock } from './test-helpers';

// ── Helpers ────────────────────────────────────────────────────────────

function makeRemoteCtx(overrides: Partial<RemoteContext> & { stateDir: string }): RemoteContext {
  return {
    name: 'test-remote',
    url: 'https://test.leadcms.com',
    apiKey: 'test-key',
    isDefault: true,
    ...overrides,
  };
}

function makeLocal(overrides: Partial<any> & { slug: string }) {
  return {
    filePath: `/tmp/test-content/${overrides.slug}.mdx`,
    locale: 'en',
    type: overrides.metadata?.type || overrides.type || 'article',
    body: '# Test content',
    metadata: { type: overrides.type || 'article' },
    isLocal: true,
    ...overrides,
  };
}

function makeRemote(overrides: Partial<any> & { id: number; slug: string }) {
  return {
    type: 'article',
    language: 'en',
    title: 'Remote Article',
    body: '# Test content',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    isLocal: false,
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════════════
// Phase 3: remote ID helpers in metadata.json
// ══════════════════════════════════════════════════════════════════════

describe('Remote ID helpers in metadata.json (Phase 3)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'leadcms-metaid-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('readMetadataMap / writeMetadataMap with ids', () => {
    it('returns empty map when file does not exist', async () => {
      const ctx = makeRemoteCtx({ stateDir: path.join(tmpDir, 'nonexistent') });
      const map = await readMetadataMap(ctx);
      expect(map).toEqual({ content: {}, emailTemplates: {}, comments: {}, segments: {}, sequences: {} });
    });

    it('round-trips through write and read', async () => {
      const ctx = makeRemoteCtx({ stateDir: tmpDir });
      const map: MetadataMap = {
        content: {
          en: { 'hello-world': { id: 42 } },
          fr: { bonjour: { id: 99 } },
        },
      };
      await writeMetadataMap(ctx, map);
      const read = await readMetadataMap(ctx);
      expect(read).toEqual({ ...map, emailTemplates: {}, comments: {}, segments: {}, sequences: {} });
    });

    it('creates state directory when writing', async () => {
      const nestedDir = path.join(tmpDir, 'deep', 'nested');
      const ctx = makeRemoteCtx({ stateDir: nestedDir });
      await writeMetadataMap(ctx, { content: { en: { test: { id: 1 } } } });
      const stat = await fs.stat(nestedDir);
      expect(stat.isDirectory()).toBe(true);
    });

    it('deduplicates on read: keeps last key for a duplicate id', async () => {
      const ctx = makeRemoteCtx({ stateDir: tmpDir });
      // Write a map with two keys claiming same id (simulates corruption)
      const raw = {
        content: {
          'ru-RU': {
            offices: { id: 132 },
            reports: { id: 132 },
            other: { id: 7 },
          },
        },
        emailTemplates: {},
      };
      await fs.writeFile(path.join(tmpDir, 'metadata.json'), JSON.stringify(raw, null, 2));

      const map = await readMetadataMap(ctx);
      // Only the last key for id=132 should survive
      const ruContent = map.content['ru-RU'] || {};
      const keysFor132 = Object.entries(ruContent).filter(([, entry]) => entry.id === 132);
      expect(keysFor132).toHaveLength(1);
      expect(keysFor132[0][0]).toBe('reports');
      // Other entries are preserved
      expect(ruContent['other']?.id).toBe(7);
    });
  });

  describe('lookupRemoteId / setRemoteId', () => {
    it('returns undefined for unmapped content', () => {
      const map: MetadataMap = { content: {} };
      expect(lookupRemoteId(map, 'en', 'nope')).toBeUndefined();
    });

    it('looks up by language/slug', () => {
      const map: MetadataMap = { content: { en: { hello: { id: 42 } } } };
      expect(lookupRemoteId(map, 'en', 'hello')).toBe(42);
    });

    it('sets and retrieves an id', () => {
      const map: MetadataMap = { content: {} };
      setRemoteId(map, 'en', 'my-post', 77);
      expect(lookupRemoteId(map, 'en', 'my-post')).toBe(77);
    });

    it('overwrites existing id', () => {
      const map: MetadataMap = { content: { en: { 'my-post': { id: 10 } } } };
      setRemoteId(map, 'en', 'my-post', 20);
      expect(lookupRemoteId(map, 'en', 'my-post')).toBe(20);
    });

    it('removes stale entry when another key already claims the same id', () => {
      const map: MetadataMap = { content: { 'ru-RU': { offices: { id: 132 } } } };
      // A different slug is now assigned id 132 — the old entry must be removed
      setRemoteId(map, 'ru-RU', 'reports', 132);
      expect(lookupRemoteId(map, 'ru-RU', 'reports')).toBe(132);
      expect(lookupRemoteId(map, 'ru-RU', 'offices')).toBeUndefined();
    });

    it('does not remove entries with different ids', () => {
      const map: MetadataMap = {
        content: { en: { a: { id: 1 }, b: { id: 2 }, c: { id: 3 } } },
      };
      setRemoteId(map, 'en', 'd', 4);
      expect(Object.keys(map.content.en)).toHaveLength(4);
    });
  });

  describe('setEmailTemplateRemoteId deduplication', () => {
    it('removes stale email template entry when id is reassigned', () => {
      const map: MetadataMap = {
        content: {},
        emailTemplates: { 'ru-RU': { OldName: { id: 5 } } },
      };
      setEmailTemplateRemoteId(map, 'ru-RU', 'NewName', 5);
      expect(lookupEmailTemplateRemoteId(map, 'ru-RU', 'NewName')).toBe(5);
      expect(lookupEmailTemplateRemoteId(map, 'ru-RU', 'OldName')).toBeUndefined();
    });
  });
});

// ══════════════════════════════════════════════════════════════════════
// Phase 4: Metadata Map helpers
// ══════════════════════════════════════════════════════════════════════

describe('MetadataMap helpers (Phase 4)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'leadcms-meta-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('readMetadataMap / writeMetadataMap', () => {
    it('returns empty map when file does not exist', async () => {
      const ctx = makeRemoteCtx({ stateDir: path.join(tmpDir, 'nonexistent') });
      const map = await readMetadataMap(ctx);
      expect(map).toEqual({ content: {}, emailTemplates: {}, comments: {}, segments: {}, sequences: {} });
    });

    it('round-trips through write and read', async () => {
      const ctx = makeRemoteCtx({ stateDir: tmpDir });
      const map: MetadataMap = {
        content: {
          en: {
            hello: { createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-06-15T12:00:00Z' },
          },
        },
      };
      await writeMetadataMap(ctx, map);
      const read = await readMetadataMap(ctx);
      expect(read).toEqual({ ...map, emailTemplates: {}, comments: {}, segments: {}, sequences: {} });
    });
  });

  describe('getMetadataForContent / setMetadataForContent', () => {
    it('returns undefined for unmapped content', () => {
      const map: MetadataMap = { content: {} };
      expect(getMetadataForContent(map, 'en', 'nope')).toBeUndefined();
    });

    it('sets and retrieves metadata entry', () => {
      const map: MetadataMap = { content: {} };
      const entry = { createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-06-15T12:00:00Z' };
      setMetadataForContent(map, 'en', 'my-post', entry);
      expect(getMetadataForContent(map, 'en', 'my-post')).toEqual(entry);
    });

    it('overwrites existing metadata', () => {
      const map: MetadataMap = {
        content: {
          en: {
            'my-post': { createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
          },
        },
      };
      const updated = { createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-07-01T00:00:00Z' };
      setMetadataForContent(map, 'en', 'my-post', updated);
      expect(getMetadataForContent(map, 'en', 'my-post')?.updatedAt).toBe('2024-07-01T00:00:00Z');
    });

    it('omits createdAt and updatedAt when null', () => {
      const map: MetadataMap = { content: {} };
      setMetadataForContent(map, 'en', 'post', { createdAt: null as any, updatedAt: null as any });
      const stored = getMetadataForContent(map, 'en', 'post');
      expect(stored).toEqual({});
      expect('createdAt' in stored!).toBe(false);
      expect('updatedAt' in stored!).toBe(false);
    });

    it('omits only null fields, keeps valid ones', () => {
      const map: MetadataMap = { content: {} };
      setMetadataForContent(map, 'en', 'post', { createdAt: '2024-01-01T00:00:00Z', updatedAt: null as any });
      const stored = getMetadataForContent(map, 'en', 'post');
      expect(stored).toEqual({ createdAt: '2024-01-01T00:00:00Z' });
      expect('updatedAt' in stored!).toBe(false);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════
// Phase 3+4: matchContent with metadata-map
// ══════════════════════════════════════════════════════════════════════

// These tests use the real matchContent function from push-leadcms-content.ts

jest.mock('../src/lib/data-service.js', () => ({
  leadCMSDataService: createDataServiceMock({
    configureForRemote: jest.fn(),
  }),
}));

jest.mock('../src/lib/config.js', () => ({
  getConfig: jest.fn(() => createTestConfig()),
  loadConfig: jest.fn(() => createTestConfig()),
}));

import { matchContent } from '../src/scripts/push-leadcms-content';
import { parseRemoteFlag } from '../src/cli/bin/remote-flag';
import { getConfig } from '../src/lib/config';

describe('matchContent with multi-remote metadata (Phases 3+4)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'leadcms-match-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('ID matching via metadata map', () => {
    it('matches local content to remote using metadata map instead of frontmatter', async () => {
      const filePath = path.join(tmpDir, 'my-post.mdx');
      await fs.writeFile(filePath, matter.stringify('# Content', { title: 'My Post', type: 'article' }));

      // Local has no frontmatter ID — it would be "create" without metadata map
      const local = [makeLocal({
        slug: 'my-post',
        filePath,
        metadata: { title: 'My Post', type: 'article' },
      })];

      const remote = [makeRemote({
        id: 42,
        slug: 'my-post',
        updatedAt: '2024-01-01T00:00:00Z',
      })];

      // metadata map stores this content's remote ID 42
      const metadataMap: MetadataMap = { content: { en: { 'my-post': { id: 42 } } } };

      const ops = await (matchContent as any)(local, remote, undefined, false, metadataMap);
      // Matched by ID from metadata map → update (not create)
      expect(ops.create).toHaveLength(0);
    });

    it('prefers metadata map ID over frontmatter ID when both exist', async () => {
      const filePath = path.join(tmpDir, 'my-post.mdx');
      await fs.writeFile(filePath, matter.stringify('# Content', {
        title: 'My Post', type: 'article', id: 999, // frontmatter has production ID
      }));

      const local = [makeLocal({
        slug: 'my-post',
        filePath,
        metadata: { id: 999, title: 'My Post', type: 'article' },
      })];

      // Remote has develop ID 42 (different from frontmatter ID 999)
      const remote = [makeRemote({
        id: 42,
        slug: 'my-post',
        updatedAt: '2024-01-01T00:00:00Z',
      })];

      // metadata map correctly stores develop's ID 42
      const metadataMap: MetadataMap = { content: { en: { 'my-post': { id: 42 } } } };

      const ops = await (matchContent as any)(local, remote, undefined, false, metadataMap);
      expect(ops.create).toHaveLength(0);
      // Matched correctly via metadata map, not the wrong frontmatter id
    });

    it('falls back to frontmatter ID when metadata map has no entry', async () => {
      const filePath = path.join(tmpDir, 'existing.mdx');
      await fs.writeFile(filePath, matter.stringify('# Content', {
        title: 'Existing', type: 'article', id: 42,
      }));

      const local = [makeLocal({
        slug: 'existing',
        filePath,
        metadata: { id: 42, title: 'Existing', type: 'article' },
      })];

      const remote = [makeRemote({ id: 42, slug: 'existing', updatedAt: '2024-01-01T00:00:00Z' })];

      // metadata map exists but has no entry for this content
      const metadataMap: MetadataMap = { content: {} };

      const ops = await (matchContent as any)(local, remote, undefined, false, metadataMap);
      expect(ops.create).toHaveLength(0);
      // Falls back to frontmatter id matching
    });
  });

  describe('conflict detection via metadata-map', () => {
    it('detects conflict using metadata-map timestamp instead of frontmatter', async () => {
      const filePath = path.join(tmpDir, 'conflicted.mdx');
      await fs.writeFile(filePath, matter.stringify('# Content', {
        title: 'conflicted',
        type: 'article',
        // frontmatter has very old timestamp (from production)
        updatedAt: '2020-01-01T00:00:00Z',
      }));

      const local = [makeLocal({
        slug: 'conflicted',
        filePath,
        metadata: {
          id: 42,
          title: 'conflicted',
          type: 'article',
          updatedAt: '2020-01-01T00:00:00Z', // old production timestamp
        },
      })];

      const remote = [makeRemote({
        id: 42,
        slug: 'conflicted',
        updatedAt: '2024-06-15T12:00:00Z', // remote is newer than metadata-map
      })];

      // metadata-map says last known updatedAt from develop is recent
      const metadataMap: MetadataMap = {
        content: {
          en: {
            conflicted: {
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-06-15T12:00:00Z',
            },
          },
        },
      };

      const metadataMapWithId: MetadataMap = {
        content: {
          en: {
            conflicted: {
              id: 42,
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-06-15T12:00:00Z',
            },
          },
        },
      };

      const ops = await (matchContent as any)(local, remote, undefined, false, metadataMapWithId);

      // No conflict because metadata-map updatedAt matches remote updatedAt
      expect(ops.conflict).toHaveLength(0);
    });

    it('detects conflict when remote is newer than metadata-map baseline', async () => {
      const filePath = path.join(tmpDir, 'conflicted.mdx');
      await fs.writeFile(filePath, matter.stringify('# Content', {
        title: 'conflicted', type: 'article',
      }));

      const local = [makeLocal({
        slug: 'conflicted',
        filePath,
        metadata: { id: 42, title: 'conflicted', type: 'article' },
      })];

      const remote = [makeRemote({
        id: 42,
        slug: 'conflicted',
        updatedAt: '2024-09-01T00:00:00Z', // newer than metadata-map
      })];

      const metadataMap: MetadataMap = {
        content: {
          en: {
            conflicted: {
              id: 42,
              createdAt: '2024-01-01T00:00:00Z',
              updatedAt: '2024-06-15T12:00:00Z', // older than remote
            },
          },
        },
      };

      const ops = await (matchContent as any)(local, remote, undefined, false, metadataMap);

      expect(ops.conflict).toHaveLength(1);
      expect(ops.conflict[0].reason).toContain('Remote content was updated after local content');
    });
  });

  describe('deletion detection with metadata map', () => {
    it('uses metadata map values for local ID set in deletion detection', async () => {
      const filePath = path.join(tmpDir, 'kept.mdx');
      await fs.writeFile(filePath, matter.stringify('# Content', {
        title: 'Kept', type: 'article',
      }));

      // Local has content "kept" with no frontmatter ID
      const local = [makeLocal({
        slug: 'kept',
        filePath,
        metadata: { title: 'Kept', type: 'article' },
      })];

      // Remote has two items: one matching "kept", one that's only remote
      const remote = [
        makeRemote({ id: 42, slug: 'kept', updatedAt: '2024-01-01T00:00:00Z' }),
        makeRemote({ id: 99, slug: 'orphaned', updatedAt: '2024-01-01T00:00:00Z' }),
      ];

      const metadataMap: MetadataMap = { content: { en: { kept: { id: 42 } } } };

      const ops = await (matchContent as any)(local, remote, undefined, true, metadataMap);

      // "orphaned" (id 99) is NOT in the metadata map → should be detected as deletion
      expect(ops.delete).toHaveLength(1);
      expect(ops.delete[0].remote.slug).toBe('orphaned');
    });
  });
});

// ══════════════════════════════════════════════════════════════════════
// Phases 3+4: updateLocalMetadata with remoteCtx
// ══════════════════════════════════════════════════════════════════════

describe('updateLocalMetadata with multi-remote context', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'leadcms-updmeta-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('writes to metadata for non-default remote', async () => {
    const stateDir = path.join(tmpDir, 'state');
    const ctx = makeRemoteCtx({ stateDir, isDefault: false, name: 'develop' });

    const filePath = path.join(tmpDir, 'my-post.mdx');
    const originalContent = matter.stringify('# Test', {
      title: 'My Post',
      type: 'article',
    });
    await fs.writeFile(filePath, originalContent, 'utf-8');

    // Dynamic import to get the function with mocks already in place
    const { updateLocalMetadata } = await import('../src/scripts/push-leadcms-content.js') as any;

    const localContent = {
      filePath,
      slug: 'my-post',
      locale: 'en',
      type: 'article',
      metadata: { title: 'My Post', type: 'article' },
      body: '# Test',
      isLocal: true,
    };

    const remoteResponse = {
      id: 42,
      slug: 'my-post',
      type: 'article',
      title: 'My Post',
      updatedAt: '2024-06-15T12:00:00Z',
      createdAt: '2024-01-01T00:00:00Z',
    };

    await updateLocalMetadata(localContent, remoteResponse, ctx);

    // Verify metadata was written
    const metaMap = await readMetadataMap(ctx);
    expect(lookupRemoteId(metaMap, 'en', 'my-post')).toBe(42);
    const entry = getMetadataForContent(metaMap, 'en', 'my-post');
    expect(entry?.updatedAt).toBe('2024-06-15T12:00:00Z');
    expect(entry?.createdAt).toBe('2024-01-01T00:00:00Z');

    // Verify frontmatter was NOT updated (non-default remote)
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const parsed = matter(fileContent);
    expect(parsed.data.id).toBeUndefined();
    expect(parsed.data.updatedAt).toBeUndefined();
  });

  it('writes to metadata AND frontmatter for default remote', async () => {
    const stateDir = path.join(tmpDir, 'state');
    const ctx = makeRemoteCtx({ stateDir, isDefault: true, name: 'production' });

    const filePath = path.join(tmpDir, 'my-post.mdx');
    const originalContent = matter.stringify('# Test', {
      title: 'My Post',
      type: 'article',
    });
    await fs.writeFile(filePath, originalContent, 'utf-8');

    const { updateLocalMetadata } = await import('../src/scripts/push-leadcms-content.js') as any;

    const localContent = {
      filePath,
      slug: 'my-post',
      locale: 'en',
      type: 'article',
      metadata: { title: 'My Post', type: 'article' },
      body: '# Test',
      isLocal: true,
    };

    const remoteResponse = {
      id: 42,
      slug: 'my-post',
      type: 'article',
      title: 'My Post',
      updatedAt: '2024-06-15T12:00:00Z',
      createdAt: '2024-01-01T00:00:00Z',
    };

    await updateLocalMetadata(localContent, remoteResponse, ctx);

    // Verify metadata was written
    const metaMap = await readMetadataMap(ctx);
    expect(lookupRemoteId(metaMap, 'en', 'my-post')).toBe(42);

    // Verify frontmatter WAS updated (default remote)
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const parsed = matter(fileContent);
    expect(parsed.data.id).toBe(42);
    expect(parsed.data.updatedAt).toBe('2024-06-15T12:00:00Z');
  });

  it('writes to frontmatter in single-remote mode (no remoteCtx)', async () => {
    const filePath = path.join(tmpDir, 'my-post.mdx');
    const originalContent = matter.stringify('# Test', {
      title: 'My Post',
      type: 'article',
    });
    await fs.writeFile(filePath, originalContent, 'utf-8');

    const { updateLocalMetadata } = await import('../src/scripts/push-leadcms-content.js') as any;

    const localContent = {
      filePath,
      slug: 'my-post',
      locale: 'en',
      type: 'article',
      metadata: { title: 'My Post', type: 'article' },
      body: '# Test',
      isLocal: true,
    };

    const remoteResponse = {
      id: 42,
      slug: 'my-post',
      type: 'article',
      title: 'My Post',
      updatedAt: '2024-06-15T12:00:00Z',
      createdAt: '2024-01-01T00:00:00Z',
    };

    // No remoteCtx — single-remote backward compat
    await updateLocalMetadata(localContent, remoteResponse);

    // Verify frontmatter was updated
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const parsed = matter(fileContent);
    expect(parsed.data.id).toBe(42);
    expect(parsed.data.updatedAt).toBe('2024-06-15T12:00:00Z');
  });

  it('writes JSON frontmatter for non-default remote correctly', async () => {
    const stateDir = path.join(tmpDir, 'state');
    const ctx = makeRemoteCtx({ stateDir, isDefault: false, name: 'develop' });

    const filePath = path.join(tmpDir, 'my-page.json');
    const originalContent = JSON.stringify({
      title: 'My Page',
      type: 'page',
      body: '{}',
    }, null, 2);
    await fs.writeFile(filePath, originalContent, 'utf-8');

    const { updateLocalMetadata } = await import('../src/scripts/push-leadcms-content.js') as any;

    const localContent = {
      filePath,
      slug: 'my-page',
      locale: 'en',
      type: 'page',
      metadata: { title: 'My Page', type: 'page' },
      body: '{}',
      isLocal: true,
    };

    const remoteResponse = {
      id: 55,
      slug: 'my-page',
      type: 'page',
      title: 'My Page',
      updatedAt: '2024-06-15T12:00:00Z',
      createdAt: '2024-01-01T00:00:00Z',
    };

    await updateLocalMetadata(localContent, remoteResponse, ctx);

    // Verify metadata was written
    const metaMap = await readMetadataMap(ctx);
    expect(lookupRemoteId(metaMap, 'en', 'my-page')).toBe(55);

    // Verify JSON file was NOT updated (non-default remote)
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(fileContent);
    expect(parsed.id).toBeUndefined();
    expect(parsed.updatedAt).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════
// Phase 2: parseRemoteFlag auto-resolve
// ══════════════════════════════════════════════════════════════════════

describe('parseRemoteFlag auto-resolve (Phase 2)', () => {
  const savedEnv = { ...process.env };
  const mockGetConfig = getConfig as jest.Mock;

  afterEach(() => {
    process.env = { ...savedEnv };
    // Restore default test config
    mockGetConfig.mockReturnValue(createTestConfig());
  });

  it('resolves named remote from --remote flag', () => {
    mockGetConfig.mockReturnValue(createTestConfig({
      remotes: {
        production: { url: 'https://prod.leadcms.com' },
        develop: { url: 'https://dev.leadcms.com' },
      },
      defaultRemote: 'production',
    }));

    const ctx = parseRemoteFlag(['--remote', 'develop']);
    expect(ctx).toBeDefined();
    expect(ctx!.name).toBe('develop');
  });

  it('auto-resolves default remote in multi-remote mode without --remote flag', () => {
    mockGetConfig.mockReturnValue(createTestConfig({
      remotes: {
        production: { url: 'https://prod.leadcms.com' },
        develop: { url: 'https://dev.leadcms.com' },
      },
      defaultRemote: 'production',
    }));

    const ctx = parseRemoteFlag([]);
    expect(ctx).toBeDefined();
    expect(ctx!.name).toBe('production');
    expect(ctx!.isDefault).toBe(true);
  });

  it('returns undefined in single-remote mode without --remote flag', () => {
    mockGetConfig.mockReturnValue(createTestConfig());

    const ctx = parseRemoteFlag([]);
    expect(ctx).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════
// CI/CD env var resolution (LEADCMS_REMOTE + URL auto-match)
// ══════════════════════════════════════════════════════════════════════

describe('resolveRemote env var support', () => {
  const savedEnv = { ...process.env };
  const mockGetConfig = getConfig as jest.Mock;

  afterEach(() => {
    process.env = { ...savedEnv };
    mockGetConfig.mockReturnValue(createTestConfig());
  });

  const multiRemoteConfig = createTestConfig({
    remotes: {
      prod: { url: 'https://cms.prod.example.com' },
      dev: { url: 'https://cms.dev.example.com' },
      staging: { url: 'https://cms.staging.example.com' },
    },
    defaultRemote: 'prod',
  });

  describe('LEADCMS_REMOTE env var', () => {
    it('resolves to the remote named by LEADCMS_REMOTE', () => {
      process.env.LEADCMS_REMOTE = 'dev';
      mockGetConfig.mockReturnValue(multiRemoteConfig);

      const ctx = resolveRemote();
      expect(ctx.name).toBe('dev');
      expect(ctx.url).toBe('https://cms.dev.example.com');
    });

    it('LEADCMS_REMOTE takes priority over defaultRemote', () => {
      process.env.LEADCMS_REMOTE = 'staging';
      mockGetConfig.mockReturnValue(multiRemoteConfig);

      const ctx = resolveRemote();
      expect(ctx.name).toBe('staging');
    });

    it('explicit remoteName argument takes priority over LEADCMS_REMOTE', () => {
      process.env.LEADCMS_REMOTE = 'dev';
      mockGetConfig.mockReturnValue(multiRemoteConfig);

      const ctx = resolveRemote('prod');
      expect(ctx.name).toBe('prod');
    });

    it('throws if LEADCMS_REMOTE names a non-existent remote', () => {
      process.env.LEADCMS_REMOTE = 'nonexistent';
      mockGetConfig.mockReturnValue(multiRemoteConfig);

      expect(() => resolveRemote()).toThrow(/nonexistent.*not configured/);
    });
  });

  describe('URL auto-matching (LEADCMS_URL / NEXT_PUBLIC_LEADCMS_URL)', () => {
    it('matches LEADCMS_URL against configured remotes', () => {
      process.env.LEADCMS_URL = 'https://cms.dev.example.com';
      delete process.env.LEADCMS_REMOTE;
      mockGetConfig.mockReturnValue(multiRemoteConfig);

      const ctx = resolveRemote();
      expect(ctx.name).toBe('dev');
    });

    it('matches NEXT_PUBLIC_LEADCMS_URL against configured remotes', () => {
      process.env.NEXT_PUBLIC_LEADCMS_URL = 'https://cms.staging.example.com';
      delete process.env.LEADCMS_URL;
      delete process.env.LEADCMS_REMOTE;
      mockGetConfig.mockReturnValue(multiRemoteConfig);

      const ctx = resolveRemote();
      expect(ctx.name).toBe('staging');
    });

    it('ignores trailing slashes when matching URLs', () => {
      process.env.LEADCMS_URL = 'https://cms.dev.example.com/';
      delete process.env.LEADCMS_REMOTE;
      mockGetConfig.mockReturnValue(multiRemoteConfig);

      const ctx = resolveRemote();
      expect(ctx.name).toBe('dev');
    });

    it('LEADCMS_REMOTE takes priority over URL matching', () => {
      process.env.LEADCMS_REMOTE = 'prod';
      process.env.LEADCMS_URL = 'https://cms.dev.example.com';
      mockGetConfig.mockReturnValue(multiRemoteConfig);

      const ctx = resolveRemote();
      expect(ctx.name).toBe('prod');
    });

    it('falls back to defaultRemote when URL does not match any remote', () => {
      process.env.LEADCMS_URL = 'https://unknown.example.com';
      delete process.env.LEADCMS_REMOTE;
      mockGetConfig.mockReturnValue(multiRemoteConfig);

      const ctx = resolveRemote();
      expect(ctx.name).toBe('prod');
    });
  });
});

// ══════════════════════════════════════════════════════════════════════
// contentKey utility
// ══════════════════════════════════════════════════════════════════════

describe('contentKey', () => {
  it('builds language/slug key', () => {
    expect(contentKey('en', 'hello-world')).toBe('en/hello-world');
  });

  it('handles multi-level slugs', () => {
    expect(contentKey('fr', 'blog/nested-post')).toBe('fr/blog/nested-post');
  });
});

// ══════════════════════════════════════════════════════════════════════
// Comment metadata helpers
// ══════════════════════════════════════════════════════════════════════

describe('commentKey', () => {
  it('builds language/translationKey key', () => {
    expect(commentKey('en', 'abc-123')).toBe('en/abc-123');
  });

  it('works with non-latin locales', () => {
    expect(commentKey('ja', 'comment-uuid')).toBe('ja/comment-uuid');
  });
});

describe('Comment metadata map helpers', () => {
  describe('lookupCommentRemoteId / setCommentRemoteId', () => {
    it('returns undefined for unmapped comment', () => {
      const map: MetadataMap = { content: {}, comments: {} };
      expect(lookupCommentRemoteId(map, 'en', 'no-such-key')).toBeUndefined();
    });

    it('looks up by language/translationKey', () => {
      const map: MetadataMap = {
        content: {},
        comments: { en: { 'tk-1': { id: 501 } } },
      };
      expect(lookupCommentRemoteId(map, 'en', 'tk-1')).toBe(501);
    });

    it('sets and retrieves an id', () => {
      const map: MetadataMap = { content: {}, comments: {} };
      setCommentRemoteId(map, 'en', 'tk-2', 502);
      expect(lookupCommentRemoteId(map, 'en', 'tk-2')).toBe(502);
    });

    it('overwrites existing id', () => {
      const map: MetadataMap = {
        content: {},
        comments: { en: { 'tk-3': { id: 100 } } },
      };
      setCommentRemoteId(map, 'en', 'tk-3', 200);
      expect(lookupCommentRemoteId(map, 'en', 'tk-3')).toBe(200);
    });

    it('removes stale entry when another key claims the same id', () => {
      const map: MetadataMap = {
        content: {},
        comments: { en: { 'old-key': { id: 600 } } },
      };
      setCommentRemoteId(map, 'en', 'new-key', 600);
      expect(lookupCommentRemoteId(map, 'en', 'new-key')).toBe(600);
      expect(lookupCommentRemoteId(map, 'en', 'old-key')).toBeUndefined();
    });

    it('does not remove entries with different ids', () => {
      const map: MetadataMap = {
        content: {},
        comments: { en: { a: { id: 1 }, b: { id: 2 } } },
      };
      setCommentRemoteId(map, 'en', 'c', 3);
      expect(Object.keys(map.comments!.en)).toHaveLength(3);
    });

    it('initializes comments section when missing', () => {
      const map: MetadataMap = { content: {} };
      setCommentRemoteId(map, 'fr', 'tk-4', 700);
      expect(lookupCommentRemoteId(map, 'fr', 'tk-4')).toBe(700);
    });
  });

  describe('getMetadataForComment / setMetadataForComment', () => {
    it('returns undefined for unmapped comment', () => {
      const map: MetadataMap = { content: {}, comments: {} };
      expect(getMetadataForComment(map, 'en', 'no-key')).toBeUndefined();
    });

    it('sets and retrieves metadata entry', () => {
      const map: MetadataMap = { content: {}, comments: {} };
      setMetadataForComment(map, 'en', 'tk-5', {
        id: 800,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-06-15T12:00:00Z',
      });
      const entry = getMetadataForComment(map, 'en', 'tk-5');
      expect(entry).toEqual({
        id: 800,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-06-15T12:00:00Z',
      });
    });

    it('merges with existing metadata', () => {
      const map: MetadataMap = {
        content: {},
        comments: { en: { 'tk-6': { id: 900 } } },
      };
      setMetadataForComment(map, 'en', 'tk-6', {
        createdAt: '2024-02-01T00:00:00Z',
        updatedAt: '2024-07-01T00:00:00Z',
      });
      const entry = getMetadataForComment(map, 'en', 'tk-6');
      expect(entry).toEqual({
        id: 900,
        createdAt: '2024-02-01T00:00:00Z',
        updatedAt: '2024-07-01T00:00:00Z',
      });
    });

    it('omits null fields', () => {
      const map: MetadataMap = { content: {}, comments: {} };
      setMetadataForComment(map, 'en', 'tk-7', {
        id: 999,
        createdAt: null as any,
        updatedAt: '2024-01-01T00:00:00Z',
      });
      const entry = getMetadataForComment(map, 'en', 'tk-7');
      expect(entry).toEqual({
        id: 999,
        updatedAt: '2024-01-01T00:00:00Z',
      });
    });
  });

  describe('readMetadataMap / writeMetadataMap round-trip with comments', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comments-meta-'));
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('preserves comment metadata through round-trip', async () => {
      const ctx = makeRemoteCtx({ stateDir: tmpDir });
      const map: MetadataMap = {
        content: {},
        comments: {
          en: {
            'tk-a': { id: 100, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-06-01T00:00:00Z' },
            'tk-b': { id: 101 },
          },
          fr: {
            'tk-c': { id: 200, createdAt: '2024-02-01T00:00:00Z' },
          },
        },
      };
      await writeMetadataMap(ctx, map);
      const read = await readMetadataMap(ctx);
      expect(read.comments).toEqual(map.comments);
    });

    it('deduplicates comments section on read', async () => {
      const ctx = makeRemoteCtx({ stateDir: tmpDir });
      // Manually write a metadata.json with duplicate IDs
      const raw = {
        content: {},
        comments: {
          en: {
            'old-key': { id: 42 },
            'new-key': { id: 42 },
          },
        },
      };
      await fs.writeFile(
        path.join(tmpDir, 'metadata.json'),
        JSON.stringify(raw, null, 2),
      );
      const read = await readMetadataMap(ctx);
      // Deduplication keeps only the last entry with id 42
      const entries = Object.entries(read.comments!.en || {}).filter(
        ([, v]) => v.id === 42,
      );
      expect(entries).toHaveLength(1);
      expect(entries[0][0]).toBe('new-key');
    });
  });
});
