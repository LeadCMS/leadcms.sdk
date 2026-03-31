/**
 * Tests for metadata-based file resolution during pull from non-default remotes.
 *
 * Covers:
 *  - Bug 1: Pulling from a non-default remote must not delete content whose
 *    frontmatter id belongs to the default remote. Identification of existing
 *    vs. new records must use the remote's own metadata.json, not frontmatter.
 *  - Bug 2: Deleted IDs from a non-default remote must be resolved via the
 *    remote's metadata.json, not by scanning frontmatter IDs.
 */

import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { jest } from '@jest/globals';
import { listContentFiles, createSyncTestHarness } from './test-helpers';

import type { RemoteContext, MetadataMap } from '../src/lib/remote-context';

// ── Temp directories ───────────────────────────────────────────────────
const tmpRoot = path.join(os.tmpdir(), 'leadcms-metadata-remote-test');
const contentDir = path.join(tmpRoot, 'content');
const mediaDir = path.join(tmpRoot, 'media');
const remotesBase = path.join(tmpRoot, '.leadcms', 'remotes');

const harness = createSyncTestHarness({
  contentDir,
  mediaDir,
  configOverrides: {
    defaultRemote: 'production',
    remotes: {
      production: { url: 'https://prod.leadcms.com' },
      develop: { url: 'https://dev.leadcms.com' },
    },
  },
});

jest.mock('../src/lib/config.js', () => ({
  getConfig: jest.fn(() => harness.config),
}));
jest.mock('axios', () => harness.axiosMock);

import { pullLeadCMSContent } from '../src/scripts/pull-leadcms-content';
import { deleteContentFilesBySlug } from '../src/scripts/pull-leadcms-content';
import { findContentByRemoteId, writeMetadataMap, readMetadataMap } from '../src/lib/remote-context';

// ── Helpers ────────────────────────────────────────────────────────────

function makeDevCtx(): RemoteContext {
  return {
    name: 'develop',
    url: 'https://dev.leadcms.com',
    isDefault: false,
    stateDir: path.join(remotesBase, 'develop'),
  };
}

function makeProdCtx(): RemoteContext {
  return {
    name: 'production',
    url: 'https://prod.leadcms.com',
    isDefault: true,
    stateDir: path.join(remotesBase, 'production'),
  };
}

async function writeMetadataFile(ctx: RemoteContext, map: MetadataMap): Promise<void> {
  await fs.mkdir(ctx.stateDir, { recursive: true });
  await writeMetadataMap(ctx, map);
}

// ── Setup / teardown ──────────────────────────────────────────────────
beforeEach(async () => {
  await harness.setup();
  // Ensure remotes dirs exist
  await fs.mkdir(path.join(remotesBase, 'develop'), { recursive: true });
  await fs.mkdir(path.join(remotesBase, 'production'), { recursive: true });
});

afterEach(() => harness.cleanup());

// ════════════════════════════════════════════════════════════════════════
// Unit tests: findContentByRemoteId
// ════════════════════════════════════════════════════════════════════════
describe('findContentByRemoteId', () => {
  it('should find content by remote ID in metadata', () => {
    const map: MetadataMap = {
      content: {
        en: {
          'my-article': { id: 42 },
          'about-page': { id: 99 },
        },
        fr: {
          'mon-article': { id: 55 },
        },
      },
      emailTemplates: {},
      comments: {},
      segments: {},
      sequences: {},
    };

    expect(findContentByRemoteId(map, 42)).toEqual({ language: 'en', slug: 'my-article' });
    expect(findContentByRemoteId(map, 99)).toEqual({ language: 'en', slug: 'about-page' });
    expect(findContentByRemoteId(map, 55)).toEqual({ language: 'fr', slug: 'mon-article' });
  });

  it('should return undefined when ID is not in metadata', () => {
    const map: MetadataMap = {
      content: { en: { 'my-article': { id: 42 } } },
      emailTemplates: {},
      comments: {},
      segments: {},
      sequences: {},
    };

    expect(findContentByRemoteId(map, 999)).toBeUndefined();
  });

  it('should match string and number IDs equivalently', () => {
    const map: MetadataMap = {
      content: { en: { 'article': { id: '100' } } },
      emailTemplates: {},
      comments: {},
      segments: {},
      sequences: {},
    };

    expect(findContentByRemoteId(map, 100)).toEqual({ language: 'en', slug: 'article' });
    expect(findContentByRemoteId(map, '100')).toEqual({ language: 'en', slug: 'article' });
  });
});

