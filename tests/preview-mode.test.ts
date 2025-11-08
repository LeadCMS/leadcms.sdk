import {
  getCMSContentBySlugForLocale,
  getAllContentSlugsForLocale,
  getAllContentRoutes,
  getContentTranslations,
} from '../src/lib/cms';
import { configure, isPreviewMode } from '../src/lib/config';
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

    it('should filter out draft content in test environment', () => {
      // In test environment, draft content is filtered out by default
      const content = getCMSContentBySlugForLocale('draft-article', 'en');

      expect(content).toBeNull(); // Filtered out in test environment
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

// Store original environment values to restore after tests
const originalNodeEnv = process.env.NODE_ENV;
const originalLeadCMSPreview = process.env.LEADCMS_PREVIEW;

describe('Unified Preview Mode Detection', () => {
  beforeEach(() => {
    // Clear any global configuration between tests
    configure({} as any);
    delete process.env.NODE_ENV;
    delete process.env.LEADCMS_PREVIEW;
  });

  afterEach(() => {
    // Restore original environment values
    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }

    if (originalLeadCMSPreview !== undefined) {
      process.env.LEADCMS_PREVIEW = originalLeadCMSPreview;
    } else {
      delete process.env.LEADCMS_PREVIEW;
    }
  });

  it('should detect preview mode when NODE_ENV is "development"', () => {
    process.env.NODE_ENV = 'development';
    expect(isPreviewMode()).toBe(true);
  });

  it('should detect preview mode when LEADCMS_PREVIEW is "true"', () => {
    process.env.NODE_ENV = 'production'; // Ensure we're not in development mode
    process.env.LEADCMS_PREVIEW = 'true';
    expect(isPreviewMode()).toBe(true);
  });

  it('should not detect preview mode when LEADCMS_PREVIEW is "false"', () => {
    process.env.LEADCMS_PREVIEW = 'false';
    expect(isPreviewMode()).toBe(false);
  });

  it('should not detect preview mode in production', () => {
    process.env.NODE_ENV = 'production';
    expect(isPreviewMode()).toBe(false);
  });

  it('should not detect preview mode in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.LEADCMS_PREVIEW; // Ensure no override
    expect(isPreviewMode()).toBe(false);
  });

  it('should prioritize LEADCMS_PREVIEW over NODE_ENV', () => {
    process.env.NODE_ENV = 'development';
    process.env.LEADCMS_PREVIEW = 'false';
    expect(isPreviewMode()).toBe(false);
  });

  it('should prioritize global configuration over environment variables', () => {
    process.env.NODE_ENV = 'preview';
    process.env.LEADCMS_PREVIEW = 'true';
    configure({ preview: false });
    expect(isPreviewMode()).toBe(false);
  });

  it('should allow global configuration to enable preview mode', () => {
    process.env.NODE_ENV = 'production';
    configure({ preview: true });
    expect(isPreviewMode()).toBe(true);
  });
});

describe('Unified Content Retrieval in Different Modes', () => {
  // Child sections manage their own environment variables

  describe('Production Mode Behavior', () => {
    beforeEach(() => {
      configure({} as any);
      delete process.env.LEADCMS_PREVIEW;
      process.env.NODE_ENV = 'production';
    });

    it('should return only published content', () => {
      const content = getCMSContentBySlugForLocale('published-article', 'en');
      expect(content).not.toBeNull();
      expect(content?.slug).toBe('published-article');
    });

    it('should exclude draft content', () => {
      const content = getCMSContentBySlugForLocale('draft-article', 'en');
      expect(content).toBeNull();
    });

    it('should allow user-specific slugs for preview URLs', () => {
      // Preview URLs with valid GUIDs should work even in production mode
      const userSpecificSlug = `published-article-${TEST_USER_UID}`;
      const content = getCMSContentBySlugForLocale(userSpecificSlug, 'en');
      expect(content).not.toBeNull();
      expect(content?.slug).toBe(userSpecificSlug);
    });

    it('should exclude drafts from slug listings', () => {
      const slugs = getAllContentSlugsForLocale('en');
      expect(slugs).toContain('published-article');
      expect(slugs).not.toContain('draft-article');
      expect(slugs).not.toContain(`published-article-${TEST_USER_UID}`);
    });
  });

  describe('Preview Mode Behavior', () => {
    beforeEach(() => {
      configure({} as any);
      delete process.env.LEADCMS_PREVIEW;
      process.env.NODE_ENV = 'development';
    });

    it('should include draft content by default', () => {
      const content = getCMSContentBySlugForLocale('draft-article', 'en');
      expect(content).not.toBeNull();
      expect(content?.slug).toBe('draft-article');
    });

    it('should handle user-specific slugs', () => {
      const userSpecificSlug = `published-article-${TEST_USER_UID}`;
      const content = getCMSContentBySlugForLocale(userSpecificSlug, 'en');
      expect(content).not.toBeNull();
      expect(content?.slug).toBe(userSpecificSlug);
    });

    it('should exclude drafts from listings by default', () => {
      const slugs = getAllContentSlugsForLocale('en');
      expect(slugs).toContain('published-article');
      expect(slugs).not.toContain('draft-article');
      expect(slugs).not.toContain(`published-article-${TEST_USER_UID}`);
    });

    it('should exclude drafts in test environment by default', () => {
      // Override to test environment for this specific test
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'test';

      try {
        const content = getCMSContentBySlugForLocale('draft-article', 'en');
        expect(content).toBeNull(); // Filtered out in test environment by default
      } finally {
        // Restore original environment
        if (originalNodeEnv !== undefined) {
          process.env.NODE_ENV = originalNodeEnv;
        } else {
          delete process.env.NODE_ENV;
        }
      }
    });
  });
});

describe('Global Configuration Override', () => {
  beforeEach(() => {
    configure({} as any);
    delete process.env.NODE_ENV;
    delete process.env.LEADCMS_PREVIEW;
  });

  afterEach(() => {
    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }

    if (originalLeadCMSPreview !== undefined) {
      process.env.LEADCMS_PREVIEW = originalLeadCMSPreview;
    } else {
      delete process.env.LEADCMS_PREVIEW;
    }
  });

  it('should enable preview mode globally even in production', () => {
    process.env.NODE_ENV = 'production';
    configure({ preview: true });

    expect(isPreviewMode()).toBe(true);

    const content = getCMSContentBySlugForLocale('draft-article', 'en');
    expect(content).not.toBeNull();
  });

  it('should disable preview mode globally even when environment suggests preview', () => {
    process.env.NODE_ENV = 'preview';
    configure({ preview: false });

    expect(isPreviewMode()).toBe(false);

    const content = getCMSContentBySlugForLocale('draft-article', 'en');
    expect(content).toBeNull();
  });
});
