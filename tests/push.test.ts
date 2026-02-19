/**
 * Unit tests for LeadCMS push functionality
 * Tests real SDK functions: formatContentForAPI, replaceLocalMediaPaths, countPushChanges,
 * and the updateLocalMetadata behavior for force-push conflict resolution.
 */

import { jest } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import matter from 'gray-matter';
import { countPushChanges } from '../src/scripts/push-leadcms-content';

describe('LeadCMS Push', () => {
  describe('URL Transformation for Push (Backward Transformation)', () => {
    it('should transform local media URLs back to API media URLs when formatting for API', async () => {
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

      expect(result.coverImageUrl).toBe('/api/media/blog/covers/test-article.jpg');
      expect(result.featuredImage).toBe('/api/media/images/featured.png');
      expect(result.gallery[0]).toBe('/api/media/gallery/image1.jpg');
      expect(result.gallery[1]).toBe('/api/media/gallery/image2.png');
      expect(result.body).toContain('coverImageUrl: /api/media/blog/covers/test-article.jpg');
      expect(result.body).toContain('![Inline image](/api/media/inline/test.jpg)');
      expect(result.body).toContain('[download link](/api/media/docs/file.pdf)');
      expect(result.body).toContain('<Image src="/api/media/gallery/hero.webp"');
      expect(result.metadata.heroSection.backgroundImage).toBe('/api/media/backgrounds/hero.jpg');
      expect(result.metadata.heroSection.ctaButton.backgroundImage).toBe('/api/media/buttons/cta.png');
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

      expect(result.mediaImage).toBe('/api/media/images/test.jpg');
      expect(result.externalUrl).toBe('https://example.com/media/should-not-change.jpg');
      expect(result.relativeUrl).toBe('/api/content/something');
      expect(result.hashUrl).toBe('#section');
      expect(result.mailtoUrl).toBe('mailto:test@example.com');
      expect(result.telUrl).toBe('tel:+1234567890');
      expect(result.apiEndpoint).toBe('/api/users/123');
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
  });

  describe('Custom Frontmatter Preservation', () => {
    it('should preserve custom attributes in frontmatter within body during push operations', async () => {
      const { formatContentForAPI } = await import('../src/lib/content-api-formatting.ts');
      const grayMatter = await import('gray-matter');
      const matterFn = grayMatter.default;

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
          featured: true,
          customRating: 5,
          customTags: ['test'],
          customMetadata: {
            seoScore: 95,
            readingTime: '8 minutes'
          }
        },
        isLocal: true
      };

      const apiFormattedContent = formatContentForAPI(mockLocalContentWithCustomAttributes);

      // Standard fields as top-level properties
      expect(apiFormattedContent.slug).toBe('blog/custom-article');
      expect(apiFormattedContent.type).toBe('article');
      expect(apiFormattedContent.language).toBe('en');
      expect(apiFormattedContent.id).toBeUndefined();
      expect(apiFormattedContent.createdAt).toBeUndefined();
      expect(apiFormattedContent.updatedAt).toBeUndefined();
      expect(apiFormattedContent.title).toBe('Test Article');
      expect(apiFormattedContent.publishedAt).toBe('2025-10-27T18:30:00Z');
      expect(apiFormattedContent.description).toBe('Test article description');
      expect(apiFormattedContent.author).toBe('Test Author');
      expect(apiFormattedContent.category).toBe('Test');
      expect(apiFormattedContent.allowComments).toBe(true);
      expect(apiFormattedContent.source).toBe('test-source');
      expect(apiFormattedContent.tags).toEqual(['test']);
      expect(apiFormattedContent.coverImageUrl).toBe('/api/media/test-cover.jpg');

      // Custom attributes NOT as top-level properties
      expect(apiFormattedContent).not.toHaveProperty('featured');
      expect(apiFormattedContent).not.toHaveProperty('customRating');
      expect(apiFormattedContent).not.toHaveProperty('customTags');
      expect(apiFormattedContent).not.toHaveProperty('customMetadata');

      // Custom attributes preserved in body frontmatter
      const parsedBody = matterFn(apiFormattedContent.body || '');
      expect(parsedBody.data.featured).toBe(true);
      expect(parsedBody.data.customRating).toBe(5);
      expect(parsedBody.data.customTags).toEqual(['test']);
      expect(parsedBody.data.customMetadata).toEqual({
        seoScore: 95,
        readingTime: '8 minutes'
      });

      // Standard fields NOT duplicated in frontmatter
      expect(parsedBody.data).not.toHaveProperty('description');
      expect(parsedBody.data).not.toHaveProperty('author');
      expect(parsedBody.data).not.toHaveProperty('title');
      expect(parsedBody.data).not.toHaveProperty('createdAt');
      expect(parsedBody.data).not.toHaveProperty('updatedAt');

      expect(parsedBody.content.trim()).toBe('Test article content');
      expect(apiFormattedContent).not.toHaveProperty('filePath');
      expect(apiFormattedContent).not.toHaveProperty('isLocal');
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

  describe('formatContentForAPI - File-Based Slug Priority', () => {
    it('should use file-based slug over metadata slug for renamed content', async () => {
      const { formatContentForAPI } = await import('../src/lib/content-api-formatting.ts');

      const mockLocalContent = {
        slug: 'blog-1',       // New slug from file path
        type: 'blog-index',
        locale: 'en',
        body: 'Blog content here',
        metadata: {
          slug: 'blog',        // Old slug in frontmatter
          title: 'Blog Title',
          type: 'blog-index',
          id: 56
        },
        filePath: '/path/to/blog-1.mdx',
        isLocal: true
      };

      const result = formatContentForAPI(mockLocalContent);

      // File-based slug should win over metadata slug
      expect(result.slug).toBe('blog-1');
      expect(result.type).toBe('blog-index');
    });

    it('should preserve slug when it matches file-based slug', async () => {
      const { formatContentForAPI } = await import('../src/lib/content-api-formatting.ts');

      const mockLocalContent = {
        slug: 'normal-article',
        type: 'article',
        locale: 'en',
        body: 'Article content here',
        metadata: {
          slug: 'normal-article', // Same slug in frontmatter
          title: 'Normal Article',
          type: 'article',
          id: 123
        },
        filePath: '/path/to/normal-article.mdx',
        isLocal: true
      };

      const result = formatContentForAPI(mockLocalContent);

      expect(result.slug).toBe('normal-article');
      expect(result.type).toBe('article');
    });
  });

  describe('updateLocalMetadata - updatedAt Sync After Push', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'leadcms-push-test-'));
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('should update updatedAt in local MDX file after successful push', async () => {
      // This test verifies the force-push bug fix:
      // After pushing, updatedAt must be synced so the next status check
      // does not show a false conflict.
      const filePath = path.join(tmpDir, 'test-article.mdx');
      const originalContent = matter.stringify('# Test content', {
        id: 42,
        title: 'Test Article',
        type: 'article',
        updatedAt: '2024-01-01T00:00:00Z', // Old timestamp
      });
      await fs.writeFile(filePath, originalContent, 'utf-8');

      // Import updateLocalMetadata
      jest.unstable_mockModule('../src/lib/data-service.js', () => ({
        leadCMSDataService: {
          getAllContent: jest.fn(() => Promise.resolve([])),
          getContentTypes: jest.fn(() => Promise.resolve([])),
          isMockMode: jest.fn(() => true),
        },
      }));
      jest.unstable_mockModule('../src/lib/config.js', () => ({
        getConfig: jest.fn(() => ({
          url: 'https://test.leadcms.com',
          apiKey: 'test-key',
          defaultLanguage: 'en',
          contentDir: tmpDir,
          mediaDir: path.join(tmpDir, 'media'),
          emailTemplatesDir: path.join(tmpDir, 'email-templates'),
        })),
      }));

      const { updateLocalMetadata } = await import('../src/scripts/push-leadcms-content.js') as any;

      const localContent = {
        filePath,
        slug: 'test-article',
        locale: 'en',
        type: 'article',
        metadata: { id: 42, title: 'Test Article', type: 'article', updatedAt: '2024-01-01T00:00:00Z' },
        body: '# Test content',
        isLocal: true,
      };

      const remoteResponse = {
        id: 42,
        slug: 'test-article',
        type: 'article',
        title: 'Test Article',
        updatedAt: '2024-06-15T12:00:00Z', // New timestamp from API
        createdAt: '2024-01-01T00:00:00Z',
      };

      await updateLocalMetadata(localContent, remoteResponse);

      // Read back the file and verify updatedAt was synced
      const updatedFile = await fs.readFile(filePath, 'utf-8');
      const parsed = matter(updatedFile);

      expect(parsed.data.id).toBe(42);
      expect(parsed.data.updatedAt).toBe('2024-06-15T12:00:00Z');
    });

    it('should update updatedAt in local JSON file after successful push', async () => {
      const filePath = path.join(tmpDir, 'test-page.json');
      const originalContent = JSON.stringify({
        id: 99,
        title: 'Test Page',
        type: 'page',
        updatedAt: '2024-01-01T00:00:00Z',
        body: '{}',
      }, null, 2);
      await fs.writeFile(filePath, originalContent, 'utf-8');

      jest.unstable_mockModule('../src/lib/data-service.js', () => ({
        leadCMSDataService: {
          getAllContent: jest.fn(() => Promise.resolve([])),
          getContentTypes: jest.fn(() => Promise.resolve([])),
          isMockMode: jest.fn(() => true),
        },
      }));
      jest.unstable_mockModule('../src/lib/config.js', () => ({
        getConfig: jest.fn(() => ({
          url: 'https://test.leadcms.com',
          apiKey: 'test-key',
          defaultLanguage: 'en',
          contentDir: tmpDir,
          mediaDir: path.join(tmpDir, 'media'),
          emailTemplatesDir: path.join(tmpDir, 'email-templates'),
        })),
      }));

      const { updateLocalMetadata } = await import('../src/scripts/push-leadcms-content.js') as any;

      const localContent = {
        filePath,
        slug: 'test-page',
        locale: 'en',
        type: 'page',
        metadata: { id: 99, title: 'Test Page', type: 'page', updatedAt: '2024-01-01T00:00:00Z' },
        body: '{}',
        isLocal: true,
      };

      const remoteResponse = {
        id: 99,
        slug: 'test-page',
        type: 'page',
        title: 'Test Page',
        updatedAt: '2024-06-15T12:00:00Z',
        createdAt: '2024-01-01T00:00:00Z',
      };

      await updateLocalMetadata(localContent, remoteResponse);

      const updatedFile = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(updatedFile);

      expect(parsed.id).toBe(99);
      expect(parsed.updatedAt).toBe('2024-06-15T12:00:00Z');
    });
  });
});
