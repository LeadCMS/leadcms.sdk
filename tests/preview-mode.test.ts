import { getCMSContentBySlugForLocale } from '../src/lib/cms';
import { TEST_USER_UID } from './setup';

// Additional GUID for testing various preview slug scenarios
const EXAMPLE_PREVIEW_GUID = '0fb41255-5df0-4777-8212-b01b2d59aac5';

describe('Preview Mode - Automatic Draft Access', () => {
  describe('Problem Statement - Draft content without publishedAt', () => {
    it('should NOT return draft content without publishedAt for normal slugs', () => {
      // Normal slug - draft content should be filtered out
      const content = getCMSContentBySlugForLocale('home', 'en');

      expect(content).toBeNull(); // Draft without publishedAt is filtered
    });

    it('should return draft content via preview slug even without publishedAt', () => {
      // Preview slug - draft content should be accessible
      const previewSlug = `home-${TEST_USER_UID}`;
      const content = getCMSContentBySlugForLocale(previewSlug, 'en');

      expect(content).not.toBeNull();
      expect(content?.title).toBe('My Homepage - Preview Version');
      expect(content?.slug).toBe(previewSlug);
    });

    it('should enable preview workflow without explicit configuration', () => {
      // This demonstrates the zero-configuration preview mode
      // LeadCMS generates preview URLs like: home-{userUid}
      // The SDK automatically detects this and enables draft access

      const previewUrl = `home-${EXAMPLE_PREVIEW_GUID}`;

      // No configuration needed - just pass the preview slug
      const content = getCMSContentBySlugForLocale(previewUrl, 'en');

      // Will try to load the user draft, then falls back to base content
      // Base content exists (home.mdx), so it's returned with preview slug
      expect(content).not.toBeNull();
      expect(content?.title).toBe('My Homepage');
      expect(content?.slug).toBe(previewUrl); // Slug is updated to preview slug

      // With our test GUID, it loads the user-specific draft
      const workingPreview = `home-${TEST_USER_UID}`;
      const workingContent = getCMSContentBySlugForLocale(workingPreview, 'en');
      expect(workingContent).not.toBeNull();
      expect(workingContent?.title).toBe('My Homepage - Preview Version');
    });
  });

  describe('Preview slug detection', () => {
    it('should automatically enable draft access for preview slugs with GUID', () => {
      // Preview slug with userUid should return content even with future publishedAt
      const previewSlug = `published-article-${TEST_USER_UID}`;
      const content = getCMSContentBySlugForLocale(previewSlug, 'en');

      expect(content).not.toBeNull();
      expect(content?.title).toBe('Published Article - User Draft');
      expect(content?.slug).toBe(previewSlug);
    });

    it('should return user-only draft content via preview slug', () => {
      // User-only draft (no base version exists)
      const previewSlug = `user-only-draft-${TEST_USER_UID}`;
      const content = getCMSContentBySlugForLocale(previewSlug, 'en');

      expect(content).not.toBeNull();
      expect(content?.title).toBe('User Only Draft');
    });

    it('should return null for non-existent preview slugs', () => {
      const previewSlug = `non-existent-${TEST_USER_UID}`;
      const content = getCMSContentBySlugForLocale(previewSlug, 'en');

      expect(content).toBeNull();
    });

    it('should work with different GUID formats (case insensitive)', () => {
      // GUIDs are case-insensitive in pattern matching, and we normalize to lowercase for file lookups
      // So uppercase GUID will match the pattern and find the user draft file (normalized to lowercase)
      const uppercaseGuid = TEST_USER_UID.toUpperCase();
      const previewSlug = `published-article-${uppercaseGuid}`;
      const content = getCMSContentBySlugForLocale(previewSlug, 'en');

      expect(content).not.toBeNull();
      // Should find the user draft since we normalize GUIDs to lowercase for file system lookups
      expect(content?.title).toBe('Published Article - User Draft');
    });
  });

  describe('Normal slug behavior (backward compatibility)', () => {
    it('should filter out draft content for normal slugs by default', () => {
      // Normal slug without publishedAt should return null
      const content = getCMSContentBySlugForLocale('draft-article', 'en');

      expect(content).toBeNull();
    });

    it('should return published content for normal slugs', () => {
      // Normal slug with publishedAt should return content
      const content = getCMSContentBySlugForLocale('published-article', 'en');

      expect(content).not.toBeNull();
      expect(content?.title).toBe('Published Article');
    });

    it('should filter out future-dated content for normal slugs', () => {
      // Normal slug with future publishedAt should return null
      const content = getCMSContentBySlugForLocale('future-article', 'en');

      expect(content).toBeNull();
    });

    it('should respect includeDrafts parameter for normal slugs', () => {
      // With includeDrafts=true, should return draft content
      const content = getCMSContentBySlugForLocale('draft-article', 'en', true);

      expect(content).not.toBeNull();
      expect(content?.title).toBe('Draft Article (No publishedAt)');
    });
  });

  describe('Preview mode with base content fallback', () => {
    it('should prefer user draft over base content when preview slug is used', () => {
      // Base content
      const baseContent = getCMSContentBySlugForLocale('published-article', 'en');
      expect(baseContent?.title).toBe('Published Article');

      // Preview content
      const previewSlug = `published-article-${TEST_USER_UID}`;
      const previewContent = getCMSContentBySlugForLocale(previewSlug, 'en');
      expect(previewContent?.title).toBe('Published Article - User Draft');

      // Verify they are different
      expect(baseContent?.title).not.toBe(previewContent?.title);
    });

    it('should return base content when preview slug has no user draft', () => {
      // When a preview slug is used but no user-specific draft exists,
      // it should fall back to base content
      const previewSlug = `about-${TEST_USER_UID}`;
      const content = getCMSContentBySlugForLocale(previewSlug, 'en');

      // The base 'about' content exists, so it should be returned
      expect(content).not.toBeNull();
      expect(content?.slug).toBe(previewSlug);
    });
  });

  describe('Zero-configuration preview workflow', () => {
    it('should work with LeadCMS preview URLs without additional configuration', () => {
      // Simulate a LeadCMS-generated preview URL
      const leadcmsPreviewSlug = `home-${EXAMPLE_PREVIEW_GUID}`;

      // This should work automatically without any configuration
      const content = getCMSContentBySlugForLocale(leadcmsPreviewSlug, 'en');

      // Base content exists, so it's returned with preview slug
      // The important thing is that it doesn't throw an error and attempts draft access
      expect(content).not.toBeNull();
      expect(content?.title).toBe('My Homepage');
      expect(content?.slug).toBe(leadcmsPreviewSlug);
    });

    it('should support nested path preview slugs', () => {
      // Preview slugs can be in nested paths
      const nestedPreviewSlug = `blog/post-1-${TEST_USER_UID}`;

      // Should handle nested paths correctly
      const content = getCMSContentBySlugForLocale(nestedPreviewSlug, 'en');

      // Base content exists (blog/post-1), so it should be returned with preview slug
      expect(content).not.toBeNull();
      expect(content?.slug).toBe(nestedPreviewSlug);
      expect(content?.title).toBe('Blog Post 1');
    });
  });

  describe('Security considerations', () => {
    it('should only enable draft access for valid GUID patterns', () => {
      // Invalid GUID patterns should not enable draft access
      const invalidPatterns = [
        'draft-article-user-123', // Not a GUID
        'draft-article-550e8400', // Incomplete GUID
        'draft-article-550e8400e29b41d4a716446655440000', // GUID without dashes
      ];

      for (const slug of invalidPatterns) {
        const content = getCMSContentBySlugForLocale(slug, 'en');
        // These should not get draft access, so draft-article won't be returned
        expect(content).toBeNull();
      }
    });

    it('should require GUID at the end of slug', () => {
      // GUID must be at the end of the slug
      const middleGuid = `${TEST_USER_UID}-draft-article`;
      const content = getCMSContentBySlugForLocale(middleGuid, 'en');

      // Should not enable draft access (GUID not at end)
      expect(content).toBeNull();
    });
  });
});
