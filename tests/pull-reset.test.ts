/**
 * Tests for `leadcms pull --reset` feature and sync token storage locations.
 *
 * The --reset flag should:
 *   1. Delete all sync tokens (content, media, comments)
 *   2. Delete all local content files
 *   3. Delete all local media files
 *   4. Delete all local comment files
 *   5. Then perform a full pull from scratch
 *
 * Sync token storage:
 *   - Tokens are stored INSIDE the corresponding data directory as `.sync-token`
 *   - Legacy tokens (SDK ≤ 3.2) in parent dirs are migrated on first read, then deleted
 *
 * TDD: Tests written before implementation.
 */

import fsPromises from 'fs/promises';
import path from 'path';
import os from 'os';
import { jest } from '@jest/globals';
import { listContentFiles, listAllFiles, createSyncTestHarness } from './test-helpers';

// ── Temp directories for isolation ─────────────────────────────────────
const tmpRoot = path.join(os.tmpdir(), 'leadcms-pull-reset');
const contentDir = path.join(tmpRoot, 'content');
const mediaDir = path.join(tmpRoot, 'media');
const commentsDir = path.join(tmpRoot, 'comments');

const harness = createSyncTestHarness({ contentDir, mediaDir, commentsDir });

jest.mock('../src/lib/config.js', () => ({
  getConfig: jest.fn(() => harness.config),
}));
jest.mock('axios', () => harness.axiosMock);

import { pullAll } from '../src/scripts/pull-all';
import { resetLocalState, resetContentState, resetMediaState, resetCommentsState } from '../src/scripts/pull-all';

// ── Shared setup / teardown ────────────────────────────────────────────
beforeEach(() => harness.setup());
afterEach(() => harness.cleanup());

// ── Sync token paths (new: inside data dirs) ──────────────────────────
const contentSyncTokenPath = path.join(contentDir, '.sync-token');
const mediaSyncTokenPath = path.join(mediaDir, '.sync-token');
const commentSyncTokenPath = path.join(commentsDir, '.sync-token');

// ── Legacy sync token paths (SDK ≤ 3.2: parent of data dirs) ─────────
const legacyContentSyncTokenPath = path.join(path.dirname(contentDir), 'sync-token.txt');
const legacyMediaSyncTokenPath = path.join(path.dirname(contentDir), 'media-sync-token.txt');
const legacyCommentSyncTokenPath = path.join(path.dirname(commentsDir), 'comment-sync-token.txt');

// ════════════════════════════════════════════════════════════════════════
//  resetLocalState unit tests
// ════════════════════════════════════════════════════════════════════════

