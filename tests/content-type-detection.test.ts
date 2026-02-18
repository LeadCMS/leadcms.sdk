/**
 * Tests for auto-detection of content type parameters from local content files.
 * Covers: analyzeContentTypeFromFiles, isYes, normalizeFormat
 */

import { jest } from '@jest/globals';
import { createTestConfig, createDataServiceMock } from './test-helpers';

jest.mock('../src/lib/config.js', () => ({
  getConfig: jest.fn(() => createTestConfig()),
}));

jest.mock('../src/lib/data-service.js', () => ({
  leadCMSDataService: createDataServiceMock(),
}));

import {
  analyzeContentTypeFromFiles,
  isYes,
  normalizeFormat,
  type LocalContentItem,
} from '../src/scripts/push-leadcms-content';

// Helper to create a minimal LocalContentItem for testing
function makeLocalItem(overrides: Partial<LocalContentItem> & { filePath: string; type: string }): LocalContentItem {
  return {
    slug: overrides.slug ?? 'test-slug',
    locale: overrides.locale ?? 'en',
    metadata: overrides.metadata ?? {},
    body: overrides.body ?? '',
    isLocal: true,
    filePath: overrides.filePath,
    type: overrides.type,
  };
}

describe('Content Type Auto-Detection', () => {
  describe('analyzeContentTypeFromFiles', () => {
    describe('format detection', () => {
      it('should detect JSON format when all files are .json', () => {
        const items = [
          makeLocalItem({ filePath: '/content/header.json', type: 'component', metadata: {} }),
          makeLocalItem({ filePath: '/content/footer.json', type: 'component', metadata: {} }),
        ];

        const result = analyzeContentTypeFromFiles(items, 'component');
        expect(result.format).toBe('JSON');
      });

      it('should detect MDX format when all files are .mdx', () => {
        const items = [
          makeLocalItem({ filePath: '/content/blog/post-1.mdx', type: 'blog-post', metadata: {} }),
          makeLocalItem({ filePath: '/content/blog/post-2.mdx', type: 'blog-post', metadata: {} }),
        ];

        const result = analyzeContentTypeFromFiles(items, 'blog-post');
        expect(result.format).toBe('MDX');
      });

      it('should default to MDX when files are mixed (.json and .mdx)', () => {
        const items = [
          makeLocalItem({ filePath: '/content/thing.json', type: 'mixed', metadata: {} }),
          makeLocalItem({ filePath: '/content/thing2.mdx', type: 'mixed', metadata: {} }),
        ];

        const result = analyzeContentTypeFromFiles(items, 'mixed');
        expect(result.format).toBe('MDX');
      });

      it('should only consider files of the specified type', () => {
        const items = [
          makeLocalItem({ filePath: '/content/header.json', type: 'component', metadata: {} }),
          makeLocalItem({ filePath: '/content/post.mdx', type: 'blog-post', metadata: {} }),
        ];

        const componentResult = analyzeContentTypeFromFiles(items, 'component');
        expect(componentResult.format).toBe('JSON');

        const blogResult = analyzeContentTypeFromFiles(items, 'blog-post');
        expect(blogResult.format).toBe('MDX');
      });

      it('should default to MDX when no files match the type', () => {
        const items = [
          makeLocalItem({ filePath: '/content/post.mdx', type: 'blog-post', metadata: {} }),
        ];

        const result = analyzeContentTypeFromFiles(items, 'nonexistent');
        expect(result.format).toBe('MDX');
      });
    });

    describe('cover image detection', () => {
      it('should detect cover image support when coverImageUrl has a value', () => {
        const items = [
          makeLocalItem({
            filePath: '/content/post-1.mdx',
            type: 'blog-post',
            metadata: { coverImageUrl: '/media/cover.jpg' },
          }),
          makeLocalItem({
            filePath: '/content/post-2.mdx',
            type: 'blog-post',
            metadata: { coverImageUrl: '' },
          }),
        ];

        const result = analyzeContentTypeFromFiles(items, 'blog-post');
        expect(result.supportsCoverImage).toBe(true);
      });

      it('should not detect cover image support when all coverImageUrl values are empty', () => {
        const items = [
          makeLocalItem({
            filePath: '/content/header.json',
            type: 'component',
            metadata: { coverImageUrl: '' },
          }),
          makeLocalItem({
            filePath: '/content/footer.json',
            type: 'component',
            metadata: { coverImageUrl: '' },
          }),
        ];

        const result = analyzeContentTypeFromFiles(items, 'component');
        expect(result.supportsCoverImage).toBe(false);
      });

      it('should not detect cover image support when coverImageUrl is missing', () => {
        const items = [
          makeLocalItem({
            filePath: '/content/header.json',
            type: 'component',
            metadata: { title: 'Header' },
          }),
        ];

        const result = analyzeContentTypeFromFiles(items, 'component');
        expect(result.supportsCoverImage).toBe(false);
      });

      it('should not detect cover image support when coverImageUrl is whitespace only', () => {
        const items = [
          makeLocalItem({
            filePath: '/content/header.json',
            type: 'component',
            metadata: { coverImageUrl: '   ' },
          }),
        ];

        const result = analyzeContentTypeFromFiles(items, 'component');
        expect(result.supportsCoverImage).toBe(false);
      });

      it('should detect cover image support if at least one file has it', () => {
        const items = [
          makeLocalItem({
            filePath: '/content/post-1.mdx',
            type: 'article',
            metadata: { coverImageUrl: '' },
          }),
          makeLocalItem({
            filePath: '/content/post-2.mdx',
            type: 'article',
            metadata: { coverImageUrl: '' },
          }),
          makeLocalItem({
            filePath: '/content/post-3.mdx',
            type: 'article',
            metadata: { coverImageUrl: '/media/post3-cover.png' },
          }),
        ];

        const result = analyzeContentTypeFromFiles(items, 'article');
        expect(result.supportsCoverImage).toBe(true);
      });
    });

    describe('comments detection', () => {
      it('should default to false for JSON format regardless of allowComments', () => {
        const items = [
          makeLocalItem({
            filePath: '/content/widget.json',
            type: 'component',
            metadata: { allowComments: true },
          }),
        ];

        const result = analyzeContentTypeFromFiles(items, 'component');
        expect(result.format).toBe('JSON');
        expect(result.supportsComments).toBe(false);
      });

      it('should detect comments support for MDX when allowComments is true', () => {
        const items = [
          makeLocalItem({
            filePath: '/content/post-1.mdx',
            type: 'blog-post',
            metadata: { allowComments: true },
          }),
          makeLocalItem({
            filePath: '/content/post-2.mdx',
            type: 'blog-post',
            metadata: { allowComments: false },
          }),
        ];

        const result = analyzeContentTypeFromFiles(items, 'blog-post');
        expect(result.format).toBe('MDX');
        expect(result.supportsComments).toBe(true);
      });

      it('should not detect comments support for MDX when allowComments is never true', () => {
        const items = [
          makeLocalItem({
            filePath: '/content/post-1.mdx',
            type: 'blog-post',
            metadata: { allowComments: false },
          }),
          makeLocalItem({
            filePath: '/content/post-2.mdx',
            type: 'blog-post',
            metadata: {},
          }),
        ];

        const result = analyzeContentTypeFromFiles(items, 'blog-post');
        expect(result.supportsComments).toBe(false);
      });

      it('should not detect comments support when allowComments is missing', () => {
        const items = [
          makeLocalItem({
            filePath: '/content/page.mdx',
            type: 'page',
            metadata: { title: 'About' },
          }),
        ];

        const result = analyzeContentTypeFromFiles(items, 'page');
        expect(result.supportsComments).toBe(false);
      });
    });

    describe('real-world scenarios', () => {
      it('should handle a JSON component type like footer configuration', () => {
        const items = [
          makeLocalItem({
            filePath: '/content/footer.json',
            type: 'component',
            metadata: {
              id: 2,
              title: 'Site Footer Configuration',
              description: 'Footer component configuration.',
              coverImageUrl: '',
              coverImageAlt: '',
              slug: 'footer',
              type: 'component',
              author: 'Peter L.',
              language: 'en',
              allowComments: false,
            },
          }),
          makeLocalItem({
            filePath: '/content/header.json',
            type: 'component',
            metadata: {
              id: 1,
              title: 'Site Header Configuration',
              coverImageUrl: '',
              type: 'component',
              allowComments: false,
            },
          }),
        ];

        const result = analyzeContentTypeFromFiles(items, 'component');
        expect(result.format).toBe('JSON');
        expect(result.supportsCoverImage).toBe(false);
        expect(result.supportsComments).toBe(false);
      });

      it('should handle an MDX blog-post type with cover images and comments', () => {
        const items = [
          makeLocalItem({
            filePath: '/content/blog/getting-started.mdx',
            type: 'blog-post',
            metadata: {
              title: 'Getting Started',
              coverImageUrl: '/media/blog/getting-started.jpg',
              allowComments: true,
            },
          }),
          makeLocalItem({
            filePath: '/content/blog/advanced-tips.mdx',
            type: 'blog-post',
            metadata: {
              title: 'Advanced Tips',
              coverImageUrl: '/media/blog/advanced.jpg',
              allowComments: true,
            },
          }),
        ];

        const result = analyzeContentTypeFromFiles(items, 'blog-post');
        expect(result.format).toBe('MDX');
        expect(result.supportsCoverImage).toBe(true);
        expect(result.supportsComments).toBe(true);
      });

      it('should handle MDX pages without comments or cover images', () => {
        const items = [
          makeLocalItem({
            filePath: '/content/about.mdx',
            type: 'page',
            metadata: {
              title: 'About Us',
              coverImageUrl: '',
              allowComments: false,
            },
          }),
          makeLocalItem({
            filePath: '/content/contact.mdx',
            type: 'page',
            metadata: {
              title: 'Contact',
            },
          }),
        ];

        const result = analyzeContentTypeFromFiles(items, 'page');
        expect(result.format).toBe('MDX');
        expect(result.supportsCoverImage).toBe(false);
        expect(result.supportsComments).toBe(false);
      });
    });
  });

  describe('isYes', () => {
    it('should accept "y"', () => {
      expect(isYes('y')).toBe(true);
    });

    it('should accept "Y"', () => {
      expect(isYes('Y')).toBe(true);
    });

    it('should accept "yes"', () => {
      expect(isYes('yes')).toBe(true);
    });

    it('should accept "Yes"', () => {
      expect(isYes('Yes')).toBe(true);
    });

    it('should accept "YES"', () => {
      expect(isYes('YES')).toBe(true);
    });

    it('should handle whitespace around input', () => {
      expect(isYes('  y  ')).toBe(true);
      expect(isYes(' yes ')).toBe(true);
    });

    it('should reject "n"', () => {
      expect(isYes('n')).toBe(false);
    });

    it('should reject "no"', () => {
      expect(isYes('no')).toBe(false);
    });

    it('should reject empty string', () => {
      expect(isYes('')).toBe(false);
    });

    it('should reject arbitrary text', () => {
      expect(isYes('maybe')).toBe(false);
      expect(isYes('yep')).toBe(false);
    });
  });

  describe('normalizeFormat', () => {
    it('should normalize "json" to "JSON"', () => {
      expect(normalizeFormat('json')).toBe('JSON');
    });

    it('should normalize "Json" to "JSON"', () => {
      expect(normalizeFormat('Json')).toBe('JSON');
    });

    it('should normalize "JSON" to "JSON"', () => {
      expect(normalizeFormat('JSON')).toBe('JSON');
    });

    it('should normalize "mdx" to "MDX"', () => {
      expect(normalizeFormat('mdx')).toBe('MDX');
    });

    it('should normalize "Mdx" to "MDX"', () => {
      expect(normalizeFormat('Mdx')).toBe('MDX');
    });

    it('should normalize "MDX" to "MDX"', () => {
      expect(normalizeFormat('MDX')).toBe('MDX');
    });

    it('should use fallback for empty string', () => {
      expect(normalizeFormat('')).toBe('MDX');
      expect(normalizeFormat('', 'JSON')).toBe('JSON');
    });

    it('should handle whitespace around input', () => {
      expect(normalizeFormat('  json  ')).toBe('JSON');
      expect(normalizeFormat(' mdx ')).toBe('MDX');
    });

    it('should use fallback for invalid input', () => {
      expect(normalizeFormat('yaml')).toBe('MDX');
      expect(normalizeFormat('yaml', 'JSON')).toBe('JSON');
    });
  });
});
