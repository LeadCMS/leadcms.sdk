import {
  getAllContentSlugsForLocale,
  getCMSContentBySlugForLocaleWithDraftSupport,
  getAllContentRoutes,
} from '../src/lib/cms';
import { TEST_USER_UID, TEST_USER_UID_2 } from './setup';

describe('LeadCMS SDK - Advanced Draft Scenarios', () => {
  describe('User-specific draft behavior', () => {
    it('should prioritize user drafts over base content', () => {
      // Get base content
      const baseContent = getCMSContentBySlugForLocaleWithDraftSupport(
        'published-article',
        'en'
      );
      expect(baseContent?.title).toBe('Published Article');

      // Get user's draft version
      const userContent = getCMSContentBySlugForLocaleWithDraftSupport(
        'published-article',
        'en',
        TEST_USER_UID
      );
      expect(userContent?.title).toBe('Published Article - User Draft');

      // Verify they are different
      expect(baseContent?.title).not.toBe(userContent?.title);
    });

    it('should return user drafts even with future publishedAt', () => {
      const userContent = getCMSContentBySlugForLocaleWithDraftSupport(
        'published-article',
        'en',
        TEST_USER_UID
      );

      expect(userContent).not.toBeNull();
      expect(userContent?.title).toBe('Published Article - User Draft');
      // This draft has publishedAt: "2024-12-15T10:00:00Z" (future)
      // but should still be returned because it's user-specific
    });

    it('should handle user-only drafts correctly', () => {
      // This content only exists as a user draft, no base version
      const userContent = getCMSContentBySlugForLocaleWithDraftSupport(
        'user-only-draft',
        'en',
        TEST_USER_UID
      );
      expect(userContent).not.toBeNull();
      expect(userContent?.title).toBe('User Only Draft');

      // Different user should not see it
      const otherUserContent = getCMSContentBySlugForLocaleWithDraftSupport(
        'user-only-draft',
        'en',
        TEST_USER_UID_2
      );
      expect(otherUserContent).toBeNull();
    });

    it('should handle slug extraction with various GUID formats', () => {
      const testCases = [
        `article-${TEST_USER_UID}`,
        `deep/nested/article-${TEST_USER_UID}`,
        `article-with-dashes-${TEST_USER_UID}`,
        `${TEST_USER_UID_2}`, // Just GUID
        `prefix-${TEST_USER_UID_2}-suffix`, // GUID in middle should not match
      ];

      // Test GUID extraction
      const { extractUserUidFromSlug } = require('../src/lib/cms');

      expect(extractUserUidFromSlug(testCases[0])).toBe(TEST_USER_UID);
      expect(extractUserUidFromSlug(testCases[1])).toBe(TEST_USER_UID);
      expect(extractUserUidFromSlug(testCases[2])).toBe(TEST_USER_UID);
      expect(extractUserUidFromSlug(testCases[3])).toBeNull(); // No preceding dash
      expect(extractUserUidFromSlug(testCases[4])).toBeNull(); // GUID not at end
    });
  });

  describe('Complex filtering scenarios', () => {
    it('should correctly filter drafts in getAllContentSlugsForLocale', () => {
      // Without drafts - should only get published content
      const publishedSlugs = getAllContentSlugsForLocale('en', undefined, false);
      expect(publishedSlugs).toContain('published-article');
      expect(publishedSlugs).toContain('json-article');
      expect(publishedSlugs).not.toContain('draft-article');
      expect(publishedSlugs).not.toContain('future-article');

      // With drafts - should get all content
      const allSlugs = getAllContentSlugsForLocale('en', undefined, true);
      expect(allSlugs).toContain('published-article');
      expect(allSlugs).toContain('draft-article');
      expect(allSlugs).toContain('future-article');
    });

    it('should handle user-specific drafts in slug listing', () => {
      // With user UID but includeDrafts false - should get published + user's published drafts
      const userSlugs = getAllContentSlugsForLocale('en', undefined, false, TEST_USER_UID);
      expect(userSlugs).toContain('published-article'); // Base is published
      expect(userSlugs).not.toContain('draft-article'); // Base is draft
      expect(userSlugs).not.toContain('user-only-draft'); // User draft but no base

      // With user UID and includeDrafts true - should get user's version when available
      const userDraftSlugs = getAllContentSlugsForLocale('en', undefined, true, TEST_USER_UID);
      expect(userDraftSlugs).toContain('published-article'); // Will be user's version
      expect(userDraftSlugs).toContain('user-only-draft'); // User-only draft
    });

    it('should respect content type filtering with drafts', () => {
      // Articles only, without drafts
      const publishedArticles = getAllContentSlugsForLocale('en', ['article'], false);
      expect(publishedArticles).toContain('published-article');
      expect(publishedArticles).toContain('json-article');
      expect(publishedArticles).not.toContain('draft-article');
      expect(publishedArticles).not.toContain('about'); // page type

      // Articles only, with drafts
      const allArticles = getAllContentSlugsForLocale('en', ['article'], true);
      expect(allArticles).toContain('published-article');
      expect(allArticles).toContain('json-article');
      expect(allArticles).toContain('draft-article');
      expect(allArticles).toContain('future-article');
      expect(allArticles).not.toContain('about'); // page type
    });
  });

  describe('Route generation with drafts', () => {
    it('should generate correct routes for published content', () => {
      const routes = getAllContentRoutes();

      // Check English routes (default locale)
      const enRoutes = routes.filter(r => r.locale === 'en' && r.isDefaultLocale);
      const publishedArticleRoute = enRoutes.find(r => r.slug === 'published-article');
      expect(publishedArticleRoute).toBeTruthy();
      expect(publishedArticleRoute?.path).toBe('/published-article');
      expect(publishedArticleRoute?.slugParts).toEqual(['published-article']);

      // Check Spanish routes (non-default locale)
      const esRoutes = routes.filter(r => r.locale === 'es' && !r.isDefaultLocale);
      const esArticleRoute = esRoutes.find(r => r.slug === 'published-article');
      expect(esArticleRoute).toBeTruthy();
      expect(esArticleRoute?.path).toBe('/es/published-article');
    });

    it('should include draft routes when requested', () => {
      const routesWithoutDrafts = getAllContentRoutes();
      const routesWithDrafts = getAllContentRoutes(undefined, true);

      expect(routesWithDrafts.length).toBeGreaterThan(routesWithoutDrafts.length);

      // Check that draft routes are included
      const draftRoute = routesWithDrafts.find(r => r.slug === 'draft-article');
      const futureRoute = routesWithDrafts.find(r => r.slug === 'future-article');

      expect(draftRoute).toBeTruthy();
      expect(futureRoute).toBeTruthy();

      // Check that they're not in the non-draft routes
      const draftRouteInPublished = routesWithoutDrafts.find(r => r.slug === 'draft-article');
      expect(draftRouteInPublished).toBeFalsy();
    });

    it('should handle nested paths correctly', () => {
      const routes = getAllContentRoutes(['blog']);

      const blogRoute = routes.find(r => r.slug === 'blog/post-1' && r.locale === 'en');
      expect(blogRoute).toBeTruthy();
      expect(blogRoute?.path).toBe('/blog/post-1');
      expect(blogRoute?.slugParts).toEqual(['blog', 'post-1']);

      const esBlogRoute = routes.find(r => r.slug === 'blog/post-1' && r.locale === 'es');
      expect(esBlogRoute).toBeTruthy();
      expect(esBlogRoute?.path).toBe('/es/blog/post-1');
    });

    it('should handle user-specific draft routes', () => {
      const userRoutes = getAllContentRoutes(undefined, true, TEST_USER_UID);

      // Should include user-only drafts
      const userOnlyRoute = userRoutes.find(r => r.slug === 'user-only-draft');
      expect(userOnlyRoute).toBeTruthy();

      // Should prefer user's version of existing content
      // Note: The actual slug returned will be the base slug, but the content would be user's version
      const articleRoute = userRoutes.find(r => r.slug === 'published-article');
      expect(articleRoute).toBeTruthy();
    });
  });

  describe('GUID validation edge cases', () => {
    const { extractUserUidFromSlug } = require('../src/lib/cms');

    it('should handle case-insensitive GUIDs', () => {
      const lowerGuid = '550e8400-e29b-41d4-a716-446655440000';
      const upperGuid = '550E8400-E29B-41D4-A716-446655440000';
      const mixedGuid = '550e8400-E29B-41d4-A716-446655440000';

      expect(extractUserUidFromSlug(`article-${lowerGuid}`)).toBe(lowerGuid);
      expect(extractUserUidFromSlug(`article-${upperGuid}`)).toBe(upperGuid);
      expect(extractUserUidFromSlug(`article-${mixedGuid}`)).toBe(mixedGuid);
    });

    it('should reject invalid GUID formats', () => {
      const invalidGuids = [
        'article-550e8400-e29b-41d4-a716', // Too short
        'article-550e8400-e29b-41d4-a716-446655440000-extra', // Too long
        'article-550e8400-e29b-41d4-a716-44665544000g', // Invalid character
        'article-550e8400e29b41d4a716446655440000', // No dashes
        'article-550e8400-e29b-41d4-a716-4466554400', // Wrong segment length
      ];

      invalidGuids.forEach(invalidSlug => {
        expect(extractUserUidFromSlug(invalidSlug)).toBeNull();
      });
    });
  });

  describe('Performance and caching', () => {
    it('should handle multiple calls efficiently', () => {
      // Test that multiple calls don't cause issues
      const startTime = Date.now();

      for (let i = 0; i < 10; i++) {
        getAllContentSlugsForLocale('en');
        getCMSContentBySlugForLocaleWithDraftSupport('published-article', 'en');
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // This is a basic performance check - adjust threshold as needed
      expect(duration).toBeLessThan(1000); // Should complete in under 1 second
    });
  });
});
