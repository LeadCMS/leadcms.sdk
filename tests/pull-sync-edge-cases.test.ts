/**
 * Integration tests: pull sync edge cases that lead to inconsistent local state.
 *
 * These tests call the real fetchLeadCMSContent function and only mock the
 * HTTP layer (axios). Each test targets a specific scenario where the local
 * filesystem can become out of sync with the remote after a pull.
 *
 * Guiding principle (from the user):
 *   "Whatever change we do to content or media (add, update, delete, rename,
 *    etc) must be reflected locally when we pull. It should not result in any
 *    duplicated files, deleted files being still preserved, old-named files
 *    being kept, or any other inconsistencies between remote and local state."
 */

import fsPromises from 'fs/promises';
import path from 'path';
import os from 'os';
import { jest } from '@jest/globals';
import { listContentFiles, listAllFiles, createSyncTestHarness } from './test-helpers';

// ── Temp directories for isolation ─────────────────────────────────────
const tmpRoot = path.join(os.tmpdir(), 'leadcms-sync-edge-cases');
const contentDir = path.join(tmpRoot, 'content');
const mediaDir = path.join(tmpRoot, 'media');

const harness = createSyncTestHarness({ contentDir, mediaDir });

jest.mock('../src/lib/config.js', () => ({
  getConfig: jest.fn(() => harness.config),
}));
jest.mock('axios', () => harness.axiosMock);

import { fetchLeadCMSContent } from '../src/scripts/fetch-leadcms-content';

// ── Shared setup / teardown ────────────────────────────────────────────
beforeEach(() => harness.setup());
afterEach(() => harness.cleanup());

// ════════════════════════════════════════════════════════════════════════
//  BUG: Content type change (MDX → JSON) leaves stale .mdx file
// ════════════════════════════════════════════════════════════════════════
describe('Pull: content type change (MDX → JSON)', () => {
  it('should have only one file after content type changes from article to component', async () => {
    // Pull 1: content is an article (MDX)
    const v1 = {
      id: 10,
      slug: 'hero-section',
      type: 'article',
      language: 'en',
      title: 'Hero Section',
      description: 'A hero section',
      body: '# Hero',
      publishedAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    };

    // Pull 2: same content is now a component (JSON)
    const v2 = {
      id: 10,
      slug: 'hero-section',
      type: 'component',
      language: 'en',
      title: 'Hero Section',
      description: 'A hero section',
      body: JSON.stringify({ heading: 'Welcome' }),
      updatedAt: '2025-02-01T00:00:00Z',
    };

    harness.addContentSync([v1], [], 'token-1');
    harness.addContentSync([v2], [], 'token-2');

    await fetchLeadCMSContent();

    const afterFirst = await listContentFiles(contentDir);
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0]).toContain('hero-section.mdx');

    await fetchLeadCMSContent();

    // Expectation: only hero-section.json should exist
    const afterSecond = await listContentFiles(contentDir);
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0]).toContain('hero-section.json');
  });
});

// ════════════════════════════════════════════════════════════════════════
//  BUG: Language change leaves stale file in old locale directory
// ════════════════════════════════════════════════════════════════════════
describe('Pull: content language change', () => {
  it('should have only one file after content language changes from en to fr', async () => {
    // Pull 1: content in default language (en) → saved in contentDir root
    const v1 = {
      id: 20,
      slug: 'about-us',
      type: 'article',
      language: 'en',
      title: 'About Us',
      description: 'About page',
      body: '# About',
      publishedAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    };

    // Pull 2: language changed to fr → saved in contentDir/fr/
    const v2 = {
      ...v1,
      language: 'fr',
      title: 'À propos',
      body: '# À propos',
      updatedAt: '2025-02-01T00:00:00Z',
    };

    harness.addContentSync([v1], [], 'token-1');
    harness.addContentSync([v2], [], 'token-2');

    await fetchLeadCMSContent();

    const afterFirst = await listContentFiles(contentDir);
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0]).toContain('about-us.mdx');
    // Should be in root (default language)
    expect(afterFirst[0]).not.toContain('/fr/');

    await fetchLeadCMSContent();

    // Expectation: only one file, in the fr/ subdirectory
    const afterSecond = await listContentFiles(contentDir);
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0]).toContain('/fr/');
    expect(afterSecond[0]).toContain('about-us.mdx');
  });
});