describe('resetLocalState', () => {
  it('should delete content sync token file (new location)', async () => {
    await fsPromises.mkdir(contentDir, { recursive: true });
    await fsPromises.writeFile(contentSyncTokenPath, 'some-token', 'utf8');

    await resetLocalState();

    await expect(fsPromises.access(contentSyncTokenPath)).rejects.toThrow();
  });

  it('should delete media sync token file (new location)', async () => {
    await fsPromises.mkdir(mediaDir, { recursive: true });
    await fsPromises.writeFile(mediaSyncTokenPath, 'some-media-token', 'utf8');

    await resetLocalState();

    await expect(fsPromises.access(mediaSyncTokenPath)).rejects.toThrow();
  });

  it('should delete legacy sync token files', async () => {
    const parentDir = path.dirname(contentDir);
    await fsPromises.mkdir(parentDir, { recursive: true });
    await fsPromises.writeFile(legacyContentSyncTokenPath, 'legacy-content-token', 'utf8');
    await fsPromises.writeFile(legacyMediaSyncTokenPath, 'legacy-media-token', 'utf8');
    await fsPromises.writeFile(legacyCommentSyncTokenPath, 'legacy-comment-token', 'utf8');

    await resetLocalState();

    await expect(fsPromises.access(legacyContentSyncTokenPath)).rejects.toThrow();
    await expect(fsPromises.access(legacyMediaSyncTokenPath)).rejects.toThrow();
    await expect(fsPromises.access(legacyCommentSyncTokenPath)).rejects.toThrow();
  });

  it('should delete all local content files', async () => {
    const articleDir = path.join(contentDir, 'en', 'article');
    await fsPromises.mkdir(articleDir, { recursive: true });
    await fsPromises.writeFile(path.join(articleDir, 'test.mdx'), '---\ntitle: Test\n---\n# Test');

    const componentDir = path.join(contentDir, 'en', 'component');
    await fsPromises.mkdir(componentDir, { recursive: true });
    await fsPromises.writeFile(path.join(componentDir, 'nav.json'), '{"title":"Nav"}');

    await resetLocalState();

    const files = await listContentFiles(contentDir);
    expect(files).toHaveLength(0);
  });

  it('should delete all local media files', async () => {
    const imgDir = path.join(mediaDir, 'images');
    await fsPromises.mkdir(imgDir, { recursive: true });
    await fsPromises.writeFile(path.join(imgDir, 'photo.jpg'), 'fake-image-data');

    await resetLocalState();

    const files = await listAllFiles(mediaDir);
    expect(files).toHaveLength(0);
  });

  it('should delete all local comment files', async () => {
    const commentTypeDir = path.join(commentsDir, 'article');
    await fsPromises.mkdir(commentTypeDir, { recursive: true });
    await fsPromises.writeFile(path.join(commentTypeDir, '1.json'), '[{"id":1}]');

    await resetLocalState();

    const files = await listAllFiles(commentsDir);
    expect(files).toHaveLength(0);
  });

  it('should not throw if directories do not exist', async () => {
    await fsPromises.rm(tmpRoot, { recursive: true, force: true });

    await expect(resetLocalState()).resolves.not.toThrow();
  });

  it('should delete all sync token files (new + legacy)', async () => {
    // Create new-location tokens
    await fsPromises.mkdir(contentDir, { recursive: true });
    await fsPromises.mkdir(mediaDir, { recursive: true });
    await fsPromises.writeFile(contentSyncTokenPath, 'new-content-token', 'utf8');
    await fsPromises.writeFile(mediaSyncTokenPath, 'new-media-token', 'utf8');

    // Create legacy tokens
    const parentDir = path.dirname(contentDir);
    await fsPromises.mkdir(parentDir, { recursive: true });
    await fsPromises.writeFile(legacyContentSyncTokenPath, 'legacy-content-token', 'utf8');
    await fsPromises.writeFile(legacyMediaSyncTokenPath, 'legacy-media-token', 'utf8');

    await resetLocalState();

    // All sync token files should be gone
    await expect(fsPromises.access(contentSyncTokenPath)).rejects.toThrow();
    await expect(fsPromises.access(mediaSyncTokenPath)).rejects.toThrow();
    await expect(fsPromises.access(legacyContentSyncTokenPath)).rejects.toThrow();
    await expect(fsPromises.access(legacyMediaSyncTokenPath)).rejects.toThrow();
  });
});

// ════════════════════════════════════════════════════════════════════════
//  Scoped reset function unit tests
// ════════════════════════════════════════════════════════════════════════

describe('resetContentState', () => {
  it('should delete content directory and sync token', async () => {
    const articleDir = path.join(contentDir, 'en', 'article');
    await fsPromises.mkdir(articleDir, { recursive: true });
    await fsPromises.writeFile(path.join(articleDir, 'test.mdx'), '# Test');
    await fsPromises.writeFile(contentSyncTokenPath, 'content-token', 'utf8');

    await resetContentState();

    const files = await listContentFiles(contentDir);
    expect(files).toHaveLength(0);
    await expect(fsPromises.access(contentSyncTokenPath)).rejects.toThrow();
  });

  it('should delete legacy content sync token', async () => {
    const parentDir = path.dirname(contentDir);
    await fsPromises.mkdir(parentDir, { recursive: true });
    await fsPromises.writeFile(legacyContentSyncTokenPath, 'legacy-token', 'utf8');

    await resetContentState();

    await expect(fsPromises.access(legacyContentSyncTokenPath)).rejects.toThrow();
  });

  it('should not touch media or comments directories', async () => {
    await fsPromises.mkdir(mediaDir, { recursive: true });
    await fsPromises.writeFile(path.join(mediaDir, 'photo.jpg'), 'img-data');
    await fsPromises.mkdir(commentsDir, { recursive: true });
    await fsPromises.writeFile(path.join(commentsDir, 'c.json'), '{}');

    await resetContentState();

    const mediaFiles = await listAllFiles(mediaDir);
    expect(mediaFiles.length).toBeGreaterThan(0);
    const commentFiles = await listAllFiles(commentsDir);
    expect(commentFiles.length).toBeGreaterThan(0);
  });

  it('should not throw if content directory does not exist', async () => {
    await fsPromises.rm(contentDir, { recursive: true, force: true });
    await expect(resetContentState()).resolves.not.toThrow();
  });
});

