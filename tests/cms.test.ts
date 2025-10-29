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
});