// ════════════════════════════════════════════════════════════════════════
//  BUG: Slug + type + language all change simultaneously
// ════════════════════════════════════════════════════════════════════════
describe('Pull: slug + type + language change simultaneously', () => {
  it('should have only one file after combined slug, type, and language change', async () => {
    const v1 = {
      id: 30,
      slug: 'old-nav',
      type: 'article',
      language: 'en',
      title: 'Navigation',
      description: 'Nav component',
      body: '# Navigation',
      publishedAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    };

    // Everything changed: slug, type (MDX→JSON), and language (en→de)
    const v2 = {
      id: 30,
      slug: 'new-navigation',
      type: 'component',
      language: 'de',
      title: 'Navigation',
      description: 'Nav component',
      body: JSON.stringify({ items: [{ label: 'Home' }] }),
      updatedAt: '2025-02-01T00:00:00Z',
    };

    harness.addContentSync([v1], [], 'token-1');
    harness.addContentSync([v2], [], 'token-2');

    await fetchLeadCMSContent();

    const afterFirst = await listContentFiles(contentDir);
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0]).toContain('old-nav.mdx');

    await fetchLeadCMSContent();

    // Expectation: only one file: de/new-navigation.json
    const afterSecond = await listContentFiles(contentDir);
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0]).toContain('/de/');
    expect(afterSecond[0]).toContain('new-navigation.json');
  });
});

// ════════════════════════════════════════════════════════════════════════
//  BUG: Remote content deletion should remove local file
// ════════════════════════════════════════════════════════════════════════
describe('Pull: remote content deletion', () => {
  it('should remove the local file when content is deleted remotely', async () => {
    const v1 = {
      id: 40,
      slug: 'temp-article',
      type: 'article',
      language: 'en',
      title: 'Temporary Article',
      description: 'Will be deleted',
      body: '# Temp',
      publishedAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    };

    harness.addContentSync([v1], [], 'token-1');
    // Second pull: no items, but id=40 in deleted list
    harness.addContentSync([], [40], 'token-2');

    await fetchLeadCMSContent();

    const afterFirst = await listContentFiles(contentDir);
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0]).toContain('temp-article.mdx');

    await fetchLeadCMSContent();

    // Expectation: NO content files remain
    const afterSecond = await listContentFiles(contentDir);
    expect(afterSecond).toHaveLength(0);
  });

  it('should remove JSON content when deleted remotely', async () => {
    const v1 = {
      id: 41,
      slug: 'footer-config',
      type: 'component',
      language: 'en',
      title: 'Footer',
      body: JSON.stringify({ copyright: '2025' }),
      updatedAt: '2025-01-01T00:00:00Z',
    };

    harness.addContentSync([v1], [], 'token-1');
    harness.addContentSync([], [41], 'token-2');

    await fetchLeadCMSContent();

    const afterFirst = await listContentFiles(contentDir);
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0]).toContain('footer-config.json');

    await fetchLeadCMSContent();

    const afterSecond = await listContentFiles(contentDir);
    expect(afterSecond).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════
