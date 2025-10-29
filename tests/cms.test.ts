import * as path from 'path';
import {
  isContentDraft,
  getCMSContentBySlug,
  getCMSContentBySlugForLocale,
  getCMSContentBySlugForLocaleWithDraftSupport,
  getAllContentSlugs,
  getAllContentSlugsForLocale,
  getContentTranslations,
  getAllContentRoutes,
  extractUserUidFromSlug,
  getAvailableLanguages,
  loadContentConfig,
  getHeaderConfig,
  makeLocaleAwareLink,
  getLocaleFromPath,
  type CMSContent,
} from '../src/lib/cms';
import { TEST_USER_UID, TEST_USER_UID_2, mockDate } from './setup';

describe('LeadCMS SDK Core Functionality', () => {
  describe('isContentDraft', () => {
    it('should return true for content without publishedAt', () => {
      const content: CMSContent = {
        id: 1,
        slug: 'test',
        type: 'article',
        body: 'content',
      };
      expect(isContentDraft(content)).toBe(true);
    });

    it('should return true for content with future publishedAt', () => {
      const content: CMSContent = {
        id: 1,
        slug: 'test',
        type: 'article',
        body: 'content',
        publishedAt: new Date('2024-12-01T10:00:00Z'), // Future date
      };
      expect(isContentDraft(content)).toBe(true);
    });

    it('should return false for content with past publishedAt', () => {
      const content: CMSContent = {
        id: 1,
        slug: 'test',
        type: 'article',
        body: 'content',
        publishedAt: new Date('2024-10-28T10:00:00Z'), // Past date
      };
      expect(isContentDraft(content)).toBe(false);
    });

    it('should handle string dates correctly', () => {
      const content: CMSContent = {
        id: 1,
        slug: 'test',
        type: 'article',
        body: 'content',
        publishedAt: '2024-10-28T10:00:00Z', // Past date as string
      };
      expect(isContentDraft(content)).toBe(false);
    });
  });

  describe('getCMSContentBySlug', () => {
    it('should return published content by default', () => {
      const content = getCMSContentBySlug('published-article');
      expect(content).not.toBeNull();
      expect(content?.title).toBe('Published Article');
      expect(content?.publishedAt).toBeInstanceOf(Date);
    });

    it('should not return draft content by default', () => {
      const content = getCMSContentBySlug('draft-article');
      expect(content).toBeNull();
    });

    it('should not return future content by default', () => {
      const content = getCMSContentBySlug('future-article');
      expect(content).toBeNull();
    });

    it('should return draft content when includeDrafts is true', () => {
      const content = getCMSContentBySlug('draft-article', true);
      expect(content).not.toBeNull();
      expect(content?.title).toBe('Draft Article (No publishedAt)');
    });

    it('should return future content when includeDrafts is true', () => {
      const content = getCMSContentBySlug('future-article', true);
      expect(content).not.toBeNull();
      expect(content?.title).toBe('Future Article');
    });

    it('should handle JSON files correctly', () => {
      const content = getCMSContentBySlug('json-article');
      expect(content).not.toBeNull();
      expect(content?.title).toBe('JSON Article');
      expect(content?.publishedAt).toBeInstanceOf(Date);
    });

    it('should return null for non-existent content', () => {
      const content = getCMSContentBySlug('non-existent');
      expect(content).toBeNull();
    });
  });

  describe('getCMSContentBySlugForLocale', () => {
    it('should return content for default locale', () => {
      const content = getCMSContentBySlugForLocale('published-article', 'en');
      expect(content).not.toBeNull();
      expect(content?.title).toBe('Published Article');
      expect(content?.language).toBe('en');
    });

    it('should return content for specific locale', () => {
      const content = getCMSContentBySlugForLocale('published-article', 'es');
      expect(content).not.toBeNull();
      expect(content?.title).toBe('Artículo Publicado');
      expect(content?.language).toBe('es');
    });

    it('should respect draft filtering by locale', () => {
      const content = getCMSContentBySlugForLocale('draft-article', 'en');
      expect(content).toBeNull();

      const contentWithDrafts = getCMSContentBySlugForLocale('draft-article', 'en', true);
      expect(contentWithDrafts).not.toBeNull();
    });
  });

  describe('getCMSContentBySlugForLocaleWithDraftSupport', () => {
    it('should return base content when no user draft exists', () => {
      const content = getCMSContentBySlugForLocaleWithDraftSupport('published-article', 'en');
      expect(content).not.toBeNull();
      expect(content?.title).toBe('Published Article');
    });

    it('should return user draft when it exists, regardless of publishedAt', () => {
      const content = getCMSContentBySlugForLocaleWithDraftSupport(
        'published-article',
        'en',
        TEST_USER_UID
      );
      expect(content).not.toBeNull();
      expect(content?.title).toBe('Published Article - User Draft');
      // This draft has a future publishedAt but should still be returned
      expect(content?.publishedAt).toBeInstanceOf(Date);
    });

    it('should return user-only draft content', () => {
      const content = getCMSContentBySlugForLocaleWithDraftSupport(
        'user-only-draft',
        'en',
        TEST_USER_UID
      );
      expect(content).not.toBeNull();
      expect(content?.title).toBe('User Only Draft');
    });

    it('should return null for user-only draft when wrong userUid', () => {
      const content = getCMSContentBySlugForLocaleWithDraftSupport(
        'user-only-draft',
        'en',
        TEST_USER_UID_2
      );
      expect(content).toBeNull();
    });

    it('should respect includeDrafts for base content when no user draft', () => {
      // Future article should be null by default
      const content1 = getCMSContentBySlugForLocaleWithDraftSupport(
        'future-article',
        'en',
        TEST_USER_UID_2 // Different user, no draft exists
      );
      expect(content1).toBeNull();

      // But should be returned when includeDrafts is true
      const content2 = getCMSContentBySlugForLocaleWithDraftSupport(
        'future-article',
        'en',
        TEST_USER_UID_2,
        true
      );
      expect(content2).not.toBeNull();
    });
  });

  describe('getAllContentSlugs', () => {
    it('should return only published content slugs by default', () => {
      const slugs = getAllContentSlugs();
      expect(slugs).toContain('published-article');
      expect(slugs).toContain('json-article');
      expect(slugs).toContain('about');
      expect(slugs).toContain('blog/post-1');
      expect(slugs).not.toContain('draft-article');
      expect(slugs).not.toContain('future-article');
      expect(slugs).not.toContain('blog/post-2-draft');
    });

    it('should include drafts when includeDrafts is true', () => {
      const slugs = getAllContentSlugs(undefined, true);
      expect(slugs).toContain('published-article');
      expect(slugs).toContain('draft-article');
      expect(slugs).toContain('future-article');
      expect(slugs).toContain('blog/post-2-draft');
    });

    it('should filter by content types', () => {
      const articleSlugs = getAllContentSlugs(['article']);
      expect(articleSlugs).toContain('published-article');
      expect(articleSlugs).toContain('json-article');
      expect(articleSlugs).not.toContain('about'); // page type
      expect(articleSlugs).not.toContain('blog/post-1'); // blog type

      const blogSlugs = getAllContentSlugs(['blog']);
      expect(blogSlugs).toContain('blog/post-1');
      expect(blogSlugs).not.toContain('published-article');
    });

    it('should not include user-specific drafts in general listing', () => {
      const slugs = getAllContentSlugs(undefined, true);
      expect(slugs).not.toContain(`published-article-${TEST_USER_UID}`);
      expect(slugs).not.toContain(`user-only-draft-${TEST_USER_UID}`);
    });
  });

  describe('getAllContentSlugsForLocale', () => {
    it('should return content for default locale', () => {
      const slugs = getAllContentSlugsForLocale('en');
      expect(slugs).toContain('published-article');
      expect(slugs).toContain('blog/post-1');
    });

    it('should return content for specific locale', () => {
      const slugs = getAllContentSlugsForLocale('es');
      expect(slugs).toContain('published-article');
      expect(slugs).toContain('blog/post-1');
    });

    it('should handle user-specific drafts correctly', () => {
      // Without includeDrafts, should return base content only
      const slugs1 = getAllContentSlugsForLocale('en', undefined, false, TEST_USER_UID);
      expect(slugs1).toContain('published-article');
      expect(slugs1).not.toContain('draft-article');

      // With includeDrafts and userUid, should return user's drafts
      const slugs2 = getAllContentSlugsForLocale('en', undefined, true, TEST_USER_UID);
      expect(slugs2).toContain('published-article'); // Base slug returned, but content would be user's version
      expect(slugs2).toContain('user-only-draft'); // User-only draft
    });
  });

  describe('getContentTranslations', () => {
    it('should return translations for published content', () => {
      const { getAvailableLanguages } = require('../src/lib/cms');
      const languages = getAvailableLanguages();
      const translations = getContentTranslations('article-1');



      expect(translations).toHaveLength(2);

      // Find translations by title instead of locale for debugging
      const enTranslation = translations.find(t => t.content.title === 'Published Article');
      const esTranslation = translations.find(t => t.content.title === 'Artículo Publicado');

      expect(enTranslation).toBeDefined();
      expect(esTranslation).toBeDefined();

      // Verify locales match titles
      expect(enTranslation?.locale).toBe('en');
      expect(esTranslation?.locale).toBe('es');
    });

    it('should not return draft translations by default', () => {
      const translations = getContentTranslations('article-2'); // draft-article
      expect(translations).toHaveLength(0);
    });

    it('should return draft translations when includeDrafts is true', () => {
      const translations = getContentTranslations('article-2', true);
      expect(translations).toHaveLength(1);
      expect(translations[0].content.title).toBe('Draft Article (No publishedAt)');
    });
  });

  describe('getAllContentRoutes', () => {
    it('should return routes for all locales', () => {
      const routes = getAllContentRoutes();

      // Check for English routes (default locale)
      const enRoutes = routes.filter(r => r.locale === 'en');
      expect(enRoutes.some(r => r.path === '/published-article')).toBe(true);
      expect(enRoutes.some(r => r.path === '/blog/post-1')).toBe(true);

      // Check for Spanish routes
      const esRoutes = routes.filter(r => r.locale === 'es');
      expect(esRoutes.some(r => r.path === '/es/published-article')).toBe(true);
      expect(esRoutes.some(r => r.path === '/es/blog/post-1')).toBe(true);
    });

    it('should filter by content types', () => {
      const routes = getAllContentRoutes(['blog']);
      expect(routes.every(r => r.slug.startsWith('blog/'))).toBe(true);
    });

    it('should handle draft filtering', () => {
      const routesWithoutDrafts = getAllContentRoutes();
      const routesWithDrafts = getAllContentRoutes(undefined, true);

      expect(routesWithDrafts.length).toBeGreaterThan(routesWithoutDrafts.length);
    });
  });

  describe('extractUserUidFromSlug', () => {
    it('should extract GUID from user-specific slug', () => {
      const uid = extractUserUidFromSlug(`published-article-${TEST_USER_UID}`);
      expect(uid).toBe(TEST_USER_UID);
    });

    it('should return null for regular slug', () => {
      const uid = extractUserUidFromSlug('published-article');
      expect(uid).toBeNull();
    });

    it('should return null for invalid GUID pattern', () => {
      const uid = extractUserUidFromSlug('published-article-invalid-guid');
      expect(uid).toBeNull();
    });

    it('should handle different GUID formats', () => {
      const uid1 = extractUserUidFromSlug(`article-${TEST_USER_UID}`);
      const uid2 = extractUserUidFromSlug(`article-${TEST_USER_UID_2}`);

      expect(uid1).toBe(TEST_USER_UID);
      expect(uid2).toBe(TEST_USER_UID_2);
    });
  });

  describe('getAvailableLanguages', () => {
    it('should return all available languages', () => {
      const languages = getAvailableLanguages();
      expect(languages).toContain('en');
      expect(languages).toContain('es');
      expect(languages).toHaveLength(2);
    });
  });

  describe('Configuration loading', () => {
    it('should load header config for default locale', () => {
      const config = getHeaderConfig();
      expect(config).not.toBeNull();
      expect(config?.navigation).toHaveLength(3);
      expect(config?.navigation[0].label).toBe('Home');
    });

    it('should load header config for specific locale', () => {
      const config = getHeaderConfig('es');
      expect(config).not.toBeNull();
      expect(config?.navigation[0].label).toBe('Inicio');
    });

    it('should load user-specific draft config', () => {
      const config = getHeaderConfig('en', TEST_USER_UID);
      expect(config).not.toBeNull();
      expect(config?.navigation).toHaveLength(4); // Draft has extra item
      expect(config?.navigation[0].label).toBe('Home (Draft)');
    });

    it('should use loadContentConfig for generic configs', () => {
      const config = loadContentConfig<any>('header');
      expect(config).not.toBeNull();
    });
  });

  describe('Locale utilities', () => {
    it('should extract locale from path', () => {
      expect(getLocaleFromPath('/en/about')).toBe('en');
      expect(getLocaleFromPath('/es/blog/post-1')).toBe('es');
      expect(getLocaleFromPath('/about')).toBe('en'); // default
      expect(getLocaleFromPath('/unknown/about')).toBe('en'); // default for unknown
    });

    it('should make links locale-aware', () => {
      expect(makeLocaleAwareLink('/about', 'en')).toBe('/about'); // default locale
      expect(makeLocaleAwareLink('/about', 'es')).toBe('/es/about');
      expect(makeLocaleAwareLink('about', 'es')).toBe('/es/about');
      expect(makeLocaleAwareLink('https://example.com', 'es')).toBe('https://example.com'); // external
      expect(makeLocaleAwareLink('#section', 'es')).toBe('#section'); // anchor
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle non-existent locales gracefully', () => {
      const content = getCMSContentBySlugForLocale('published-article', 'fr');
      expect(content).toBeNull();
    });

    it('should handle corrupted date strings', () => {
      // Mock a file with invalid date
      const content: CMSContent = {
        id: 1,
        slug: 'test',
        type: 'article',
        body: 'content',
        publishedAt: 'invalid-date',
      };

      // Should not throw, but treat as draft due to invalid date
      expect(() => isContentDraft(content)).not.toThrow();

      // Check if the date is actually invalid
      const invalidDate = new Date('invalid-date');
      expect(isNaN(invalidDate.getTime())).toBe(true);

      // Invalid date should be treated as future (draft)
      expect(isContentDraft(content)).toBe(true);
    });

    it('should handle empty content directories', () => {
      // This should return empty array for nonexistent locale
      const slugs = getAllContentSlugsForLocale('fr'); // French doesn't exist in our fixtures
      expect(Array.isArray(slugs)).toBe(true);
      expect(slugs.length).toBe(0);
    });
  });

  describe('Time-sensitive tests', () => {
    it('should handle edge case around current time', () => {
      // Mock current time to be very close to publishedAt
      mockDate('2024-10-28T10:00:01Z'); // 1 second after published article

      const content = getCMSContentBySlug('published-article');
      expect(content).not.toBeNull(); // Should still be published

      // Mock to be 1 second before
      mockDate('2024-10-28T09:59:59Z');
      const contentBefore = getCMSContentBySlug('published-article');
      expect(contentBefore).toBeNull(); // Should be draft (future)
    });

    it('should handle timezone differences correctly', () => {
      const content: CMSContent = {
        id: 1,
        slug: 'test',
        type: 'article',
        body: 'content',
        publishedAt: '2024-10-29T12:00:00+02:00', // Same time as mock but with timezone
      };

      expect(isContentDraft(content)).toBe(false); // Should be published
    });
  });

  describe('Content Transformation and Comparison', () => {
    // Import necessary dependencies for transformation tests
    const fs = require('fs/promises');
    const path = require('path');
    const os = require('os');

    const tempDir = path.join(os.tmpdir(), 'leadcms-transform-test-' + Date.now());

    beforeEach(async () => {
      await fs.mkdir(tempDir, { recursive: true });
    });

    afterEach(async () => {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (error) {
        // Ignore cleanup errors
      }
    });

    // Import shared transformation logic
    const { transformRemoteToLocalFormat, transformRemoteForComparison } = require('../src/lib/content-transformation');

    it('should preserve createdAt and publishedAt in content transformation', async () => {
      // Create a local file that matches real-world structure
      const localFilePath = path.join(tempDir, 'test-content.mdx');
      const localContent = `---
id: 51
createdAt: '2025-09-10T09:32:54.223364Z'
title: Test Content
description: A test article
slug: test-content
type: doc
author: Test Author
language: en
publishedAt: '2025-09-09T18:30:00Z'
---

# Test Content

This is test content.`;

      await fs.writeFile(localFilePath, localContent);

      // Remote content with the same timestamp fields
      const remoteContent = {
        id: 51,
        createdAt: '2025-09-10T09:32:54.223364Z',
        title: 'Test Content',
        description: 'A test article',
        slug: 'test-content',
        type: 'doc',
        author: 'Test Author',
        language: 'en',
        publishedAt: '2025-09-09T18:30:00Z',
        isLocal: false,
        body: `# Test Content

This is test content.`
      };

      const typeMap = { doc: 'MDX' as const };

      // Transform remote content
      const transformedRemote = await transformRemoteToLocalFormat(remoteContent, typeMap);
      const localFileContent = await fs.readFile(localFilePath, 'utf-8');

      // Should be identical after transformation
      expect(localFileContent.trim()).toBe(transformedRemote.trim());

      // Verify that timestamp fields are preserved
      expect(transformedRemote).toContain('createdAt');
      expect(transformedRemote).toContain('publishedAt');
      expect(transformedRemote).toContain('2025-09-10T09:32:54.223364Z');
      expect(transformedRemote).toContain('2025-09-09T18:30:00Z');
    });

    it('should detect legitimate updatedAt differences as changes', async () => {
      // Local file without updatedAt
      const localFilePath = path.join(tempDir, 'updated-content.mdx');
      const localContent = `---
id: 51
createdAt: '2025-09-10T09:32:54.223364Z'
title: Test Content
publishedAt: '2025-09-09T18:30:00Z'
---

# Test Content`;

      await fs.writeFile(localFilePath, localContent);

      // Remote content with updatedAt (indicating changes)
      const remoteContent = {
        id: 51,
        createdAt: '2025-09-10T09:32:54.223364Z',
        updatedAt: '2025-10-29T10:00:00.000Z',
        title: 'Test Content',
        publishedAt: '2025-09-09T18:30:00Z',
        isLocal: false,
        body: '# Test Content'
      };

      const typeMap = { doc: 'MDX' as const };
      const transformedRemote = await transformRemoteToLocalFormat(remoteContent, typeMap);
      const localFileContent = await fs.readFile(localFilePath, 'utf-8');

      // Should detect difference due to updatedAt
      const hasChanges = localFileContent.trim() !== transformedRemote.trim();
      expect(hasChanges).toBe(true);
      expect(transformedRemote).toContain('updatedAt');
      expect(localFileContent).not.toContain('updatedAt');
    });

    it('should exclude only truly internal fields from transformation', async () => {
      const remoteContent = {
        id: 51,
        title: 'Test',
        createdAt: '2025-09-10T09:32:54.223364Z',
        updatedAt: '2025-10-01T10:00:00.000Z',
        publishedAt: '2025-09-09T18:30:00Z',
        isLocal: false, // Should be excluded (truly internal)
        body: '# Test Content', // Should be excluded (content, not metadata)
        customField: 'user value', // Should be included
        type: 'doc'
      };

      const typeMap = { doc: 'MDX' as const };
      const result = await transformRemoteToLocalFormat(remoteContent, typeMap);

      // Should include user content fields and timestamps
      expect(result).toContain('createdAt');
      expect(result).toContain('updatedAt');
      expect(result).toContain('publishedAt');
      expect(result).toContain('customField');
      expect(result).toContain('title');

      // Should exclude truly internal fields
      expect(result).not.toContain('isLocal: false');
      // Body content should be in the content section, not frontmatter
      expect(result).toContain('# Test Content');
    });

    it('should handle content comparison edge cases', async () => {
      // Test with identical content except for whitespace normalization
      const localFilePath = path.join(tempDir, 'whitespace-test.mdx');
      const localContent = `---
id: 51
title: Test
---

# Test Content

Some content here.`;

      await fs.writeFile(localFilePath, localContent);

      const remoteContent = {
        id: 51,
        title: 'Test',
        isLocal: false,
        body: `# Test Content\n\nSome content here.` // Different whitespace
      };

      const transformedRemote = await transformRemoteToLocalFormat(remoteContent, { doc: 'MDX' as const });
      const localFileContent = await fs.readFile(localFilePath, 'utf-8');

      // Should normalize whitespace differences
      const normalizeContent = (content: string): string => {
        return content
          .trim()
          .replace(/\r\n/g, '\n')
          .replace(/\s+\n/g, '\n')
          .replace(/\n\n+/g, '\n\n');
      };

      const normalizedLocal = normalizeContent(localFileContent);
      const normalizedRemote = normalizeContent(transformedRemote);

      expect(normalizedLocal).toBe(normalizedRemote);
    });

    it('should reproduce the false positive changes issue from real-world scenario', async () => {
      // Create a real-world local file with timestamps (like the user's actual files)
      const localFilePath = path.join(tempDir, 'real-world-content.mdx');
      const localContent = `---
id: 25
createdAt: '2025-09-10T09:32:54.223364Z'
title: Contact Us
description: Get in touch with our team
slug: contact-us
type: contact
author: Test Author
language: da
publishedAt: '2025-09-09T18:30:00Z'
---

# Contact Us

Get in touch with our team for any questions or support.`;

      await fs.writeFile(localFilePath, localContent);

      // Remote content with exactly the same data (should result in no changes)
      const remoteContent = {
        id: 25,
        createdAt: '2025-09-10T09:32:54.223364Z',
        updatedAt: '2025-10-15T14:22:33.123456Z', // This field might not be in local
        title: 'Contact Us',
        description: 'Get in touch with our team',
        slug: 'contact-us',
        type: 'contact',
        author: 'Test Author',
        language: 'da',
        publishedAt: '2025-09-09T18:30:00Z',
        isLocal: false,
        body: `# Contact Us

Get in touch with our team for any questions or support.`
      };

      const typeMap = { contact: 'MDX' as const };

      // OLD METHOD (causing false positives): Transform without considering local fields
      const transformedRemoteOld = await transformRemoteToLocalFormat(remoteContent, typeMap);
      const localFileContent = await fs.readFile(localFilePath, 'utf-8');

      const hasChangesOld = localFileContent.trim() !== transformedRemoteOld.trim();

      // NEW METHOD (fixed): Transform only including fields present in local file
      const transformedRemoteNew = await transformRemoteForComparison(remoteContent, localFileContent, typeMap);

      const hasChangesNew = localFileContent.trim() !== transformedRemoteNew.trim();

      // Verify the old method shows false positive and new method fixes it
      expect(hasChangesOld).toBe(true); // Old method shows false positive
      expect(hasChangesNew).toBe(false); // New method correctly shows no changes

      expect(transformedRemoteOld).toContain('updatedAt'); // Old method includes updatedAt
      expect(transformedRemoteNew).not.toContain('updatedAt'); // New method excludes it (since not in local)
      expect(localFileContent).not.toContain('updatedAt'); // Local doesn't have updatedAt
    });

    it('should not include null values in transformed frontmatter', async () => {
      // Import the transformation function
      const { transformRemoteToLocalFormat } = await import('../src/lib/content-transformation.js');

      // Create remote content with null values that should be excluded
      const remoteContent = {
        id: 56,
        slug: 'blog',
        type: 'blog-index',
        title: 'Test Blog',
        description: 'Test description',
        coverImageUrl: '',
        coverImageAlt: '',
        author: 'Test Author',
        language: 'en',
        category: 'Blog',
        tags: [],
        allowComments: false,
        publishedAt: '2025-10-23T18:30:00Z',
        createdAt: '2025-10-24T12:38:00.088466Z',
        updatedAt: '2025-10-24T12:38:25.125472Z',
        // These are null values that should NOT appear in the output
        comments: null,
        translations: null,
        translationKey: null,
        source: null,
        body: 'Test content'
      };

      const typeMap = { 'blog-index': 'MDX' as const };
      const transformed = await transformRemoteToLocalFormat(remoteContent, typeMap);

      // Verify that null values are NOT included in the output
      expect(transformed).not.toContain('comments: null');
      expect(transformed).not.toContain('translations: null');
      expect(transformed).not.toContain('translationKey: null');
      expect(transformed).not.toContain('source: null');

      // Verify that non-null values ARE included
      expect(transformed).toContain('title: Test Blog');
      expect(transformed).toContain('author: Test Author');
      expect(transformed).toContain('allowComments: false'); // false is not null
      expect(transformed).toContain('tags: []'); // empty array is not null
      expect(transformed).toContain("coverImageUrl: ''"); // empty string is not null
    });

    it('should transform API media URLs to local media URLs in frontmatter and body content', async () => {
      // Import the transformation function
      const { transformRemoteToLocalFormat } = await import('../src/lib/content-transformation.js');

      // Create remote content with API media URLs that should be transformed
      const remoteContent = {
        id: 58,
        slug: 'blog/building-sites-with-leadcms-sdk',
        type: 'blog-article',
        title: 'Building a Modern Site with LeadCMS SDK – A Developer\'s Guide',
        description: 'Master the LeadCMS SDK to build blazing-fast static sites with Next.js.',
        coverImageUrl: '/api/media/blog/building-sites-with-leadcms-sdk/leadcms-sdk.avif',
        coverImageAlt: 'Building a Modern Site with LeadCMS SDK – A Developer\'s Guide',
        author: 'LeadCMS Team',
        language: 'en',
        category: 'Development',
        tags: ['LeadCMS SDK', 'Next.js CMS'],
        allowComments: true,
        featured: false,
        createdAt: '2025-10-24T17:03:44.678452Z',
        updatedAt: '2025-10-29T11:09:20.158347Z',
        body: `# Building Modern Sites

Article content with various media references:

## Standard Markdown Images
![Test Image](/api/media/images/test.jpg)
![Hero Banner](/api/media/blog/hero-banner.webp "Hero Banner Alt Text")
![Diagram](/api/media/diagrams/architecture.svg)

## Links to Media Files
Download the [PDF Guide](/api/media/docs/guide.pdf) or check out [video tutorial](/api/media/videos/tutorial.mp4).

## Custom Components with Image Props
<ImageGallery
  images={[
    "/api/media/gallery/image1.jpg",
    "/api/media/gallery/image2.png"
  ]}
/>

<HeroSection
  backgroundImage="/api/media/backgrounds/hero.jpg"
  image="/api/media/icons/logo.svg"
  thumbnail="/api/media/thumbnails/preview.webp"
/>

<BlogCard
  coverImage="/api/media/blog/covers/article1.jpg"
  authorAvatar="/api/media/avatars/author.png"
/>

## Mixed Content
Check this ![inline image](/api/media/inline/icon.svg) in text, and visit [our resources](/api/media/resources/package.zip).

<CustomComponent
  src="/api/media/components/example.jpg"
  poster="/api/media/videos/poster.jpg"
  data-background="/api/media/patterns/bg.png"
/>`
      };

      const typeMap = { 'blog-article': 'MDX' as const };
      const transformed = await transformRemoteToLocalFormat(remoteContent, typeMap);

      // Verify that /api/media/ URLs are converted to /media/ URLs in frontmatter
      expect(transformed).toContain('coverImageUrl: /media/blog/building-sites-with-leadcms-sdk/leadcms-sdk.avif');
      expect(transformed).not.toContain('coverImageUrl: /api/media/');

      // Verify that /api/media/ URLs are converted in the body content

      // Standard Markdown images
      expect(transformed).toContain('![Test Image](/media/images/test.jpg)');
      expect(transformed).toContain('![Hero Banner](/media/blog/hero-banner.webp "Hero Banner Alt Text")');
      expect(transformed).toContain('![Diagram](/media/diagrams/architecture.svg)');

      // Links to media files
      expect(transformed).toContain('[PDF Guide](/media/docs/guide.pdf)');
      expect(transformed).toContain('[video tutorial](/media/videos/tutorial.mp4)');

      // Custom components with image props
      expect(transformed).toContain('"/media/gallery/image1.jpg"');
      expect(transformed).toContain('"/media/gallery/image2.png"');
      expect(transformed).toContain('backgroundImage="/media/backgrounds/hero.jpg"');
      expect(transformed).toContain('image="/media/icons/logo.svg"');
      expect(transformed).toContain('thumbnail="/media/thumbnails/preview.webp"');
      expect(transformed).toContain('coverImage="/media/blog/covers/article1.jpg"');
      expect(transformed).toContain('authorAvatar="/media/avatars/author.png"');

      // Mixed content and custom attributes
      expect(transformed).toContain('![inline image](/media/inline/icon.svg)');
      expect(transformed).toContain('[our resources](/media/resources/package.zip)');
      expect(transformed).toContain('src="/media/components/example.jpg"');
      expect(transformed).toContain('poster="/media/videos/poster.jpg"');
      expect(transformed).toContain('data-background="/media/patterns/bg.png"');

      // Verify NO /api/media/ URLs remain anywhere
      expect(transformed).not.toContain('/api/media/');
    });
  });
});
