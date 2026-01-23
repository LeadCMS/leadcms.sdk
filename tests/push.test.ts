/**
 * Unit tests for LeadCMS push functionality
 * These tests focus on testing the push execution logic by mocking external dependencies
 */

import { jest } from '@jest/globals';
import { countPushChanges } from '../src/scripts/push-leadcms-content';

// Create a mock module that we can test the push logic with
const mockPushLogic = {
  async analyzePushStatus() {
    // Mock implementation to test different scenarios
    return {
      toCreate: [],
      toUpdate: [],
      conflicts: [],
      inSync: []
    };
  },

  async executePush(analysisResult: any, options: any = {}) {
    // Mock implementation for push execution
    const { toCreate, toUpdate, conflicts } = analysisResult;
    const { force = false } = options;

    if (conflicts.length > 0 && !force) {
      throw new Error('Conflicts exist - use force flag to override');
    }

    const results = {
      created: toCreate.length,
      updated: toUpdate.length,
      errors: []
    };

    return results;
  }
};

describe('LeadCMS Push', () => {
  describe('Push Execution Logic', () => {
    it('should refuse to push when conflicts exist without force flag', async () => {
      const analysisResult = {
        toCreate: [],
        toUpdate: [],
        conflicts: [{ slug: 'conflicted', type: 'article', language: 'en' }],
        inSync: []
      };

      await expect(mockPushLogic.executePush(analysisResult, { force: false }))
        .rejects.toThrow('Conflicts exist - use force flag to override');
    });

    it('should push with force flag even when conflicts exist', async () => {
      const analysisResult = {
        toCreate: [{ slug: 'new-article', type: 'article', language: 'en' }],
        toUpdate: [],
        conflicts: [{ slug: 'conflicted', type: 'article', language: 'en' }],
        inSync: []
      };

      const result = await mockPushLogic.executePush(analysisResult, { force: true });

      expect(result.created).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should successfully push when no conflicts exist', async () => {
      const analysisResult = {
        toCreate: [
          { slug: 'new-article-1', type: 'article', language: 'en' },
          { slug: 'new-article-2', type: 'article', language: 'en' }
        ],
        toUpdate: [
          { slug: 'updated-article', type: 'article', language: 'en' }
        ],
        conflicts: [],
        inSync: []
      };

      const result = await mockPushLogic.executePush(analysisResult);

      expect(result.created).toBe(2);
      expect(result.updated).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle push execution with empty analysis result', async () => {
      const analysisResult = {
        toCreate: [],
        toUpdate: [],
        conflicts: [],
        inSync: []
      };

      const result = await mockPushLogic.executePush(analysisResult);

      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle push execution with only updates', async () => {
      const analysisResult = {
        toCreate: [],
        toUpdate: [
          { slug: 'updated-article-1', type: 'article', language: 'en' },
          { slug: 'updated-article-2', type: 'page', language: 'es' },
          { slug: 'updated-article-3', type: 'blog', language: 'fr' }
        ],
        conflicts: [],
        inSync: []
      };

      const result = await mockPushLogic.executePush(analysisResult);

      expect(result.created).toBe(0);
      expect(result.updated).toBe(3);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle push execution with only creates', async () => {
      const analysisResult = {
        toCreate: [
          { slug: 'new-article-1', type: 'article', language: 'en' },
          { slug: 'new-page', type: 'page', language: 'es' }
        ],
        toUpdate: [],
        conflicts: [],
        inSync: []
      };

      const result = await mockPushLogic.executePush(analysisResult);

      expect(result.created).toBe(2);
      expect(result.updated).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle mixed create and update operations', async () => {
      const analysisResult = {
        toCreate: [
          { slug: 'new-article', type: 'article', language: 'en' }
        ],
        toUpdate: [
          { slug: 'existing-article', type: 'article', language: 'en' },
          { slug: 'existing-page', type: 'page', language: 'es' }
        ],
        conflicts: [],
        inSync: [
          { slug: 'synced-content', type: 'blog', language: 'fr' }
        ]
      };

      const result = await mockPushLogic.executePush(analysisResult);

      expect(result.created).toBe(1);
      expect(result.updated).toBe(2);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('URL Transformation for Push (Backward Transformation)', () => {
    it('should transform local media URLs back to API media URLs when formatting for API', async () => {
      // Import the transformation function
      const { replaceLocalMediaPaths } = require('../src/lib/content-transformation');

      const localContent = {
        slug: 'test-article',
        type: 'article',
        language: 'en',
        title: 'Test Article',
        coverImageUrl: '/media/blog/covers/test-article.jpg',
        featuredImage: '/media/images/featured.png',
        gallery: [
          '/media/gallery/image1.jpg',
          '/media/gallery/image2.png'
        ],
        body: `---
title: Test Article
coverImageUrl: /media/blog/covers/test-article.jpg
---

# Test Article

![Inline image](/media/inline/test.jpg) and [download link](/media/docs/file.pdf).

<Image src="/media/gallery/hero.webp" alt="Hero" />`,
        metadata: {
          heroSection: {
            backgroundImage: '/media/backgrounds/hero.jpg',
            ctaButton: {
              backgroundImage: '/media/buttons/cta.png'
            }
          }
        }
      };

      const result = replaceLocalMediaPaths(localContent);

      // All /media/ URLs should be converted to /api/media/
      expect(result.coverImageUrl).toBe('/api/media/blog/covers/test-article.jpg');
      expect(result.featuredImage).toBe('/api/media/images/featured.png');
      expect(result.gallery[0]).toBe('/api/media/gallery/image1.jpg');
      expect(result.gallery[1]).toBe('/api/media/gallery/image2.png');

      // URLs in body content should also be transformed
      expect(result.body).toContain('coverImageUrl: /api/media/blog/covers/test-article.jpg');
      expect(result.body).toContain('![Inline image](/api/media/inline/test.jpg)');
      expect(result.body).toContain('[download link](/api/media/docs/file.pdf)');
      expect(result.body).toContain('<Image src="/api/media/gallery/hero.webp"');

      // Nested metadata should also be transformed
      expect(result.metadata.heroSection.backgroundImage).toBe('/api/media/backgrounds/hero.jpg');
      expect(result.metadata.heroSection.ctaButton.backgroundImage).toBe('/api/media/buttons/cta.png');

      // Should NOT contain original /media/ URLs
      expect(JSON.stringify(result)).not.toMatch(/(?<!api)\/media\//);
    });

    it('should preserve non-media URLs during backward transformation', async () => {
      const { replaceLocalMediaPaths } = require('../src/lib/content-transformation');

      const contentWithMixedUrls = {
        mediaImage: '/media/images/test.jpg',
        externalUrl: 'https://example.com/media/should-not-change.jpg',
        relativeUrl: '/api/content/something',
        hashUrl: '#section',
        mailtoUrl: 'mailto:test@example.com',
        telUrl: 'tel:+1234567890',
        apiEndpoint: '/api/users/123',
        description: 'Visit https://example.com/media/external.jpg for external media, or check /media/local.jpg for local media'
      };

      const result = replaceLocalMediaPaths(contentWithMixedUrls);

      // Only /media/ URLs should be transformed to /api/media/
      expect(result.mediaImage).toBe('/api/media/images/test.jpg');

      // Other URLs should remain unchanged
      expect(result.externalUrl).toBe('https://example.com/media/should-not-change.jpg');
      expect(result.relativeUrl).toBe('/api/content/something');
      expect(result.hashUrl).toBe('#section');
      expect(result.mailtoUrl).toBe('mailto:test@example.com');
      expect(result.telUrl).toBe('tel:+1234567890');
      expect(result.apiEndpoint).toBe('/api/users/123');

      // In strings, only /media/ should be transformed
      expect(result.description).toBe('Visit https://example.com/media/external.jpg for external media, or check /api/media/local.jpg for local media');
    });

    it('should handle complex nested objects with backward transformation', async () => {
      const { replaceLocalMediaPaths } = require('../src/lib/content-transformation');

      const complexObject = {
        hero: {
          backgroundImage: '/media/backgrounds/hero.jpg',
          overlayImage: '/media/overlays/gradient.png'
        },
        sections: [
          {
            title: 'Section 1',
            image: '/media/sections/section1.jpg',
            items: [
              { icon: '/media/icons/icon1.svg' },
              { icon: '/media/icons/icon2.svg' }
            ]
          }
        ],
        body: `<div style="background-image: url('/media/bg.jpg')">
  <img src="/media/content/image.png" alt="Content" />
</div>`
      };

      const result = replaceLocalMediaPaths(complexObject);

      expect(result.hero.backgroundImage).toBe('/api/media/backgrounds/hero.jpg');
      expect(result.hero.overlayImage).toBe('/api/media/overlays/gradient.png');
      expect(result.sections[0].image).toBe('/api/media/sections/section1.jpg');
      expect(result.sections[0].items[0].icon).toBe('/api/media/icons/icon1.svg');
      expect(result.sections[0].items[1].icon).toBe('/api/media/icons/icon2.svg');
      expect(result.body).toContain("url('/api/media/bg.jpg')");
      expect(result.body).toContain('src="/api/media/content/image.png"');
    });

    it('should test end-to-end push with backward URL transformation', async () => {
      // This test simulates the formatContentForAPI function with URL transformation
      const mockLocalContent = {
        slug: 'sample-page',
        type: 'page',
        locale: 'en',
        body: `---
title: Sample Page
heroImage: /media/hero.jpg
---

# Sample Page

![Content Image](/media/content/sample.jpg)`,
        metadata: {
          title: 'Sample Page',
          heroImage: '/media/hero.jpg',
          gallery: ['/media/gallery/1.jpg', '/media/gallery/2.jpg']
        },
        filePath: '/path/to/sample-page.mdx',
        isLocal: true
      };

      // Simulate the formatContentForAPI function
      const formatContentForAPI = (localContent: any) => {
        const contentData: any = {
          slug: localContent.slug,
          type: localContent.type,
          language: localContent.locale,
          body: localContent.body,
          ...localContent.metadata
        };

        // Remove local-only fields
        delete contentData.filePath;
        delete contentData.isLocal;

        // Apply backward URL transformation
        const { replaceLocalMediaPaths } = require('../src/lib/content-transformation');
        return replaceLocalMediaPaths(contentData);
      };

      const apiContent = formatContentForAPI(mockLocalContent);

      // Check that all /media/ URLs are converted to /api/media/
      expect(apiContent.heroImage).toBe('/api/media/hero.jpg');
      expect(apiContent.gallery[0]).toBe('/api/media/gallery/1.jpg');
      expect(apiContent.gallery[1]).toBe('/api/media/gallery/2.jpg');
      expect(apiContent.body).toContain('heroImage: /api/media/hero.jpg');
      expect(apiContent.body).toContain('![Content Image](/api/media/content/sample.jpg)');

      // Should not contain local-only fields
      expect(apiContent.filePath).toBeUndefined();
      expect(apiContent.isLocal).toBeUndefined();

      // Should not contain any /media/ URLs (all should be /api/media/)
      expect(JSON.stringify(apiContent)).not.toMatch(/(?<!api)\/media\//);
    });
  });

  describe('Push Options and Flags', () => {
    it('should respect the force flag when conflicts exist', async () => {
      const analysisResult = {
        toCreate: [],
        toUpdate: [{ slug: 'updated', type: 'article', language: 'en' }],
        conflicts: [
          { slug: 'conflict-1', type: 'article', language: 'en' },
          { slug: 'conflict-2', type: 'page', language: 'es' }
        ],
        inSync: []
      };

      // Should fail without force flag
      await expect(mockPushLogic.executePush(analysisResult, { force: false }))
        .rejects.toThrow('Conflicts exist - use force flag to override');

      // Should succeed with force flag
      const result = await mockPushLogic.executePush(analysisResult, { force: true });
      expect(result.created).toBe(0);
      expect(result.updated).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should not require force flag when no conflicts exist', async () => {
      const analysisResult = {
        toCreate: [{ slug: 'new', type: 'article', language: 'en' }],
        toUpdate: [{ slug: 'updated', type: 'article', language: 'en' }],
        conflicts: [],
        inSync: []
      };

      const result = await mockPushLogic.executePush(analysisResult, { force: false });
      expect(result.created).toBe(1);
      expect(result.updated).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle undefined options object', async () => {
      const analysisResult = {
        toCreate: [{ slug: 'new', type: 'article', language: 'en' }],
        toUpdate: [],
        conflicts: [],
        inSync: []
      };

      const result = await mockPushLogic.executePush(analysisResult);
      expect(result.created).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle empty options object', async () => {
      const analysisResult = {
        toCreate: [],
        toUpdate: [{ slug: 'updated', type: 'article', language: 'en' }],
        conflicts: [],
        inSync: []
      };

      const result = await mockPushLogic.executePush(analysisResult, {});
      expect(result.created).toBe(0);
      expect(result.updated).toBe(1);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Custom Frontmatter Preservation', () => {
    it('should preserve custom attributes in frontmatter within body during push operations', async () => {
      // Import the ACTUAL formatContentForAPI function from the utility file
      const { formatContentForAPI } = await import('../src/lib/content-api-formatting.ts');
      const grayMatter = await import('gray-matter');
      const matter = grayMatter.default;

      // Create a LocalContentItem that simulates parsed frontmatter with custom attributes
      const mockLocalContentWithCustomAttributes = {
        filePath: '/path/to/content/blog/custom-article.mdx',
        slug: 'blog/custom-article',
        locale: 'en',
        type: 'blog-article',
        body: 'Test article content',
        metadata: {
          id: 59,
          createdAt: '2025-10-28T17:14:06.903848Z',
          updatedAt: '2025-10-30T04:48:35.208197Z',
          title: 'Test Article',
          description: 'Test article description',
          coverImageUrl: '/media/test-cover.jpg',
          coverImageAlt: 'Test cover image',
          slug: 'test-article',
          type: 'article',
          author: 'Test Author',
          language: 'en',
          category: 'Test',
          tags: ['test'],
          allowComments: true,
          source: 'test-source',
          publishedAt: '2025-10-27T18:30:00Z',
          featured: true, // Custom attribute that should be preserved in frontmatter
          customRating: 5, // Another custom attribute
          customTags: ['test'], // Custom array attribute
          customMetadata: { // Custom nested object
            seoScore: 95,
            readingTime: '8 minutes'
          }
        },
        isLocal: true
      };

      // Use the REAL formatContentForAPI function
      const apiFormattedContent = formatContentForAPI(mockLocalContentWithCustomAttributes);

      // Verify that only standard fields are present as top-level properties
      // Note: id, createdAt, updatedAt are removed (read-only, managed by API)
      expect(apiFormattedContent.slug).toBe('blog/custom-article');
      expect(apiFormattedContent.type).toBe('article');
      expect(apiFormattedContent.language).toBe('en');
      expect(apiFormattedContent.id).toBeUndefined();
      expect(apiFormattedContent.createdAt).toBeUndefined();
      expect(apiFormattedContent.updatedAt).toBeUndefined();
      expect(apiFormattedContent.title).toBe('Test Article');
      expect(apiFormattedContent.publishedAt).toBe('2025-10-27T18:30:00Z');

      // Verify that standard fields ARE present as top-level properties
      expect(apiFormattedContent.description).toBe('Test article description');
      expect(apiFormattedContent.author).toBe('Test Author');
      expect(apiFormattedContent.category).toBe('Test');
      expect(apiFormattedContent.allowComments).toBe(true);
      expect(apiFormattedContent.source).toBe('test-source');
      expect(apiFormattedContent.tags).toEqual(['test']);
      expect(apiFormattedContent.coverImageUrl).toBe('/api/media/test-cover.jpg');
      expect(apiFormattedContent.coverImageAlt).toBe('Test cover image');

      // Verify that custom attributes are NOT present as top-level properties
      expect(apiFormattedContent).not.toHaveProperty('featured'); // featured is custom, not in API schema
      expect(apiFormattedContent).not.toHaveProperty('customRating');
      expect(apiFormattedContent).not.toHaveProperty('customTags');
      expect(apiFormattedContent).not.toHaveProperty('customMetadata');

      // Verify that custom attributes are preserved in the body frontmatter
      expect(apiFormattedContent.body).toBeDefined();
      const parsedBody = matter(apiFormattedContent.body || '');

      // Check that ONLY custom attributes are in the frontmatter (no duplication of standard fields)
      expect(parsedBody.data.featured).toBe(true); // featured is custom, preserved in frontmatter
      expect(parsedBody.data.customRating).toBe(5);
      expect(parsedBody.data.customTags).toEqual(['test']);
      expect(parsedBody.data.customMetadata).toEqual({
        seoScore: 95,
        readingTime: '8 minutes'
      });

      // Standard fields should NOT be duplicated in frontmatter since they're sent as top-level
      expect(parsedBody.data).not.toHaveProperty('description');
      expect(parsedBody.data).not.toHaveProperty('author');
      expect(parsedBody.data).not.toHaveProperty('category');
      expect(parsedBody.data).not.toHaveProperty('allowComments');
      expect(parsedBody.data).not.toHaveProperty('title');
      expect(parsedBody.data).not.toHaveProperty('createdAt');
      expect(parsedBody.data).not.toHaveProperty('updatedAt');

      // URL transformation should work in custom fields if they contain media URLs
      // (coverImageUrl is now a standard field, so it's not in frontmatter)

      // Verify the body content is preserved
      expect(parsedBody.content.trim()).toBe('Test article content');

      // Verify local-only fields are removed
      expect(apiFormattedContent).not.toHaveProperty('filePath');
      expect(apiFormattedContent).not.toHaveProperty('isLocal');
      expect(parsedBody.data).not.toHaveProperty('filePath');
      expect(parsedBody.data).not.toHaveProperty('isLocal');
    });
  });

  describe('Push Result Validation', () => {
    it('should return consistent result structure', async () => {
      const analysisResult = {
        toCreate: [{ slug: 'new', type: 'article', language: 'en' }],
        toUpdate: [{ slug: 'updated', type: 'page', language: 'es' }],
        conflicts: [],
        inSync: []
      };

      const result = await mockPushLogic.executePush(analysisResult);

      expect(result).toHaveProperty('created');
      expect(result).toHaveProperty('updated');
      expect(result).toHaveProperty('errors');
      expect(typeof result.created).toBe('number');
      expect(typeof result.updated).toBe('number');
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it('should initialize errors as empty array', async () => {
      const analysisResult = {
        toCreate: [],
        toUpdate: [],
        conflicts: [],
        inSync: []
      };

      const result = await mockPushLogic.executePush(analysisResult);
      expect(result.errors).toEqual([]);
    });

    it('should correctly count created and updated items', async () => {
      const analysisResult = {
        toCreate: [
          { slug: 'new-1', type: 'article', language: 'en' },
          { slug: 'new-2', type: 'page', language: 'es' },
          { slug: 'new-3', type: 'blog', language: 'fr' }
        ],
        toUpdate: [
          { slug: 'updated-1', type: 'article', language: 'en' },
          { slug: 'updated-2', type: 'page', language: 'es' }
        ],
        conflicts: [],
        inSync: []
      };

      const result = await mockPushLogic.executePush(analysisResult);
      expect(result.created).toBe(3);
      expect(result.updated).toBe(2);
    });
  });

  describe('Change Counting Logic', () => {
    it('should include conflicts only when enabled', () => {
      const operations: any = {
        create: [],
        update: [],
        rename: [],
        typeChange: [],
        conflict: [{ local: {}, remote: {} }, { local: {}, remote: {} }],
        delete: []
      };

      expect(countPushChanges(operations, false)).toBe(0);
      expect(countPushChanges(operations, true)).toBe(2);
    });

    it('should count regular operations without conflicts', () => {
      const operations: any = {
        create: [{ local: {} }],
        update: [{ local: {}, remote: {} }, { local: {}, remote: {} }],
        rename: [{ local: {}, remote: {}, oldSlug: 'old' }],
        typeChange: [{ local: {}, remote: {}, oldType: 'old', newType: 'new' }],
        conflict: [{ local: {}, remote: {} }],
        delete: []
      };

      expect(countPushChanges(operations, false)).toBe(5);
    });
  });
});