//  BUG: Non-default language content deletion
// ════════════════════════════════════════════════════════════════════════
describe('Pull: non-default language content deletion', () => {
  it('should remove locale-specific file when content is deleted remotely', async () => {
    const v1 = {
      id: 50,
      slug: 'greeting',
      type: 'article',
      language: 'es',
      title: 'Saludo',
      description: 'Spanish greeting',
      body: '# Hola',
      publishedAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    };

    harness.addContentSync([v1], [], 'token-1');
    harness.addContentSync([], [50], 'token-2');

    await fetchLeadCMSContent();

    const afterFirst = await listContentFiles(contentDir);
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0]).toContain('/es/');

    await fetchLeadCMSContent();

    const afterSecond = await listContentFiles(contentDir);
    expect(afterSecond).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════
//  Content update should overwrite existing file (not create duplicate)
// ════════════════════════════════════════════════════════════════════════
describe('Pull: content update (same slug)', () => {
  it('should overwrite existing file when content body changes', async () => {
    const v1 = {
      id: 60,
      slug: 'blog-post',
      type: 'article',
      language: 'en',
      title: 'Blog Post',
      description: 'First version',
      body: '# Version 1',
      publishedAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    };

    const v2 = {
      ...v1,
      title: 'Blog Post Updated',
      body: '# Version 2 — updated content',
      updatedAt: '2025-02-01T00:00:00Z',
    };

    harness.addContentSync([v1], [], 'token-1');
    harness.addContentSync([v2], [], 'token-2');

    await fetchLeadCMSContent();
    await fetchLeadCMSContent();

    const files = await listContentFiles(contentDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('blog-post.mdx');

    // Verify the file has the updated content
    const content = await fsPromises.readFile(files[0], 'utf-8');
    expect(content).toContain('Version 2');
    expect(content).not.toContain('Version 1');
  });
});

// ════════════════════════════════════════════════════════════════════════
//  Multiple content items — one deleted, one updated, one new
// ════════════════════════════════════════════════════════════════════════
describe('Pull: mixed operations in single sync', () => {
  it('should handle create, update, and delete in one pull correctly', async () => {
    const item1 = {
      id: 70,
      slug: 'page-one',
      type: 'article',
      language: 'en',
      title: 'Page One',
      description: 'Original',
      body: '# Page One',
      publishedAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    };

    const item2 = {
      id: 71,
      slug: 'page-two',
      type: 'article',
      language: 'en',
      title: 'Page Two',
      description: 'Will be deleted',
      body: '# Page Two',
      publishedAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    };

    // First pull: two articles
    harness.addContentSync([item1, item2], [], 'token-1');

    await fetchLeadCMSContent();

    const afterFirst = await listContentFiles(contentDir);
    expect(afterFirst).toHaveLength(2);

    // Second pull: item1 updated, item2 deleted, item3 new
    const item1Updated = {
      ...item1,
      title: 'Page One V2',
      body: '# Page One Updated',
      updatedAt: '2025-02-01T00:00:00Z',
    };

    const item3 = {
      id: 72,
      slug: 'page-three',
      type: 'article',
      language: 'en',
      title: 'Page Three',
      description: 'Brand new',
      body: '# Page Three',
      publishedAt: '2025-02-01T00:00:00Z',
      updatedAt: '2025-02-01T00:00:00Z',
    };

    harness.addContentSync([item1Updated, item3], [71], 'token-2');

    await fetchLeadCMSContent();

    const afterSecond = await listContentFiles(contentDir);
    // Should have page-one.mdx (updated) and page-three.mdx (new), NOT page-two.mdx
    expect(afterSecond).toHaveLength(2);
    const filenames = afterSecond.map(f => path.basename(f));
    expect(filenames).toContain('page-one.mdx');
    expect(filenames).toContain('page-three.mdx');
    expect(filenames).not.toContain('page-two.mdx');

    // Verify updated content
    const pageOneContent = await fsPromises.readFile(
      afterSecond.find(f => f.includes('page-one'))!,
      'utf-8',
    );
    expect(pageOneContent).toContain('Page One Updated');
  });
});

// ════════════════════════════════════════════════════════════════════════
//  BUG: Nested slug rename (blog/old-post → blog/new-post)
// ════════════════════════════════════════════════════════════════════════
describe('Pull: nested slug rename', () => {
  it('should not leave old file when slug with path prefix is renamed', async () => {
    const v1 = {
      id: 80,
      slug: 'blog/my-first-post',
      type: 'article',
      language: 'en',
      title: 'My First Post',
      description: 'A blog post',
      body: '# First Post',
      publishedAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    };

    const v2 = {
      ...v1,
      slug: 'blog/my-renamed-post',
      updatedAt: '2025-02-01T00:00:00Z',
    };

    harness.addContentSync([v1], [], 'token-1');
    harness.addContentSync([v2], [], 'token-2');

    await fetchLeadCMSContent();

    const afterFirst = await listContentFiles(contentDir);
    expect(afterFirst).toHaveLength(1);
    expect(afterFirst[0]).toContain('my-first-post.mdx');

    await fetchLeadCMSContent();

    const afterSecond = await listContentFiles(contentDir);
    expect(afterSecond).toHaveLength(1);
    expect(afterSecond[0]).toContain('my-renamed-post.mdx');
  });
});

// ════════════════════════════════════════════════════════════════════════
//  Media deletion: remote sync returns deleted media via MediaDeletedDto
// ════════════════════════════════════════════════════════════════════════
describe('Pull: media deletion', () => {
  it('should remove local media file when media is deleted remotely', async () => {
    // Pre-create a media file locally (simulating a previous pull)
    const mediaPath = path.join(mediaDir, 'images', 'photo.jpg');
    await fsPromises.mkdir(path.dirname(mediaPath), { recursive: true });
    await fsPromises.writeFile(mediaPath, 'fake-image-data');

    // Content sync returns nothing
    harness.addContentSync([], [], 'token-1');

    // Media sync returns the deleted item (MediaDeletedDto: { scopeUid, name })
    harness.addMediaSync([], [{ scopeUid: 'images', name: 'photo.jpg' }], 'media-token-1');

    await fetchLeadCMSContent();

    const mediaFiles = await listAllFiles(mediaDir);
    const hasPhoto = mediaFiles.some(f => f.includes('photo.jpg'));

    // File should be deleted because the sync response includes it in the deleted array
    expect(hasPhoto).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════
//  Media rename: old location appears in deleted, new location in items
// ════════════════════════════════════════════════════════════════════════
describe('Pull: media rename', () => {
  it('should delete old media file and download new one when media is renamed', async () => {
    // Pre-create the old media file locally (simulating a previous pull)
    const oldMediaPath = path.join(mediaDir, 'photos', 'old-name.jpg');
    await fsPromises.mkdir(path.dirname(oldMediaPath), { recursive: true });
    await fsPromises.writeFile(oldMediaPath, 'fake-image-data');

    // Content sync returns nothing
    harness.addContentSync([], [], 'token-1');

    // Media sync returns the renamed media:
    //  - deleted array has old location (MediaDeletedDto)
    //  - items array has new location (MediaDetailsDto)
    harness.addMediaSync(
      [{ location: '/api/media/photos/new-name.jpg' }],
      [{ scopeUid: 'photos', name: 'old-name.jpg' }],
      'media-token-1',
    );

    await fetchLeadCMSContent();

    const mediaFiles = await listAllFiles(mediaDir);
    const hasOld = mediaFiles.some(f => f.includes('old-name.jpg'));
    const hasNew = mediaFiles.some(f => f.includes('new-name.jpg'));

    // Old file should be removed, new file should exist
    expect(hasOld).toBe(false);
    expect(hasNew).toBe(true);
  });

  it('should handle scope change during rename (moved to different folder)', async () => {
    // Pre-create the old media file
    const oldMediaPath = path.join(mediaDir, 'blog', 'post-1', 'banner.png');
    await fsPromises.mkdir(path.dirname(oldMediaPath), { recursive: true });
    await fsPromises.writeFile(oldMediaPath, 'fake-banner-data');

    harness.addContentSync([], [], 'token-1');

    // Media renamed and moved to a different scope
    harness.addMediaSync(
      [{ location: '/api/media/blog/post-2/banner.png' }],
      [{ scopeUid: 'blog/post-1', name: 'banner.png' }],
      'media-token-1',
    );

    await fetchLeadCMSContent();

    const mediaFiles = await listAllFiles(mediaDir);
    const hasOldLocation = mediaFiles.some(f => f.includes('post-1') && f.includes('banner.png'));
    const hasNewLocation = mediaFiles.some(f => f.includes('post-2') && f.includes('banner.png'));

    expect(hasOldLocation).toBe(false);
    expect(hasNewLocation).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════
//  Content with same slug in different languages should coexist
// ════════════════════════════════════════════════════════════════════════
describe('Pull: same slug in multiple languages', () => {
  it('should maintain separate files per language without conflicts', async () => {
    const enContent = {
      id: 90,
      slug: 'home',
      type: 'article',
      language: 'en',
      title: 'Home',
      description: 'English home',
      body: '# Welcome',
      publishedAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    };

    const frContent = {
      id: 91,
      slug: 'home',
      type: 'article',
      language: 'fr',
      title: 'Accueil',
      description: 'French home',
      body: '# Bienvenue',
      publishedAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    };

    harness.addContentSync([enContent, frContent], [], 'token-1');

    await fetchLeadCMSContent();

    const files = await listContentFiles(contentDir);
    expect(files).toHaveLength(2);

    const enFile = files.find(f => !f.includes('/fr/'));
    const frFile = files.find(f => f.includes('/fr/'));

    expect(enFile).toBeDefined();
    expect(frFile).toBeDefined();
    expect(enFile!).toContain('home.mdx');
    expect(frFile!).toContain('home.mdx');

    // Now delete only the French version
    harness.addContentSync([], [91], 'token-2');

    await fetchLeadCMSContent();

    const afterDelete = await listContentFiles(contentDir);
    // Only English should remain
    expect(afterDelete).toHaveLength(1);
    expect(afterDelete[0]).not.toContain('/fr/');
    expect(afterDelete[0]).toContain('home.mdx');
  });
});

// ════════════════════════════════════════════════════════════════════════
//  Slug rename to path that already exists from different content
// ════════════════════════════════════════════════════════════════════════
describe('Pull: slug collision after rename', () => {
  it('should not lose content when two items are renamed in a swap', async () => {
    // Two articles initially
    const itemA = {
      id: 100,
      slug: 'alpha',
      type: 'article',
      language: 'en',
      title: 'Alpha',
      description: 'Alpha article',
      body: '# Alpha',
      publishedAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    };

    const itemB = {
      id: 101,
      slug: 'beta',
      type: 'article',
      language: 'en',
      title: 'Beta',
      description: 'Beta article',
      body: '# Beta',
      publishedAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    };

    harness.addContentSync([itemA, itemB], [], 'token-1');

    await fetchLeadCMSContent();

    const afterFirst = await listContentFiles(contentDir);
    expect(afterFirst).toHaveLength(2);

    // Swap slugs: alpha → beta-new, beta → alpha-new
    const itemARenamed = {
      ...itemA,
      slug: 'beta-new',
      updatedAt: '2025-02-01T00:00:00Z',
    };
    const itemBRenamed = {
      ...itemB,
      slug: 'alpha-new',
      updatedAt: '2025-02-01T00:00:00Z',
    };

    harness.addContentSync([itemARenamed, itemBRenamed], [], 'token-2');

    await fetchLeadCMSContent();

    const afterSecond = await listContentFiles(contentDir);
    // Should have exactly 2 files with new names, no old ones
    expect(afterSecond).toHaveLength(2);
    const names = afterSecond.map(f => path.basename(f));
    expect(names).toContain('beta-new.mdx');
    expect(names).toContain('alpha-new.mdx');
    expect(names).not.toContain('alpha.mdx');
    expect(names).not.toContain('beta.mdx');
  });
});
