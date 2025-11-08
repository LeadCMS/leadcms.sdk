import {
  getAllContentSlugsForLocale,
  getCMSContentBySlugForLocale,
  getAllContentRoutes,
} from '../src/lib/cms';
import { TEST_USER_UID, TEST_USER_UID_2 } from './setup';

describe('LeadCMS SDK - Advanced Draft Scenarios', () => {
  describe('User-specific draft behavior', () => {
    it('should prioritize user drafts over base content', () => {
      // Get base content
      const baseContent = getCMSContentBySlugForLocale(
        'published-article',
        'en'
      );
      expect(baseContent?.title).toBe('Published Article');

      // Get user's draft version
      const userContent = getCMSContentBySlugForLocale(
        'published-article',
        'en',
        TEST_USER_UID
      );
      expect(userContent?.title).toBe('Published Article - User Draft');

      // Verify they are different
      expect(baseContent?.title).not.toBe(userContent?.title);
    });

    it('should return user drafts even with future publishedAt', () => {
      const userContent = getCMSContentBySlugForLocale(
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
      const userContent = getCMSContentBySlugForLocale(
        'user-only-draft',
        'en',
        TEST_USER_UID
      );
      expect(userContent).not.toBeNull();
      expect(userContent?.title).toBe('User Only Draft');

      // Different user should not see it
      const otherUserContent = getCMSContentBySlugForLocale(
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
      const publishedSlugs = getAllContentSlugsForLocale('en');
      expect(publishedSlugs).toContain('published-article');
      expect(publishedSlugs).toContain('json-article');
      expect(publishedSlugs).not.toContain('draft-article');
      expect(publishedSlugs).not.toContain('future-article');

      // In test environment (NODE_ENV=test), drafts are filtered out by default
      const allSlugs = getAllContentSlugsForLocale('en');
      expect(allSlugs).toContain('published-article');
      expect(allSlugs).not.toContain('draft-article'); // Filtered out in test environment
      expect(allSlugs).not.toContain('future-article'); // Filtered out in test environment
    });

    it('should handle user-specific content in test environment', () => {
      // In test environment (not preview mode), userUid has no effect on draft inclusion
      const userSlugs = getAllContentSlugsForLocale('en', undefined, TEST_USER_UID);
      expect(userSlugs).toContain('published-article'); // Published content always included
      expect(userSlugs).not.toContain('draft-article'); // Drafts filtered out in test environment
      expect(userSlugs).not.toContain('user-only-draft'); // User drafts filtered out in test environment
    });

    it('should respect content type filtering', () => {
      // Articles only - in test environment, drafts are filtered out by default
      const articles = getAllContentSlugsForLocale('en', ['article']);
      expect(articles).toContain('published-article');
      expect(articles).toContain('json-article');
      expect(articles).not.toContain('draft-article'); // Filtered out in test environment
      expect(articles).not.toContain('future-article'); // Filtered out in test environment
      expect(articles).not.toContain('about'); // page type
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

    it('should filter draft routes in test environment', () => {
      const routes = getAllContentRoutes();

      // In test environment, draft routes are filtered out by default
      const draftRoute = routes.find(r => r.slug === 'draft-article');
      const futureRoute = routes.find(r => r.slug === 'future-article');

      expect(draftRoute).toBeFalsy(); // Filtered out in test environment
      expect(futureRoute).toBeFalsy(); // Filtered out in test environment

      // Published routes should be included
      const publishedRoute = routes.find(r => r.slug === 'published-article');
      expect(publishedRoute).toBeTruthy();
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

    it('should handle user-specific content in test environment', () => {
      const userRoutes = getAllContentRoutes(undefined, TEST_USER_UID);

      // In test environment (not preview mode), user drafts are filtered out
      const userOnlyRoute = userRoutes.find(r => r.slug === 'user-only-draft');
      expect(userOnlyRoute).toBeFalsy(); // Filtered out in test environment

      // Published content should still be included
      const articleRoute = userRoutes.find(r => r.slug === 'published-article');
      expect(articleRoute).toBeTruthy();
    });
  });

  describe('GUID validation edge cases', () => {
    const { extractUserUidFromSlug } = require('../src/lib/cms');

    it('should handle case-insensitive GUIDs and normalize to lowercase', () => {
      const lowerGuid = '550e8400-e29b-41d4-a716-446655440000';
      const upperGuid = '550E8400-E29B-41D4-A716-446655440000';
      const mixedGuid = '550e8400-E29B-41d4-A716-446655440000';

      // All GUIDs are normalized to lowercase for consistent file system lookups
      expect(extractUserUidFromSlug(`article-${lowerGuid}`)).toBe(lowerGuid);
      expect(extractUserUidFromSlug(`article-${upperGuid}`)).toBe(lowerGuid); // normalized to lowercase
      expect(extractUserUidFromSlug(`article-${mixedGuid}`)).toBe(lowerGuid); // normalized to lowercase
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

  describe('Draft isolation in collections', () => {
    beforeEach(() => {
      // Set up development mode to enable draft handling
      process.env.NODE_ENV = 'development';
    });

    afterEach(() => {
      // Clean up
      delete process.env.NODE_ENV;
    });

    it('should only return own user drafts in collection, not other users drafts', () => {
      // Test the issue: when requesting collection with userUid,
      // should only get published content + own user's drafts
      // Should NOT get drafts from other users OR general draft content

      // Get slugs for user 1 - should include user 1's drafts but not user 2's drafts
      const user1Slugs = getAllContentSlugsForLocale('en', undefined, TEST_USER_UID);

      // Get slugs for user 2 - should include user 2's drafts but not user 1's drafts
      const user2Slugs = getAllContentSlugsForLocale('en', undefined, TEST_USER_UID_2);

      // Get baseline published-only content (no userUid, production mode)
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      const publishedOnlySlug = getAllContentSlugsForLocale('en');
      process.env.NODE_ENV = originalNodeEnv;

      // Verify the collections are properly filtered

      // Published content should appear in both lists
      expect(user1Slugs).toContain('published-article');
      expect(user2Slugs).toContain('published-article');

      // User 1 should see their own draft content as base slugs (without GUID suffix)
      expect(user1Slugs).toContain('user-only-draft'); // This exists as user-only-draft-{TEST_USER_UID}

      // User 2 should see their own draft content as base slugs (without GUID suffix)
      expect(user2Slugs).toContain('secret-draft'); // This exists as secret-draft-{TEST_USER_UID_2}
      expect(user2Slugs).toContain('another-draft'); // This exists as another-draft-{TEST_USER_UID_2}

      // CRITICAL: User 1 should NOT see user 2's drafts
      expect(user1Slugs).not.toContain('secret-draft'); // Should NOT appear for user 1
      expect(user1Slugs).not.toContain('another-draft'); // Should NOT appear for user 1

      // CRITICAL: User 2 should NOT see user 1's drafts
      expect(user2Slugs).not.toContain('user-only-draft'); // Should NOT appear for user 2

      // CRITICAL: Users should NOT see general draft content that doesn't belong to them
      // These are draft files without user UIDs - should not appear in user-specific collections
      expect(user1Slugs).not.toContain('draft-article'); // General draft, not user-specific
      expect(user2Slugs).not.toContain('draft-article'); // General draft, not user-specific
      expect(user1Slugs).not.toContain('future-article'); // Future article, not user-specific
      expect(user2Slugs).not.toContain('future-article'); // Future article, not user-specific
      expect(user1Slugs).not.toContain('blog/post-2-draft'); // Blog draft, not user-specific
      expect(user2Slugs).not.toContain('blog/post-2-draft'); // Blog draft, not user-specific
    });
  });

  describe('Performance and caching', () => {
    it('should handle multiple calls efficiently', () => {
      // Test that multiple calls don't cause issues
      const startTime = Date.now();

      for (let i = 0; i < 10; i++) {
        getAllContentSlugsForLocale('en');
        getCMSContentBySlugForLocale('published-article', 'en');
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // This is a basic performance check - adjust threshold as needed
      expect(duration).toBeLessThan(1000); // Should complete in under 1 second
    });
  });
});
