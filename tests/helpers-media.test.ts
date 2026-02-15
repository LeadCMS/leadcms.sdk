/**
 * Tests for leadcms-helpers.ts - extractMediaUrlsFromContent
 */

import { jest } from '@jest/globals';
import { createTestConfig } from './test-helpers';

jest.mock('../src/lib/config.js', () => ({
  getConfig: jest.fn(() => createTestConfig()),
}));

import { extractMediaUrlsFromContent } from '../src/scripts/leadcms-helpers';

describe('extractMediaUrlsFromContent', () => {
  it('should extract media URLs from body content', () => {
    const content = {
      slug: 'test-article',
      type: 'article',
      body: 'Check out this image: "/api/media/images/photo.jpg" and this "/api/media/docs/file.pdf"',
    };

    const urls = extractMediaUrlsFromContent(content as any);
    expect(urls).toHaveLength(2);
    expect(urls).toContain('/api/media/images/photo.jpg');
    expect(urls).toContain('/api/media/docs/file.pdf');
  });

  it('should extract media URLs from single-quoted strings', () => {
    const content = {
      slug: 'test',
      type: 'article',
      body: "Some text '/api/media/images/photo.jpg' more text",
    };

    const urls = extractMediaUrlsFromContent(content as any);
    expect(urls).toHaveLength(1);
    expect(urls).toContain('/api/media/images/photo.jpg');
  });

  it('should extract media URLs from markdown image syntax', () => {
    const content = {
      slug: 'test',
      type: 'article',
      body: '![Alt text](/api/media/images/photo.jpg)',
    };

    const urls = extractMediaUrlsFromContent(content as any);
    expect(urls).toHaveLength(1);
    expect(urls).toContain('/api/media/images/photo.jpg');
  });

  it('should extract coverImageUrl', () => {
    const content = {
      slug: 'test',
      type: 'article',
      body: '',
      coverImageUrl: '/api/media/covers/article-cover.jpg',
    };

    const urls = extractMediaUrlsFromContent(content as any);
    expect(urls).toHaveLength(1);
    expect(urls).toContain('/api/media/covers/article-cover.jpg');
  });

  it('should not include coverImageUrl that does not start with /api/media/', () => {
    const content = {
      slug: 'test',
      type: 'article',
      body: '',
      coverImageUrl: 'https://external.com/image.jpg',
    };

    const urls = extractMediaUrlsFromContent(content as any);
    expect(urls).toHaveLength(0);
  });

  it('should deduplicate URLs', () => {
    const content = {
      slug: 'test',
      type: 'article',
      body: '"/api/media/images/photo.jpg" and again "/api/media/images/photo.jpg"',
      coverImageUrl: '/api/media/images/photo.jpg',
    };

    const urls = extractMediaUrlsFromContent(content as any);
    expect(urls).toHaveLength(1);
  });

  it('should return empty array when no media URLs found', () => {
    const content = {
      slug: 'test',
      type: 'article',
      body: 'Regular content with no media references',
    };

    const urls = extractMediaUrlsFromContent(content as any);
    expect(urls).toHaveLength(0);
  });

  it('should handle empty body', () => {
    const content = {
      slug: 'test',
      type: 'article',
      body: '',
    };

    const urls = extractMediaUrlsFromContent(content as any);
    expect(urls).toHaveLength(0);
  });

  it('should handle undefined body', () => {
    const content = {
      slug: 'test',
      type: 'article',
    };

    const urls = extractMediaUrlsFromContent(content as any);
    expect(urls).toHaveLength(0);
  });

  it('should extract multiple different media URLs from body and coverImageUrl', () => {
    const content = {
      slug: 'test',
      type: 'article',
      body: 'Image: "/api/media/images/body-image.png"',
      coverImageUrl: '/api/media/covers/cover.jpg',
    };

    const urls = extractMediaUrlsFromContent(content as any);
    expect(urls).toHaveLength(2);
    expect(urls).toContain('/api/media/images/body-image.png');
    expect(urls).toContain('/api/media/covers/cover.jpg');
  });

  it('should not match non-media API URLs', () => {
    const content = {
      slug: 'test',
      type: 'article',
      body: 'Check "/api/content/articles" and "/api/users/me"',
    };

    const urls = extractMediaUrlsFromContent(content as any);
    expect(urls).toHaveLength(0);
  });
});