// ════════════════════════════════════════════════════════════════════════
// Unit tests: deleteContentFilesBySlug
// ════════════════════════════════════════════════════════════════════════
describe('deleteContentFilesBySlug', () => {
  it('should delete .mdx file for a given slug in default language', async () => {
    const filePath = path.join(contentDir, 'test-article.mdx');
    await fs.writeFile(filePath, '---\ntitle: Test\n---\nContent');

    await deleteContentFilesBySlug(contentDir, 'test-article', 'en', 'en');

    await expect(fs.access(filePath)).rejects.toThrow();
  });

  it('should delete .json file for a given slug in default language', async () => {
    const filePath = path.join(contentDir, 'widget.json');
    await fs.writeFile(filePath, JSON.stringify({ title: 'Widget' }));

    await deleteContentFilesBySlug(contentDir, 'widget', 'en', 'en');

    await expect(fs.access(filePath)).rejects.toThrow();
  });

  it('should delete file in locale subdirectory for non-default language', async () => {
    const dir = path.join(contentDir, 'fr');
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, 'article.mdx');
    await fs.writeFile(filePath, '---\ntitle: Article\n---\nContenu');

    await deleteContentFilesBySlug(contentDir, 'article', 'fr', 'en');

    await expect(fs.access(filePath)).rejects.toThrow();
  });

  it('should not throw when file does not exist', async () => {
    await expect(
      deleteContentFilesBySlug(contentDir, 'nonexistent', 'en', 'en'),
    ).resolves.toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════
// Integration: Non-default remote deletion must not affect default
//               remote's content (Bug 1 - coincidental ID overlap)
// ════════════════════════════════════════════════════════════════════════
describe('Pull from non-default remote: deleted IDs must not affect default remote content', () => {
  it('should keep file with default remote ID when non-default remote deletes a coincidental ID', async () => {
    const devCtx = makeDevCtx();
    const prodCtx = makeProdCtx();

    // Step 1: Simulate a file that was pulled from production.
    // It has id: 100 from the default remote in its frontmatter.
    const articlePath = path.join(contentDir, 'prod-article.mdx');
    await fs.writeFile(articlePath, `---
title: Production Article
id: 100
slug: prod-article
type: article
language: en
---
# Production content`);

    // Step 2: Set up production metadata (knows about this article)
    await writeMetadataFile(prodCtx, {
      content: { en: { 'prod-article': { id: 100, createdAt: '2025-01-01T00:00:00Z' } } },
      emailTemplates: {},
      comments: {},
      segments: {},
      sequences: {},
    });

    // Step 3: Set up develop metadata (does NOT know about this article).
    // Develop has no entry for 'prod-article' — it was never synced there.
    await writeMetadataFile(devCtx, {
      content: {},
      emailTemplates: {},
      comments: {},
      segments: {},
      sequences: {},
    });

    // Step 4: Develop's sync returns id=100 in its deleted list.
    // This is a coincidence — a different piece of content on develop
    // happened to have id=100 and was deleted.
    harness.addContentSync([], [100], 'dev-token-1');

    await pullLeadCMSContent({ remoteContext: devCtx });

    // The production article must NOT be deleted — its frontmatter id=100
    // belongs to the default remote, not the develop remote.
    const files = await listContentFiles(contentDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('prod-article.mdx');

    const content = await fs.readFile(articlePath, 'utf-8');
    expect(content).toContain('Production content');
  });
});

// ════════════════════════════════════════════════════════════════════════
// Integration: Deleted IDs from non-default remote should use metadata
//               to resolve the correct file (Bug 2)
// ════════════════════════════════════════════════════════════════════════
describe('Pull from non-default remote: deleted IDs resolved via metadata', () => {
  it('should delete the correct file by looking up deleted ID in remote metadata', async () => {
    const devCtx = makeDevCtx();
    const prodCtx = makeProdCtx();

    // A file that was synced from both remotes.
    // Frontmatter has the production ID (50), but develop's metadata maps it to ID 300.
    const articlePath = path.join(contentDir, 'shared-article.mdx');
    await fs.writeFile(articlePath, `---
title: Shared Article
id: 50
slug: shared-article
type: article
language: en
---
# Shared content`);

    // Production metadata
    await writeMetadataFile(prodCtx, {
      content: { en: { 'shared-article': { id: 50 } } },
      emailTemplates: {},
      comments: {},
      segments: {},
      sequences: {},
    });

    // Develop metadata — knows this article as ID 300
    await writeMetadataFile(devCtx, {
      content: { en: { 'shared-article': { id: 300 } } },
      emailTemplates: {},
      comments: {},
      segments: {},
      sequences: {},
    });

    // Develop's sync says ID 300 was deleted
    harness.addContentSync([], [300], 'dev-token-1');

    await pullLeadCMSContent({ remoteContext: devCtx });

    // The file should be deleted because develop's metadata maps ID 300 → 'shared-article'
    const files = await listContentFiles(contentDir);
    expect(files).toHaveLength(0);

    // Develop's metadata should also be cleaned up
    const devMeta = await readMetadataMap(devCtx);
    expect(devMeta.content.en?.['shared-article']).toBeUndefined();
  });

  it('should not delete anything when deleted ID is unknown to the remote metadata', async () => {
    const devCtx = makeDevCtx();
    const prodCtx = makeProdCtx();

    // A file from production
    const articlePath = path.join(contentDir, 'prod-only.mdx');
    await fs.writeFile(articlePath, `---
title: Prod Only
id: 200
slug: prod-only
type: article
language: en
---
# Prod only content`);

    await writeMetadataFile(prodCtx, {
      content: { en: { 'prod-only': { id: 200 } } },
      emailTemplates: {},
      comments: {},
      segments: {},
      sequences: {},
    });

    // Develop metadata has no entries for this content
    await writeMetadataFile(devCtx, {
      content: {},
      emailTemplates: {},
      comments: {},
      segments: {},
      sequences: {},
    });

    // Develop reports some deleted IDs that don't match anything in its metadata
    harness.addContentSync([], [777, 888], 'dev-token-1');

    await pullLeadCMSContent({ remoteContext: devCtx });

    // File should still exist — deleted IDs are not in develop's metadata
    const files = await listContentFiles(contentDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('prod-only.mdx');
  });
});

// ════════════════════════════════════════════════════════════════════════
// Integration: Slug rename on non-default remote must use metadata
//               (not frontmatter) to find old file
// ════════════════════════════════════════════════════════════════════════
describe('Pull from non-default remote: slug rename uses metadata for cleanup', () => {
  it('should remove old file and create new one when slug is renamed on non-default remote', async () => {
    const devCtx = makeDevCtx();
    const prodCtx = makeProdCtx();

    // Existing file with default remote's ID in frontmatter
    const oldPath = path.join(contentDir, 'old-slug.mdx');
    await fs.writeFile(oldPath, `---
title: Old Slug Article
id: 10
slug: old-slug
type: article
language: en
---
# Old slug`);

    // Production metadata (prod has this as ID 10)
    await writeMetadataFile(prodCtx, {
      content: { en: { 'old-slug': { id: 10 } } },
      emailTemplates: {},
      comments: {},
      segments: {},
      sequences: {},
    });

    // Develop metadata (dev has this as ID 500, slug 'old-slug')
    await writeMetadataFile(devCtx, {
      content: { en: { 'old-slug': { id: 500 } } },
      emailTemplates: {},
      comments: {},
      segments: {},
      sequences: {},
    });

    // Develop's sync delivers a slug-renamed version of the same content
    harness.addContentSync([{
      id: 500,
      slug: 'new-slug',
      type: 'article',
      language: 'en',
      title: 'Renamed Article',
      description: 'Was old-slug',
      body: '# New slug',
      updatedAt: '2025-03-01T00:00:00Z',
    }], [], 'dev-token-1');

    await pullLeadCMSContent({ remoteContext: devCtx });

    const files = await listContentFiles(contentDir);
    const filenames = files.map(f => path.basename(f));

    // Old file should be removed, new file should exist
    expect(filenames).not.toContain('old-slug.mdx');
    expect(filenames).toContain('new-slug.mdx');
    expect(files).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════════════════
// Integration: New content from non-default remote should not interfere
//               with existing default-remote content
// ════════════════════════════════════════════════════════════════════════
describe('Pull from non-default remote: new content does not collide with default remote', () => {
  it('should add new content without affecting existing default-remote files', async () => {
    const devCtx = makeDevCtx();
    const prodCtx = makeProdCtx();

    // Existing file from production
    const prodPath = path.join(contentDir, 'prod-article.mdx');
    await fs.writeFile(prodPath, `---
title: Production Article
id: 42
slug: prod-article
type: article
language: en
---
# Production content`);

    await writeMetadataFile(prodCtx, {
      content: { en: { 'prod-article': { id: 42 } } },
      emailTemplates: {},
      comments: {},
      segments: {},
      sequences: {},
    });

    // Develop has no previous content synced
    await writeMetadataFile(devCtx, {
      content: {},
      emailTemplates: {},
      comments: {},
      segments: {},
      sequences: {},
    });

    // Develop's sync delivers a new article whose ID (42) coincidentally
    // matches the production article's frontmatter ID, but it's a
    // different piece of content with a different slug.
    harness.addContentSync([{
      id: 42,
      slug: 'dev-new-article',
      type: 'article',
      language: 'en',
      title: 'Dev New Article',
      description: 'Brand new on dev',
      body: '# Dev new',
      updatedAt: '2025-03-01T00:00:00Z',
    }], [], 'dev-token-1');

    await pullLeadCMSContent({ remoteContext: devCtx });

    const files = await listContentFiles(contentDir);
    const filenames = files.map(f => path.basename(f));

    // Both files should exist — the new dev article and the existing prod article
    expect(filenames).toContain('prod-article.mdx');
    expect(filenames).toContain('dev-new-article.mdx');
    expect(files).toHaveLength(2);

    // Production article should be untouched
    const prodContent = await fs.readFile(prodPath, 'utf-8');
    expect(prodContent).toContain('Production content');
  });
});
