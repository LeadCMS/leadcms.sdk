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

      const typeMap = { component: 'JSON' } as const;
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

      const typeMap = { component: 'JSON' } as const;
      const transformed = await transformRemoteForComparison(remote, localContent, typeMap);
      const hasDiff = hasContentDifferences(localContent, transformed);

      // No differences - content is the same (coverImageUrl present in both, /api/media/ transformed to /media/)
      expect(hasDiff).toBe(false);
    });
  });

  describe('matchContent - Multi-remote slug rename with metadata map', () => {
    it('should detect rename (not conflict) when slug changes locally and timestamps match via metadata map', async () => {
      // User moved components/header.json → header.json
      // Metadata map still has the entry under the old slug
      const filePath = path.join(tmpDir, 'header.json');
      await fs.writeFile(filePath, JSON.stringify({
        title: 'Header',
        type: 'component',
        body: '{}',
      }));

      const local = [makeLocal({
        slug: 'header',
        filePath,
        type: 'component',
        metadata: { id: 14, title: 'Header', type: 'component' },
      })];

      const remote = [makeRemote({
        id: 14,
        slug: 'components/header',
        type: 'component',
        title: 'Header',
        createdAt: '2025-07-29T19:18:59.897718Z',
        updatedAt: '2025-07-29T19:19:42.203593Z',
      })];

      // Metadata map stores timestamps under the OLD slug
      const metadataMap = {
        content: {
          en: {
            'components/header': {
              id: 14,
              createdAt: '2025-07-29T19:18:59.897718Z',
              updatedAt: '2025-07-29T19:19:42.203593Z',
            },
          },
        },
        emailTemplates: {},
        comments: {},
      };

      const ops = await (matchContent as any)(local, remote, undefined, false, metadataMap);

      expect(ops.rename).toHaveLength(1);
      expect(ops.rename[0].oldSlug).toBe('components/header');
      expect(ops.rename[0].local.slug).toBe('header');
      expect(ops.conflict).toHaveLength(0);
    });

    it('should detect type change (not conflict) when type changes locally and timestamps match via metadata map', async () => {
      const filePath = path.join(tmpDir, 'home.json');
      await fs.writeFile(filePath, JSON.stringify({
        title: 'Home',
        type: 'home',
        body: '{}',
      }));

      const local = [makeLocal({
        slug: 'home',
        filePath,
        type: 'home',
        metadata: { id: 14, title: 'Home', type: 'home' },
      })];

      const remote = [makeRemote({
        id: 14,
        slug: 'home',
        type: 'component',
        title: 'Home',
        createdAt: '2025-07-29T19:18:59.897718Z',
        updatedAt: '2025-07-29T19:19:42.203593Z',
      })];

      const metadataMap = {
        content: {
          en: {
            home: {
              id: 14,
              createdAt: '2025-07-29T19:18:59.897718Z',
              updatedAt: '2025-07-29T19:19:42.203593Z',
            },
          },
        },
        emailTemplates: {},
        comments: {},
      };

      const ops = await (matchContent as any)(local, remote, undefined, false, metadataMap);

      expect(ops.typeChange).toHaveLength(1);
      expect(ops.typeChange[0].oldType).toBe('component');
      expect(ops.typeChange[0].newType).toBe('home');
      expect(ops.conflict).toHaveLength(0);
    });

    it('should detect combined slug + type change (not conflict) when timestamps match via metadata map', async () => {
      const filePath = path.join(tmpDir, 'home.json');
      await fs.writeFile(filePath, JSON.stringify({
        title: 'Home',
        type: 'home',
        body: '{}',
      }));

      const local = [makeLocal({
        slug: 'home',
        filePath,
        type: 'home',
        metadata: { id: 14, title: 'Home', type: 'home' },
      })];

      const remote = [makeRemote({
        id: 14,
        slug: 'components/home',
        type: 'component',
        title: 'Home',
        createdAt: '2025-07-29T19:18:59.897718Z',
        updatedAt: '2025-07-29T19:19:42.203593Z',
      })];

      // Metadata map stores under the old slug
      const metadataMap = {
        content: {
          en: {
            'components/home': {
              id: 14,
              createdAt: '2025-07-29T19:18:59.897718Z',
              updatedAt: '2025-07-29T19:19:42.203593Z',
            },
          },
        },
        emailTemplates: {},
        comments: {},
      };

      const ops = await (matchContent as any)(local, remote, undefined, false, metadataMap);

      expect(ops.typeChange).toHaveLength(1);
      expect(ops.typeChange[0].oldSlug).toBe('components/home');
      expect(ops.typeChange[0].oldType).toBe('component');
      expect(ops.typeChange[0].newType).toBe('home');
      expect(ops.conflict).toHaveLength(0);
    });

    it('should still detect conflict when remote timestamps are genuinely newer even via metadata map fallback', async () => {
      const filePath = path.join(tmpDir, 'footer.json');
      await fs.writeFile(filePath, JSON.stringify({
        title: 'Footer',
        type: 'component',
        body: '{}',
      }));

      const local = [makeLocal({
        slug: 'footer',
        filePath,
        type: 'component',
        metadata: { id: 13, title: 'Footer', type: 'component' },
      })];

      const remote = [makeRemote({
        id: 13,
        slug: 'components/footer',
        type: 'component',
        title: 'Footer',
        createdAt: '2025-07-29T19:13:54.179299Z',
        updatedAt: '2025-08-15T10:00:00.000000Z',  // genuinely newer
      })];

      // Metadata map has OLDER timestamps under old slug
      const metadataMap = {
        content: {
          en: {
            'components/footer': {
              id: 13,
              createdAt: '2025-07-29T19:13:54.179299Z',
              updatedAt: '2025-07-29T19:29:03.455362Z',  // older than remote
            },
          },
        },
        emailTemplates: {},
        comments: {},
      };

      const ops = await (matchContent as any)(local, remote, undefined, false, metadataMap);

      expect(ops.conflict).toHaveLength(1);
      expect(ops.conflict[0].reason).toContain('Slug changed remotely');
      expect(ops.rename).toHaveLength(0);
    });

    it('should detect rename for MDX file slug change with metadata map', async () => {
      const filePath = path.join(tmpDir, 'about.mdx');
      await fs.writeFile(filePath, matter.stringify('# About', {
        title: 'About Us',
        type: 'page',
      }));

      const local = [makeLocal({
        slug: 'about',
        filePath,
        type: 'page',
        metadata: { id: 1, title: 'About Us', type: 'page' },
      })];

      const remote = [makeRemote({
        id: 1,
        slug: 'pages/about',
        type: 'page',
        title: 'About Us',
        createdAt: '2025-06-17T08:27:57.696581Z',
        updatedAt: '2025-07-29T01:09:14.599350Z',
      })];

      const metadataMap = {
        content: {
          en: {
            'pages/about': {
              id: 1,
              createdAt: '2025-06-17T08:27:57.696581Z',
              updatedAt: '2025-07-29T01:09:14.599350Z',
            },
          },
        },
        emailTemplates: {},
        comments: {},
      };

      const ops = await (matchContent as any)(local, remote, undefined, false, metadataMap);

      expect(ops.rename).toHaveLength(1);
      expect(ops.rename[0].oldSlug).toBe('pages/about');
      expect(ops.rename[0].local.slug).toBe('about');
      expect(ops.conflict).toHaveLength(0);
    });
  });

  describe('matchContent - Title matching requires same content type', () => {
    it('should treat content as new when title matches but type differs', async () => {
      // User repurposed "about" (type about-us) into "home" (type home),
      // keeping the same title. After removing the id from frontmatter,
      // the title-based fallback should NOT match across different types.
      const filePath = path.join(tmpDir, 'home.mdx');
      await fs.writeFile(filePath, matter.stringify('# Home', {
        title: 'About Transpayrent',
        type: 'home',
      }));

      const local = [makeLocal({
        slug: 'home',
        filePath,
        type: 'home',
        metadata: { title: 'About Transpayrent', type: 'home' },
      })];

      const remote = [makeRemote({
        id: 1,
        slug: 'about',
        type: 'about-us',
        title: 'About Transpayrent',
        updatedAt: '2025-07-29T01:09:14.59935Z',
      })];

      const ops = await (matchContent as any)(local, remote);

      expect(ops.create).toHaveLength(1);
      expect(ops.create[0].local.slug).toBe('home');
      expect(ops.typeChange).toHaveLength(0);
      expect(ops.conflict).toHaveLength(0);
    });

    it('should still match by title when type is the same', async () => {
      const filePath = path.join(tmpDir, 'new-slug.mdx');
      await fs.writeFile(filePath, matter.stringify('Content', {
        title: 'My Page',
        type: 'page',
        updatedAt: '2024-06-15T00:00:00Z',
      }));

      const local = [makeLocal({
        slug: 'new-slug',
        filePath,
        type: 'page',
        metadata: { title: 'My Page', type: 'page', updatedAt: '2024-06-15T00:00:00Z' },
      })];

      const remote = [makeRemote({
        id: 10,
        slug: 'old-slug',
        type: 'page',
        title: 'My Page',
        updatedAt: '2024-01-01T00:00:00Z',
      })];

      const ops = await (matchContent as any)(local, remote);

      expect(ops.rename).toHaveLength(1);
      expect(ops.rename[0].oldSlug).toBe('old-slug');
      expect(ops.create).toHaveLength(0);
    });

    it('should treat content as new with metadata map when title matches but type differs', async () => {
      // Same scenario but with a metadata map — the old slug entry exists
      // in the map but does NOT correspond to this local file.
      const filePath = path.join(tmpDir, 'home.mdx');
      await fs.writeFile(filePath, matter.stringify('# Home', {
        title: 'About Transpayrent',
        type: 'home',
      }));

      const local = [makeLocal({
        slug: 'home',
        filePath,
        type: 'home',
        metadata: { title: 'About Transpayrent', type: 'home' },
      })];

      const remote = [makeRemote({
        id: 1,
        slug: 'about',
        type: 'about-us',
        title: 'About Transpayrent',
        createdAt: '2025-06-17T08:27:57.696581Z',
        updatedAt: '2025-07-29T01:09:14.59935Z',
      })];

      const metadataMap = {
        content: {
          en: {
            about: {
              id: 1,
              createdAt: '2025-06-17T08:27:57.696581Z',
              updatedAt: '2025-07-29T01:09:14.59935Z',
            },
          },
        },
        emailTemplates: {},
        comments: {},
      };

      const ops = await (matchContent as any)(local, remote, undefined, false, metadataMap);

      expect(ops.create).toHaveLength(1);
      expect(ops.create[0].local.slug).toBe('home');
      expect(ops.typeChange).toHaveLength(0);
      expect(ops.conflict).toHaveLength(0);
    });
  });

  describe('matchContent - Duplicate remote ID prevention', () => {
    it('should not allow two local items to match the same remote item by frontmatter ID', async () => {
      // header.json has id=14 (legitimate), home.mdx also has id=14 (stale).
      // Only the first one processed should claim the remote; the second becomes new.
      const headerPath = path.join(tmpDir, 'header.json');
      await fs.writeFile(headerPath, JSON.stringify({
        title: 'Header',
        type: 'component',
        body: '{}',
      }));

      const homePath = path.join(tmpDir, 'home.mdx');
      await fs.writeFile(homePath, matter.stringify('# Home', {
        title: 'Home',
        type: 'home',
        id: 14,
      }));

      const local = [
        makeLocal({
          slug: 'header',
          filePath: headerPath,
          type: 'component',
          metadata: { id: 14, title: 'Header', type: 'component' },
        }),
        makeLocal({
          slug: 'home',
          filePath: homePath,
          type: 'home',
          metadata: { id: 14, title: 'Home', type: 'home' },
        }),
      ];

      const remote = [makeRemote({
        id: 14,
        slug: 'components/header',
        type: 'component',
        title: 'Header',
        updatedAt: '2025-07-29T19:19:42.203593Z',
      })];

      const ops = await (matchContent as any)(local, remote);

      // header should match (rename from components/header → header)
      // home should become create (cannot claim the same remote item)
      const totalMatches = ops.rename.length + ops.update.length + ops.typeChange.length + ops.conflict.length;
      expect(totalMatches).toBe(1); // only header matched
      expect(ops.create).toHaveLength(1);
      expect(ops.create[0].local.slug).toBe('home');
    });

    it('should not allow two local items to match the same remote via metadata map and frontmatter', async () => {
      // metadata map maps components/header → id 14
      // home.mdx frontmatter has id=14 (stale)
      const headerPath = path.join(tmpDir, 'header.json');
      await fs.writeFile(headerPath, JSON.stringify({
        title: 'Header',
        type: 'component',
        body: '{}',
      }));

      const homePath = path.join(tmpDir, 'home.mdx');
      await fs.writeFile(homePath, matter.stringify('# Home', {
        title: 'Home',
        type: 'home',
        id: 14,
      }));

      const local = [
        makeLocal({
          slug: 'header',
          filePath: headerPath,
          type: 'component',
          metadata: { id: 14, title: 'Header', type: 'component' },
        }),
        makeLocal({
          slug: 'home',
          filePath: homePath,
          type: 'home',
          metadata: { id: 14, title: 'Home', type: 'home' },
        }),
      ];

      const remote = [makeRemote({
        id: 14,
        slug: 'components/header',
        type: 'component',
        title: 'Header',
        createdAt: '2025-07-29T19:18:59.897718Z',
        updatedAt: '2025-07-29T19:19:42.203593Z',
      })];

      const metadataMap = {
        content: {
          en: {
            'components/header': {
              id: 14,
              createdAt: '2025-07-29T19:18:59.897718Z',
              updatedAt: '2025-07-29T19:19:42.203593Z',
            },
          },
        },
        emailTemplates: {},
        comments: {},
      };

      const ops = await (matchContent as any)(local, remote, undefined, false, metadataMap);

      // header renamed from components/header → header (claimed via frontmatter id)
      // home becomes new (cannot claim same remote id=14)
      expect(ops.create).toHaveLength(1);
      expect(ops.create[0].local.slug).toBe('home');
      expect(ops.create[0].local.type).toBe('home');
    });
  });

  describe('matchContent - Deletion Detection with MetadataMap', () => {
    it('should detect deletions when local file is removed but metadata entry remains', async () => {
      // Scenario: remote has content ID 59 and 62, local files for those are deleted,
      // but the metadata map still has entries for them.
      // The deletion detection should NOT be fooled by stale metadata entries.
      const local = [makeLocal({
        slug: 'existing-article',
        locale: 'ru-RU',
        metadata: { type: 'article' },
      })];

      const remote = [
        makeRemote({ id: 50, slug: 'existing-article', language: 'ru-RU' }),
        makeRemote({ id: 59, slug: 'excel-export-sheets', language: 'ru-RU' }),
        makeRemote({ id: 62, slug: 'excel-recalculate', language: 'ru-RU' }),
      ];

      // Metadata map still has entries for the deleted content (stale)
      const metadataMap = {
        content: {
          'ru-RU': {
            'existing-article': { id: 50, updatedAt: '2025-01-01T00:00:00Z' },
            'excel-export-sheets': { id: 59, updatedAt: '2025-01-01T00:00:00Z' },
            'excel-recalculate': { id: 62, updatedAt: '2025-01-01T00:00:00Z' },
          },
        },
        emailTemplates: {},
        comments: {},
      };

      const ops = await (matchContent as any)(local, remote, undefined, true, metadataMap);

      // Should detect 2 deletions despite metadata entries existing
      expect(ops.delete).toHaveLength(2);
      const deletedSlugs = ops.delete.map((op: any) => op.remote?.slug).sort();
      expect(deletedSlugs).toEqual(['excel-export-sheets', 'excel-recalculate']);
    });

    it('should not detect deletions for content that still exists locally with metadata', async () => {
      const local = [
        makeLocal({ slug: 'article-a', locale: 'en', metadata: { type: 'article' } }),
        makeLocal({ slug: 'article-b', locale: 'en', metadata: { type: 'article' } }),
      ];

      const remote = [
        makeRemote({ id: 1, slug: 'article-a', language: 'en' }),
        makeRemote({ id: 2, slug: 'article-b', language: 'en' }),
      ];

      const metadataMap = {
        content: {
          en: {
            'article-a': { id: 1, updatedAt: '2025-01-01T00:00:00Z' },
            'article-b': { id: 2, updatedAt: '2025-01-01T00:00:00Z' },
          },
        },
        emailTemplates: {},
        comments: {},
      };

      const ops = await (matchContent as any)(local, remote, undefined, true, metadataMap);

      expect(ops.delete).toHaveLength(0);
    });

    it('should detect deletions across multiple locales with stale metadata', async () => {
      const local = [
        makeLocal({ slug: 'article-a', locale: 'en', metadata: { type: 'article' } }),
      ];

      const remote = [
        makeRemote({ id: 1, slug: 'article-a', language: 'en' }),
        makeRemote({ id: 2, slug: 'article-a', language: 'ru-RU' }),
        makeRemote({ id: 3, slug: 'article-b', language: 'en' }),
      ];

      // Metadata has entries for all three, but only article-a/en exists locally
      const metadataMap = {
        content: {
          en: {
            'article-a': { id: 1, updatedAt: '2025-01-01T00:00:00Z' },
            'article-b': { id: 3, updatedAt: '2025-01-01T00:00:00Z' },
          },
          'ru-RU': {
            'article-a': { id: 2, updatedAt: '2025-01-01T00:00:00Z' },
          },
        },
        emailTemplates: {},
        comments: {},
      };

      const ops = await (matchContent as any)(local, remote, undefined, true, metadataMap);

      expect(ops.delete).toHaveLength(2);
      const deletedIds = ops.delete.map((op: any) => op.remote?.id).sort();
      expect(deletedIds).toEqual([2, 3]);
    });
  });

  describe('countPushChanges - Delete Operations', () => {
    it('should include delete operations in count when includeDeletes is true', () => {
      const ops = {
        create: [],
        update: [],
        rename: [],
        typeChange: [],
        conflict: [],
        delete: [{ local: {}, remote: {} }, { local: {}, remote: {} }],
      };

      expect(countPushChanges(ops as any, false, true)).toBe(2);
    });

    it('should not include delete operations by default', () => {
      const ops = {
        create: [{ local: {} }],
        update: [],
        rename: [],
        typeChange: [],
        conflict: [],
        delete: [{ local: {}, remote: {} }],
      };

      expect(countPushChanges(ops as any, false)).toBe(1);
    });
  });
});
