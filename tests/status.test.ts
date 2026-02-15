/**
 * Unit tests for LeadCMS status / matchContent functionality
 * Tests the real matchContent logic from push-leadcms-content.ts
 */

import { jest } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import matter from 'gray-matter';
import { createTestConfig, createDataServiceMock } from './test-helpers';

// Mock the data service before importing the module under test
jest.mock('../src/lib/data-service.js', () => ({
  leadCMSDataService: createDataServiceMock(),
}));

jest.mock('../src/lib/config.js', () => ({
  getConfig: jest.fn(() => createTestConfig()),
}));

// Import after mocks are set up
import { matchContent, countPushChanges } from '../src/scripts/push-leadcms-content';
import { transformRemoteForComparison, hasContentDifferences } from '../src/lib/content-transformation';

// Helper types matching the internal SDK types
interface LocalContentItem {
  filePath: string;
  slug: string;
  locale: string;
  type: string;
  metadata: Record<string, any>;
  body: string;
  isLocal: boolean;
}

interface RemoteContentItem {
  id: number;
  slug: string;
  type: string;
  language: string;
  title: string;
  body: string;
  updatedAt: string;
  createdAt: string;
  isLocal: false;
  [key: string]: any;
}

function makeLocal(overrides: Partial<LocalContentItem> & { slug: string }): LocalContentItem {
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

function makeRemote(overrides: Partial<RemoteContentItem> & { id: number; slug: string }): RemoteContentItem {
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

describe('LeadCMS Status Analysis (Real SDK Logic)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'leadcms-status-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('matchContent - New Content Detection', () => {
    it('should detect new content that does not exist remotely', async () => {
      const filePath = path.join(tmpDir, 'new-article.mdx');
      await fs.writeFile(filePath, matter.stringify('# New Article', { title: 'New Article', type: 'article' }));

      const local = [makeLocal({
        slug: 'new-article',
        filePath,
        metadata: { title: 'New Article', type: 'article' },
      })];

      const ops = await (matchContent as any)(local, []);

      expect(ops.create).toHaveLength(1);
      expect(ops.create[0].local.slug).toBe('new-article');
      expect(ops.update).toHaveLength(0);
      expect(ops.conflict).toHaveLength(0);
    });

    it('should detect multiple new content items', async () => {
      const file1 = path.join(tmpDir, 'article-1.mdx');
      const file2 = path.join(tmpDir, 'page-1.mdx');
      await fs.writeFile(file1, matter.stringify('Content 1', { title: 'Article 1', type: 'article' }));
      await fs.writeFile(file2, matter.stringify('Content 2', { title: 'Page 1', type: 'page' }));

      const local = [
        makeLocal({ slug: 'article-1', filePath: file1, type: 'article', metadata: { title: 'Article 1', type: 'article' } }),
        makeLocal({ slug: 'page-1', filePath: file2, type: 'page', metadata: { title: 'Page 1', type: 'page' } }),
      ];

      const ops = await (matchContent as any)(local, []);

      expect(ops.create).toHaveLength(2);
    });
  });

  describe('matchContent - Conflict Detection', () => {
    it('should detect conflict when remote updatedAt is newer than local', async () => {
      const filePath = path.join(tmpDir, 'conflicted.mdx');
      await fs.writeFile(filePath, matter.stringify('Local content', {
        title: 'Conflicted Article',
        type: 'article',
        updatedAt: '2024-01-01T00:00:00Z',
      }));

      const local = [makeLocal({
        slug: 'conflicted',
        filePath,
        metadata: {
          id: 1,
          title: 'Conflicted Article',
          type: 'article',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      })];

      const remote = [makeRemote({
        id: 1,
        slug: 'conflicted',
        title: 'Conflicted Article',
        updatedAt: '2024-06-15T12:00:00Z',
      })];

      const ops = await (matchContent as any)(local, remote);

      expect(ops.conflict).toHaveLength(1);
      expect(ops.conflict[0].local.slug).toBe('conflicted');
      expect(ops.conflict[0].reason).toContain('Remote content was updated after local content');
      expect(ops.update).toHaveLength(0);
    });

    it('should detect conflict with slug change when remote is newer', async () => {
      const filePath = path.join(tmpDir, 'new-slug.mdx');
      await fs.writeFile(filePath, matter.stringify('Content', {
        title: 'My Article',
        type: 'article',
        updatedAt: '2024-01-01T00:00:00Z',
      }));

      const local = [makeLocal({
        slug: 'new-slug',
        filePath,
        metadata: {
          id: 1,
          title: 'My Article',
          type: 'article',
          updatedAt: '2024-01-01T00:00:00Z',
        },
      })];

      const remote = [makeRemote({
        id: 1,
        slug: 'old-slug',
        title: 'My Article',
        updatedAt: '2024-06-15T12:00:00Z',
      })];

      const ops = await (matchContent as any)(local, remote);

      expect(ops.conflict).toHaveLength(1);
      expect(ops.conflict[0].reason).toContain('Slug changed remotely');
    });

    it('should detect language-specific conflicts independently', async () => {
      const fileEn = path.join(tmpDir, 'article-en.mdx');
      const fileEs = path.join(tmpDir, 'article-es.mdx');
      await fs.writeFile(fileEn, matter.stringify('English content', {
        title: 'English Article',
        type: 'article',
        updatedAt: '2024-01-01T00:00:00Z',
      }));
      await fs.writeFile(fileEs, matter.stringify('Spanish content', {
        title: 'Spanish Article',
        type: 'article',
        updatedAt: '2024-06-15T00:00:00Z',
      }));

      const local = [
        makeLocal({
          slug: 'article',
          filePath: fileEn,
          locale: 'en',
          metadata: { id: 1, type: 'article', title: 'English Article', updatedAt: '2024-01-01T00:00:00Z' },
        }),
        makeLocal({
          slug: 'article',
          filePath: fileEs,
          locale: 'es',
          metadata: { id: 2, type: 'article', title: 'Spanish Article', updatedAt: '2024-06-15T00:00:00Z' },
        }),
      ];

      const remote = [
        makeRemote({ id: 1, slug: 'article', language: 'en', updatedAt: '2024-06-15T12:00:00Z' }),
        makeRemote({ id: 2, slug: 'article', language: 'es', updatedAt: '2024-01-01T00:00:00Z' }),
      ];

      const ops = await (matchContent as any)(local, remote);

      // EN should be conflict (remote newer)
      const enConflict = ops.conflict.find((op: any) => op.local.locale === 'en');
      expect(enConflict).toBeDefined();
      // ES should NOT be conflict (local newer)
      expect(ops.conflict.filter((op: any) => op.local.locale === 'es')).toHaveLength(0);
    });
  });

  describe('matchContent - Slug Changes (Renames)', () => {
    it('should detect slug rename when matched by ID and local is newer', async () => {
      const filePath = path.join(tmpDir, 'new-article-slug.mdx');
      await fs.writeFile(filePath, matter.stringify('Content', {
        title: 'My Article',
        type: 'article',
        updatedAt: '2024-06-15T00:00:00Z',
      }));

      const local = [makeLocal({
        slug: 'new-article-slug',
        filePath,
        metadata: {
          id: 123,
          title: 'My Article',
          type: 'article',
          updatedAt: '2024-06-15T00:00:00Z',
        },
      })];

      const remote = [makeRemote({
        id: 123,
        slug: 'old-article-slug',
        title: 'My Article',
        updatedAt: '2024-01-01T00:00:00Z',
      })];

      const ops = await (matchContent as any)(local, remote);

      expect(ops.rename).toHaveLength(1);
      expect(ops.rename[0].oldSlug).toBe('old-article-slug');
      expect(ops.rename[0].local.slug).toBe('new-article-slug');
    });

    it('should detect slug rename when matched by title', async () => {
      const filePath = path.join(tmpDir, 'about-us-page.mdx');
      await fs.writeFile(filePath, matter.stringify('About content', {
        title: 'About Us',
        type: 'page',
        updatedAt: '2024-06-15T00:00:00Z',
      }));

      const local = [makeLocal({
        slug: 'about-us-page',
        filePath,
        type: 'page',
        metadata: {
          title: 'About Us',
          type: 'page',
          updatedAt: '2024-06-15T00:00:00Z',
        },
      })];

      const remote = [makeRemote({
        id: 456,
        slug: 'about-us',
        type: 'page',
        title: 'About Us',
        updatedAt: '2024-01-01T00:00:00Z',
      })];

      const ops = await (matchContent as any)(local, remote);

      expect(ops.rename).toHaveLength(1);
      expect(ops.rename[0].oldSlug).toBe('about-us');
      expect(ops.rename[0].local.slug).toBe('about-us-page');
    });
  });

  describe('matchContent - Content Type Changes', () => {
    it('should detect content type change when local is newer', async () => {
      const filePath = path.join(tmpDir, 'header.json');
      await fs.writeFile(filePath, JSON.stringify({
        title: 'Header Component',
        type: 'component',
        updatedAt: '2024-06-15T00:00:00Z',
        body: '{}',
      }));

      const local = [makeLocal({
        slug: 'header',
        filePath,
        type: 'component',
        metadata: {
          id: 789,
          title: 'Header Component',
          type: 'component',
          updatedAt: '2024-06-15T00:00:00Z',
        },
      })];

      const remote = [makeRemote({
        id: 789,
        slug: 'header',
        type: 'layout',
        title: 'Header Component',
        updatedAt: '2024-01-01T00:00:00Z',
      })];

      const ops = await (matchContent as any)(local, remote);

      expect(ops.typeChange).toHaveLength(1);
      expect(ops.typeChange[0].oldType).toBe('layout');
      expect(ops.typeChange[0].newType).toBe('component');
    });

    it('should detect combined slug and type changes', async () => {
      const filePath = path.join(tmpDir, 'featured-blog-post.mdx');
      await fs.writeFile(filePath, matter.stringify('Blog content', {
        title: 'Featured Post',
        type: 'blog-article',
        updatedAt: '2024-06-15T00:00:00Z',
      }));

      const local = [makeLocal({
        slug: 'featured-blog-post',
        filePath,
        type: 'blog-article',
        metadata: {
          id: 999,
          title: 'Featured Post',
          type: 'blog-article',
          updatedAt: '2024-06-15T00:00:00Z',
        },
      })];

      const remote = [makeRemote({
        id: 999,
        slug: 'featured-post',
        type: 'article',
        title: 'Featured Post',
        updatedAt: '2024-01-01T00:00:00Z',
      })];

      const ops = await (matchContent as any)(local, remote);

      expect(ops.typeChange).toHaveLength(1);
      expect(ops.typeChange[0].oldSlug).toBe('featured-post');
      expect(ops.typeChange[0].oldType).toBe('article');
      expect(ops.typeChange[0].newType).toBe('blog-article');
    });
  });

  describe('matchContent - Deletion Detection', () => {
    it('should detect remote-only content when allowDelete is true', async () => {
      const remote = [makeRemote({
        id: 100,
        slug: 'only-on-remote',
        title: 'Remote Only Article',
      })];

      const ops = await (matchContent as any)([], remote, undefined, true);

      expect(ops.delete).toHaveLength(1);
      expect(ops.delete[0].remote?.slug).toBe('only-on-remote');
    });

    it('should NOT detect deletions when allowDelete is false', async () => {
      const remote = [makeRemote({
        id: 100,
        slug: 'only-on-remote',
        title: 'Remote Only Article',
      })];

      const ops = await (matchContent as any)([], remote, undefined, false);

      expect(ops.delete).toHaveLength(0);
    });
  });

  describe('countPushChanges', () => {
    it('should count all operations excluding conflicts by default', () => {
      const ops = {
        create: [{ local: {} }],
        update: [{ local: {} }, { local: {} }],
        rename: [{ local: {} }],
        typeChange: [{ local: {} }],
        conflict: [{ local: {} }, { local: {} }],
        delete: [],
      };

      expect(countPushChanges(ops as any, false)).toBe(5);
      expect(countPushChanges(ops as any, true)).toBe(7);
    });

    it('should return 0 for empty operations', () => {
      const ops = {
        create: [],
        update: [],
        rename: [],
        typeChange: [],
        conflict: [],
        delete: [],
      };

      expect(countPushChanges(ops as any, false)).toBe(0);
      expect(countPushChanges(ops as any, true)).toBe(0);
    });
  });

  describe('matchContent - JSON Field Removal Detection', () => {
    it('should detect removal of coverImageUrl and coverImageAlt from JSON content', async () => {
      // Simulate a JSON component where the user removed coverImageUrl and coverImageAlt locally.
      // Key order MUST match what transformToJSONFormat produces after a pull:
      // body fields first (pricing, labels), then remote fields in their iteration order.
      // With makeRemote, remote keys are: type, language, title, body, createdAt, updatedAt, isLocal,
      // then overrides: id, slug, description, coverImageUrl(removed), coverImageAlt(removed),
      // author, publishedAt, category, tags, allowComments.
      // The pulled file would also have coverImageUrl and coverImageAlt; user removes them.
      const localJsonContent = {
        pricing: {
          currency: 'USD',
          websiteTypes: [{ id: 'saas-product', label: 'SaaS Product', baseCost: 3500 }]
        },
        labels: { title: 'Website Cost Calculator' },
        type: 'component',
        language: 'en',
        title: 'Site Calculator Configuration',
        createdAt: '2026-02-06T11:48:52.627633Z',
        updatedAt: '2026-02-06T12:00:00Z',
        id: 97,
        slug: 'site-calculator-config',
        description: 'Pricing weights and labels for the website cost calculator component.',
        // coverImageUrl and coverImageAlt removed by user (would appear here in the original pulled file)
        author: 'LeadCMS Team',
        publishedAt: '2026-02-06T00:00:00Z',
        category: '',
        tags: [] as string[],
        allowComments: false,
      };

      const filePath = path.join(tmpDir, 'site-calculator-config.json');
      await fs.writeFile(filePath, JSON.stringify(localJsonContent, null, 2));

      const local = [makeLocal({
        slug: 'site-calculator-config',
        filePath,
        type: 'component',
        metadata: {
          id: 97,
          title: 'Site Calculator Configuration',
          type: 'component',
          updatedAt: '2026-02-06T12:00:00Z',
        },
      })];

      // Remote still has coverImageUrl and coverImageAlt
      const remote = [makeRemote({
        id: 97,
        slug: 'site-calculator-config',
        type: 'component',
        title: 'Site Calculator Configuration',
        description: 'Pricing weights and labels for the website cost calculator component.',
        coverImageUrl: '/media/common/calculator-config.jpg',
        coverImageAlt: 'Website cost calculator configuration',
        language: 'en',
        author: 'LeadCMS Team',
        createdAt: '2026-02-06T11:48:52.627633Z',
        updatedAt: '2026-02-06T12:00:00Z',
        publishedAt: '2026-02-06T00:00:00Z',
        category: '',
        tags: [],
        allowComments: false,
        body: JSON.stringify({
          pricing: {
            currency: 'USD',
            websiteTypes: [{ id: 'saas-product', label: 'SaaS Product', baseCost: 3500 }]
          },
          labels: { title: 'Website Cost Calculator' },
        }),
      })];

      // Pass typeMap so JSON comparison path is used
      const typeMap = { component: 'JSON' };
      const ops = await (matchContent as any)(local, remote, typeMap);

      // The removal of coverImageUrl and coverImageAlt should be detected as an update
      expect(ops.update).toHaveLength(1);
      expect(ops.update[0].local.slug).toBe('site-calculator-config');
      expect(ops.create).toHaveLength(0);
      expect(ops.conflict).toHaveLength(0);
    });

    it('should detect removal of a standard API field from JSON content via transformRemoteForComparison', async () => {
      // Local JSON file without coverImageUrl - key order matches transform output
      const localContent = JSON.stringify({
        pricing: { currency: 'USD' },
        id: 1,
        slug: 'test',
        type: 'component',
        title: 'Test',
        updatedAt: '2026-01-01T00:00:00Z',
      }, null, 2);

      // Remote content has coverImageUrl
      const remote = {
        id: 1,
        slug: 'test',
        type: 'component',
        title: 'Test',
        coverImageUrl: '/media/test.jpg',
        updatedAt: '2026-01-01T00:00:00Z',
        body: JSON.stringify({ pricing: { currency: 'USD' } }),
      };

      const typeMap = { component: 'JSON' };
      const transformed = await transformRemoteForComparison(remote, localContent, typeMap);

      // The transformed remote should include coverImageUrl since it exists remotely
      expect(transformed).toContain('coverImageUrl');

      const hasDiff = hasContentDifferences(localContent, transformed);
      // Should detect the difference (coverImageUrl exists in remote but not in local)
      expect(hasDiff).toBe(true);
    });

    it('should still show no changes when JSON content is identical', async () => {
      // Both local and remote have the same fields
      // Key order matches what transformToJSONFormat would produce:
      // body fields first (pricing), then remote fields in their iteration order
      const localContent = JSON.stringify({
        pricing: { currency: 'USD' },
        id: 1,
        slug: 'test',
        type: 'component',
        title: 'Test',
        coverImageUrl: '/media/test.jpg',
        updatedAt: '2026-01-01T00:00:00Z',
      }, null, 2);

      const remote = {
        id: 1,
        slug: 'test',
        type: 'component',
        title: 'Test',
        coverImageUrl: '/api/media/test.jpg',
        updatedAt: '2026-01-01T00:00:00Z',
        body: JSON.stringify({ pricing: { currency: 'USD' } }),
      };

      const typeMap = { component: 'JSON' };
      const transformed = await transformRemoteForComparison(remote, localContent, typeMap);
      const hasDiff = hasContentDifferences(localContent, transformed);

      // No differences - content is the same (coverImageUrl present in both, /api/media/ transformed to /media/)
      expect(hasDiff).toBe(false);
    });
  });
});