describe('resetMediaState', () => {
  it('should delete media directory and sync token', async () => {
    await fsPromises.mkdir(mediaDir, { recursive: true });
    await fsPromises.writeFile(path.join(mediaDir, 'photo.jpg'), 'img-data');
    await fsPromises.writeFile(mediaSyncTokenPath, 'media-token', 'utf8');

    await resetMediaState();

    const files = await listAllFiles(mediaDir);
    expect(files).toHaveLength(0);
    await expect(fsPromises.access(mediaSyncTokenPath)).rejects.toThrow();
  });

  it('should delete legacy media sync token', async () => {
    const parentDir = path.dirname(contentDir);
    await fsPromises.mkdir(parentDir, { recursive: true });
    await fsPromises.writeFile(legacyMediaSyncTokenPath, 'legacy-media-token', 'utf8');

    await resetMediaState();

    await expect(fsPromises.access(legacyMediaSyncTokenPath)).rejects.toThrow();
  });

  it('should not touch content or comments directories', async () => {
    const articleDir = path.join(contentDir, 'en', 'article');
    await fsPromises.mkdir(articleDir, { recursive: true });
    await fsPromises.writeFile(path.join(articleDir, 'test.mdx'), '# Test');
    await fsPromises.mkdir(commentsDir, { recursive: true });
    await fsPromises.writeFile(path.join(commentsDir, 'c.json'), '{}');

    await resetMediaState();

    const contentFiles = await listContentFiles(contentDir);
    expect(contentFiles.length).toBeGreaterThan(0);
    const commentFiles = await listAllFiles(commentsDir);
    expect(commentFiles.length).toBeGreaterThan(0);
  });

  it('should not throw if media directory does not exist', async () => {
    await fsPromises.rm(mediaDir, { recursive: true, force: true });
    await expect(resetMediaState()).resolves.not.toThrow();
  });
});

describe('resetCommentsState', () => {
  it('should delete comments directory and sync token', async () => {
    await fsPromises.mkdir(commentsDir, { recursive: true });
    await fsPromises.writeFile(path.join(commentsDir, 'c.json'), '{}');
    await fsPromises.writeFile(commentSyncTokenPath, 'comment-token', 'utf8');

    await resetCommentsState();

    const files = await listAllFiles(commentsDir);
    expect(files).toHaveLength(0);
    await expect(fsPromises.access(commentSyncTokenPath)).rejects.toThrow();
  });

  it('should delete legacy comment sync token', async () => {
    const parentDir = path.dirname(commentsDir);
    await fsPromises.mkdir(parentDir, { recursive: true });
    await fsPromises.writeFile(legacyCommentSyncTokenPath, 'legacy-comment-token', 'utf8');

    await resetCommentsState();

    await expect(fsPromises.access(legacyCommentSyncTokenPath)).rejects.toThrow();
  });

  it('should not touch content or media directories', async () => {
    const articleDir = path.join(contentDir, 'en', 'article');
    await fsPromises.mkdir(articleDir, { recursive: true });
    await fsPromises.writeFile(path.join(articleDir, 'test.mdx'), '# Test');
    await fsPromises.mkdir(mediaDir, { recursive: true });
    await fsPromises.writeFile(path.join(mediaDir, 'photo.jpg'), 'img-data');

    await resetCommentsState();

    const contentFiles = await listContentFiles(contentDir);
    expect(contentFiles.length).toBeGreaterThan(0);
    const mediaFiles = await listAllFiles(mediaDir);
    expect(mediaFiles.length).toBeGreaterThan(0);
  });

  it('should not throw if comments directory does not exist', async () => {
    await fsPromises.rm(commentsDir, { recursive: true, force: true });
    await expect(resetCommentsState()).resolves.not.toThrow();
  });
});

// ════════════════════════════════════════════════════════════════════════
//  pull --reset integration tests
// ════════════════════════════════════════════════════════════════════════

describe('pullAll with --reset', () => {
  it('should clear existing content and do a full pull from scratch', async () => {
    const v1Article = {
      id: 1,
      slug: 'hello-world',
      type: 'article',
      language: 'en',
      title: 'Hello World',
      body: '---\ntitle: Hello World\n---\n# Hello World',
      publishedAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    harness.addContentSync([v1Article], [], 'token-1');
    await pullAll();

    let files = await listContentFiles(contentDir);
    expect(files).toHaveLength(1);

    const v2Article = {
      id: 2,
      slug: 'new-article',
      type: 'article',
      language: 'en',
      title: 'New Article',
      body: '---\ntitle: New Article\n---\n# New Article',
      publishedAt: '2024-02-01T00:00:00Z',
      updatedAt: '2024-02-01T00:00:00Z',
    };

    harness.addContentSync([v2Article], [], 'token-2');
    await pullAll({ reset: true });

    files = await listContentFiles(contentDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('new-article');
  });

  it('should reset sync tokens so the server returns all content again', async () => {
    const article = {
      id: 1,
      slug: 'first-post',
      type: 'article',
      language: 'en',
      title: 'First Post',
      body: '---\ntitle: First Post\n---\n# First Post',
      publishedAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    harness.addContentSync([article], [], 'token-1');
    await pullAll();

    // Verify sync token was saved in the NEW location (inside contentDir)
    const tokenBefore = await fsPromises.readFile(contentSyncTokenPath, 'utf8').catch(() => '');
    expect(tokenBefore).toBeTruthy();

    harness.addContentSync([article], [], 'token-fresh');
    await pullAll({ reset: true });

    // Sync token should now be the fresh one
    const tokenAfter = await fsPromises.readFile(contentSyncTokenPath, 'utf8').catch(() => '');
    expect(tokenAfter).toBe('token-fresh');
  });

  it('should work even when no prior state exists (first-time reset pull)', async () => {
    const article = {
      id: 1,
      slug: 'brand-new',
      type: 'article',
      language: 'en',
      title: 'Brand New',
      body: '---\ntitle: Brand New\n---\n# Brand New',
      publishedAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    harness.addContentSync([article], [], 'token-1');
    await expect(pullAll({ reset: true })).resolves.not.toThrow();

    const files = await listContentFiles(contentDir);
    expect(files).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════════════════
//  pullContent with --reset integration tests
// ════════════════════════════════════════════════════════════════════════

describe('pullContent with --reset', () => {
  it('should clear content and do a fresh content pull', async () => {
    const v1Article = {
      id: 1,
      slug: 'hello-world',
      type: 'article',
      language: 'en',
      title: 'Hello World',
      body: '---\ntitle: Hello World\n---\n# Hello World',
      publishedAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    harness.addContentSync([v1Article], [], 'token-1');

    const { pullContent } = await import('../src/scripts/pull-content');
    await pullContent();

    let files = await listContentFiles(contentDir);
    expect(files).toHaveLength(1);

    // Queue a fresh-pull response that only has the new article
    const v2Article = {
      id: 2,
      slug: 'fresh-article',
      type: 'article',
      language: 'en',
      title: 'Fresh Article',
      body: '---\ntitle: Fresh Article\n---\n# Fresh Article',
      publishedAt: '2024-02-01T00:00:00Z',
      updatedAt: '2024-02-01T00:00:00Z',
    };

    harness.addContentSync([v2Article], [], 'token-2');
    await pullContent({ reset: true });

    files = await listContentFiles(contentDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('fresh-article');
  });

  it('should not touch media or comments when resetting content', async () => {
    // Set up media and comment files
    await fsPromises.mkdir(mediaDir, { recursive: true });
    await fsPromises.writeFile(path.join(mediaDir, 'photo.jpg'), 'img-data');
    await fsPromises.writeFile(mediaSyncTokenPath, 'media-token', 'utf8');

    await fsPromises.mkdir(commentsDir, { recursive: true });
    await fsPromises.writeFile(path.join(commentsDir, 'c.json'), '{}');
    await fsPromises.writeFile(commentSyncTokenPath, 'comment-token', 'utf8');

    const article = {
      id: 1,
      slug: 'test',
      type: 'article',
      language: 'en',
      title: 'Test',
      body: '---\ntitle: Test\n---\n# Test',
      publishedAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    harness.addContentSync([article], [], 'token-1');

    const { pullContent } = await import('../src/scripts/pull-content');
    await pullContent({ reset: true });

    // Media and comments should be untouched
    const mediaFiles = await listAllFiles(mediaDir);
    expect(mediaFiles.length).toBeGreaterThan(0);
    const mediaToken = await fsPromises.readFile(mediaSyncTokenPath, 'utf8');
    expect(mediaToken).toBe('media-token');

    const commentFiles = await listAllFiles(commentsDir);
    expect(commentFiles.length).toBeGreaterThan(0);
    const commentToken = await fsPromises.readFile(commentSyncTokenPath, 'utf8');
    expect(commentToken).toBe('comment-token');
  });
});

// ════════════════════════════════════════════════════════════════════════
//  Sync token location tests — verify tokens are saved inside data dirs
// ════════════════════════════════════════════════════════════════════════

describe('Sync token save location', () => {
  it('should save content sync token inside contentDir', async () => {
    const article = {
      id: 1,
      slug: 'token-test',
      type: 'article',
      language: 'en',
      title: 'Token Test',
      body: '---\ntitle: Token Test\n---\n# Token Test',
      publishedAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    harness.addContentSync([article], [], 'content-token-abc');

    const { fetchLeadCMSContent } = await import('../src/scripts/fetch-leadcms-content');
    await fetchLeadCMSContent();

    // Token should be at contentDir/.sync-token
    const token = await fsPromises.readFile(contentSyncTokenPath, 'utf8');
    expect(token).toBe('content-token-abc');

    // Should NOT exist at the old legacy location
    await expect(fsPromises.access(legacyContentSyncTokenPath)).rejects.toThrow();
  });

  it('should save media sync token inside mediaDir', async () => {
    harness.addMediaSync(
      [{ location: '/api/media/test/image.jpg' }],
      [],
      'media-token-xyz'
    );

    const { fetchLeadCMSContent } = await import('../src/scripts/fetch-leadcms-content');
    await fetchLeadCMSContent();

    // Token should be at mediaDir/.sync-token
    const token = await fsPromises.readFile(mediaSyncTokenPath, 'utf8');
    expect(token).toBe('media-token-xyz');

    // Should NOT exist at the old legacy location
    await expect(fsPromises.access(legacyMediaSyncTokenPath)).rejects.toThrow();
  });

  it('should store sync tokens inside data directories, not as siblings', async () => {
    const article = {
      id: 1,
      slug: 'sibling-test',
      type: 'article',
      language: 'en',
      title: 'Sibling Test',
      body: '---\ntitle: Sibling Test\n---\n# Sibling Test',
      publishedAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    harness.addContentSync([article], [], 'sibling-token');

    const { fetchLeadCMSContent } = await import('../src/scripts/fetch-leadcms-content');
    await fetchLeadCMSContent();

    // The parent dir should NOT contain any sync-token.txt files
    const parentDir = path.dirname(contentDir);
    const entries = await fsPromises.readdir(parentDir);
    expect(entries).not.toContain('sync-token.txt');
    expect(entries).not.toContain('media-sync-token.txt');

    // The token lives inside contentDir itself
    const contentEntries = await fsPromises.readdir(contentDir);
    expect(contentEntries).toContain('.sync-token');
  });
});

// ════════════════════════════════════════════════════════════════════════
//  Legacy sync token migration tests
// ════════════════════════════════════════════════════════════════════════

describe('Legacy sync token migration', () => {
  it('should migrate legacy content sync token on first pull', async () => {
    // Simulate upgrading from SDK ≤ 3.2: legacy token exists, new one does not
    await fsPromises.mkdir(path.dirname(legacyContentSyncTokenPath), { recursive: true });
    await fsPromises.writeFile(legacyContentSyncTokenPath, 'legacy-token-123', 'utf8');

    const article = {
      id: 1,
      slug: 'migration-test',
      type: 'article',
      language: 'en',
      title: 'Migration Test',
      body: '---\ntitle: Migration Test\n---\n# Migration Test',
      publishedAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    harness.addContentSync([article], [], 'new-token-after-migration');

    const { fetchLeadCMSContent } = await import('../src/scripts/fetch-leadcms-content');
    await fetchLeadCMSContent();

    // After migration + successful pull, new token should be written
    const newToken = await fsPromises.readFile(contentSyncTokenPath, 'utf8');
    expect(newToken).toBe('new-token-after-migration');

    // Legacy token should be cleaned up
    await expect(fsPromises.access(legacyContentSyncTokenPath)).rejects.toThrow();
  });

  it('should migrate legacy media sync token on first pull', async () => {
    await fsPromises.mkdir(path.dirname(legacyMediaSyncTokenPath), { recursive: true });
    await fsPromises.writeFile(legacyMediaSyncTokenPath, 'legacy-media-token-456', 'utf8');

    harness.addMediaSync(
      [{ location: '/api/media/test/photo.jpg' }],
      [],
      'new-media-token-after-migration'
    );

    const { fetchLeadCMSContent } = await import('../src/scripts/fetch-leadcms-content');
    await fetchLeadCMSContent();

    // After migration + successful pull, new token should be written
    const newToken = await fsPromises.readFile(mediaSyncTokenPath, 'utf8');
    expect(newToken).toBe('new-media-token-after-migration');

    // Legacy token should be cleaned up
    await expect(fsPromises.access(legacyMediaSyncTokenPath)).rejects.toThrow();
  });

  it('should prefer new token location over legacy if both exist', async () => {
    // Both old and new exist — new should win
    await fsPromises.mkdir(contentDir, { recursive: true });
    await fsPromises.writeFile(contentSyncTokenPath, 'new-location-token', 'utf8');
    await fsPromises.mkdir(path.dirname(legacyContentSyncTokenPath), { recursive: true });
    await fsPromises.writeFile(legacyContentSyncTokenPath, 'old-location-token', 'utf8');

    const article = {
      id: 1,
      slug: 'prefer-new',
      type: 'article',
      language: 'en',
      title: 'Prefer New',
      body: '---\ntitle: Prefer New\n---\n# Prefer New',
      publishedAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    harness.addContentSync([article], [], 'updated-token');

    const { fetchLeadCMSContent } = await import('../src/scripts/fetch-leadcms-content');
    await fetchLeadCMSContent();

    // New token should be updated
    const token = await fsPromises.readFile(contentSyncTokenPath, 'utf8');
    expect(token).toBe('updated-token');
  });

  it('should handle missing legacy token gracefully', async () => {
    // No legacy token, no new token — first-time pull
    const article = {
      id: 1,
      slug: 'no-legacy',
      type: 'article',
      language: 'en',
      title: 'No Legacy',
      body: '---\ntitle: No Legacy\n---\n# No Legacy',
      publishedAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    harness.addContentSync([article], [], 'fresh-token');

    const { fetchLeadCMSContent } = await import('../src/scripts/fetch-leadcms-content');
    await fetchLeadCMSContent();

    // Token should be written to new location
    const token = await fsPromises.readFile(contentSyncTokenPath, 'utf8');
    expect(token).toBe('fresh-token');

    // No legacy file should exist either
    await expect(fsPromises.access(legacyContentSyncTokenPath)).rejects.toThrow();
  });
});
