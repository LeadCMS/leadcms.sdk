/**
 * Unit tests for LeadCMS pull functionality
 * These tests focus on testing the content fetching and transformation logic
 */

import fs from 'fs';
import path from 'path';

// Mock the data service to provide predictable test data
const mockPullData = {
  contentTypes: [
    { uid: 'article', format: 'MDX', name: 'Article' },
    { uid: 'page', format: 'MDX', name: 'Page' },
    { uid: 'component', format: 'JSON', name: 'Component' }
  ],
  content: [
    {
      id: 1,
      slug: 'test-article',
      type: 'article',
      language: 'en',
      title: 'Test Article',
      body: `---
title: Test Article
coverImageUrl: /api/media/blog/covers/test-article.jpg
featuredImage: /api/media/images/featured.png
---

# Test Article

This is a test article with ![inline image](/api/media/inline/test.jpg) and [download link](/api/media/docs/file.pdf).

<Image src="/api/media/gallery/hero.webp" alt="Hero Image" />`,
      publishedAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z'
    },
    {
      id: 2,
      slug: 'navigation',
      type: 'component',
      language: 'en',
      title: 'Navigation Component',
      body: JSON.stringify({
        slug: 'navigation',
        type: 'component',
        title: 'Navigation Component',
        logo: '/api/media/brand/logo.svg',
        menuItems: [
          {
            label: 'Home',
            url: '/',
            icon: '/api/media/icons/home.svg'
          },
          {
            label: 'About',
            url: '/about',
            backgroundImage: '/api/media/backgrounds/about.jpg'
          }
        ],
        ctaButton: {
          text: 'Get Started',
          backgroundImage: '/api/media/buttons/cta-bg.png'
        }
      }),
      publishedAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z'
    },
    {
      id: 3,
      slug: 'about-us',
      type: 'page',
      language: 'es',
      title: 'Acerca de Nosotros',
      body: `---
title: Acerca de Nosotros
heroImage: /api/media/pages/about/hero-es.jpg
testimonials:
  - name: Juan
    avatar: /api/media/avatars/juan.jpg
    image: /api/media/testimonials/juan-bg.png
  - name: Maria
    avatar: /api/media/avatars/maria.jpg
    image: /api/media/testimonials/maria-bg.png
---

# Acerca de Nosotros

![Company Photo](/api/media/company/team-photo.jpg)

Descarga nuestro [catálogo en PDF](/api/media/downloads/catalogo.pdf).`,
      publishedAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z'
    }
  ]
};

describe('LeadCMS Pull', () => {
  const tmpRoot = path.join(__dirname, 'tmp-pull-test');
  const contentDir = path.join(tmpRoot, 'content');

  beforeAll(() => {
    // Clean up any existing temp directory
    if (fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    // Cleanup
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  });

  describe('Content Fetching and Transformation', () => {
    it('should transform remote content to local MDX format with URL transformation', async () => {
      // Import the transformation function
      const { transformRemoteToLocalFormat } = require('../src/lib/content-transformation');

      const remoteContent = mockPullData.content[0]; // Test article
      const typeMap = { 'article': 'MDX' };

      const result = await transformRemoteToLocalFormat(remoteContent, typeMap);

      // Should be MDX format with frontmatter
      expect(result).toContain('---');
      expect(result).toContain('title: Test Article');

      // URL transformation: /api/media/ should become /media/
      expect(result).toContain('coverImageUrl: /media/blog/covers/test-article.jpg');
      expect(result).toContain('featuredImage: /media/images/featured.png');

      // URLs in body content should also be transformed
      expect(result).toContain('![inline image](/media/inline/test.jpg)');
      expect(result).toContain('[download link](/media/docs/file.pdf)');
      expect(result).toContain('<Image src="/media/gallery/hero.webp"');

      // Should NOT contain original /api/media/ URLs
      expect(result).not.toContain('/api/media/');
    });

    it('should transform remote content to local JSON format with URL transformation', async () => {
      const { transformRemoteToLocalFormat } = require('../src/lib/content-transformation');

      const remoteContent = mockPullData.content[1]; // Navigation component
      const typeMap = { 'component': 'JSON' };

      const result = await transformRemoteToLocalFormat(remoteContent, typeMap);

      const parsed = JSON.parse(result);

      // Should be JSON format
      expect(parsed.slug).toBe('navigation');
      expect(parsed.type).toBe('component');
      expect(parsed.title).toBe('Navigation Component');

      // URL transformation in JSON fields
      expect(parsed.logo).toBe('/media/brand/logo.svg');
      expect(parsed.menuItems[0].icon).toBe('/media/icons/home.svg');
      expect(parsed.menuItems[1].backgroundImage).toBe('/media/backgrounds/about.jpg');
      expect(parsed.ctaButton.backgroundImage).toBe('/media/buttons/cta-bg.png');

      // Should NOT contain original /api/media/ URLs
      expect(result).not.toContain('/api/media/');
    });

    it('should handle multi-language content with URL transformation', async () => {
      const { transformRemoteToLocalFormat } = require('../src/lib/content-transformation');

      const remoteContent = mockPullData.content[2]; // Spanish page
      const typeMap = { 'page': 'MDX' };

      const result = await transformRemoteToLocalFormat(remoteContent, typeMap);

      // Should be MDX format with Spanish content
      expect(result).toContain('title: Acerca de Nosotros');

      // URL transformation in frontmatter arrays/objects
      expect(result).toContain('heroImage: /media/pages/about/hero-es.jpg');
      expect(result).toContain('avatar: /media/avatars/juan.jpg');
      expect(result).toContain('image: /media/testimonials/juan-bg.png');
      expect(result).toContain('avatar: /media/avatars/maria.jpg');
      expect(result).toContain('image: /media/testimonials/maria-bg.png');

      // URL transformation in body content
      expect(result).toContain('![Company Photo](/media/company/team-photo.jpg)');
      expect(result).toContain('[catálogo en PDF](/media/downloads/catalogo.pdf)');

      // Should NOT contain original /api/media/ URLs
      expect(result).not.toContain('/api/media/');
    });

    it('should handle nested URL transformations in complex objects', async () => {
      const { replaceApiMediaPaths } = require('../src/lib/content-transformation');

      const complexObject = {
        hero: {
          backgroundImage: '/api/media/backgrounds/hero.jpg',
          overlayImage: '/api/media/overlays/gradient.png'
        },
        gallery: [
          '/api/media/gallery/image1.jpg',
          '/api/media/gallery/image2.png',
          '/api/media/gallery/image3.webp'
        ],
        sections: [
          {
            title: 'Section 1',
            image: '/api/media/sections/section1.jpg',
            items: [
              { icon: '/api/media/icons/icon1.svg' },
              { icon: '/api/media/icons/icon2.svg' }
            ]
          },
          {
            title: 'Section 2',
            backgroundImage: '/api/media/backgrounds/section2.jpg'
          }
        ],
        regularString: 'This is just text',
        mixedContent: 'Check out this image: /api/media/mixed/example.jpg and this other one: /api/media/mixed/another.png'
      };

      const result = replaceApiMediaPaths(complexObject);

      // Hero section URLs should be transformed
      expect(result.hero.backgroundImage).toBe('/media/backgrounds/hero.jpg');
      expect(result.hero.overlayImage).toBe('/media/overlays/gradient.png');

      // Gallery array URLs should be transformed
      expect(result.gallery).toEqual([
        '/media/gallery/image1.jpg',
        '/media/gallery/image2.png',
        '/media/gallery/image3.webp'
      ]);

      // Nested sections URLs should be transformed
      expect(result.sections[0].image).toBe('/media/sections/section1.jpg');
      expect(result.sections[0].items[0].icon).toBe('/media/icons/icon1.svg');
      expect(result.sections[0].items[1].icon).toBe('/media/icons/icon2.svg');
      expect(result.sections[1].backgroundImage).toBe('/media/backgrounds/section2.jpg');

      // Regular strings should be preserved
      expect(result.regularString).toBe('This is just text');

      // Mixed content strings should have URLs transformed
      expect(result.mixedContent).toBe('Check out this image: /media/mixed/example.jpg and this other one: /media/mixed/another.png');
    });

    it('should preserve non-media URLs during transformation', async () => {
      const { replaceApiMediaPaths } = require('../src/lib/content-transformation');

      const contentWithMixedUrls = {
        mediaImage: '/api/media/images/test.jpg',
        externalUrl: 'https://example.com/api/media/should-not-change.jpg',
        relativeUrl: '/api/content/something',
        hashUrl: '#section',
        mailtoUrl: 'mailto:test@example.com',
        telUrl: 'tel:+1234567890',
        apiEndpoint: '/api/users/123',
        description: 'Visit https://example.com/api/media/external.jpg for external media, or check /api/media/local.jpg for local media'
      };

      const result = replaceApiMediaPaths(contentWithMixedUrls);

      // Only /api/media/ URLs should be transformed to /media/
      expect(result.mediaImage).toBe('/media/images/test.jpg');

      // Other URLs should remain unchanged
      expect(result.externalUrl).toBe('https://example.com/api/media/should-not-change.jpg');
      expect(result.relativeUrl).toBe('/api/content/something');
      expect(result.hashUrl).toBe('#section');
      expect(result.mailtoUrl).toBe('mailto:test@example.com');
      expect(result.telUrl).toBe('tel:+1234567890');
      expect(result.apiEndpoint).toBe('/api/users/123');

      // In strings, only /api/media/ should be transformed
      expect(result.description).toBe('Visit https://example.com/api/media/external.jpg for external media, or check /media/local.jpg for local media');
    });
  });

  describe('Content File Saving', () => {
    it('should save MDX content files with correct directory structure', async () => {
      const { saveContentFile } = require('../src/lib/content-transformation');

      // Mock the config
      process.env.LEADCMS_DEFAULT_LANGUAGE = 'en';

      const content = mockPullData.content[0];
      const typeMap = { 'article': 'MDX' };

      const filePath = await saveContentFile({
        content,
        typeMap,
        contentDir
      });

      expect(filePath).toBe(path.join(contentDir, 'test-article.mdx'));
      expect(fs.existsSync(filePath!)).toBe(true);

      const fileContent = fs.readFileSync(filePath!, 'utf-8');
      expect(fileContent).toContain('title: Test Article');
      expect(fileContent).toContain('/media/blog/covers/test-article.jpg');
      expect(fileContent).not.toContain('/api/media/');
    });

    it('should save JSON content files with correct directory structure', async () => {
      const { saveContentFile } = require('../src/lib/content-transformation');

      // Mock the config
      process.env.LEADCMS_DEFAULT_LANGUAGE = 'en';

      const content = mockPullData.content[1];
      const typeMap = { 'component': 'JSON' };

      const filePath = await saveContentFile({
        content,
        typeMap,
        contentDir
      });

      expect(filePath).toBe(path.join(contentDir, 'navigation.json'));
      expect(fs.existsSync(filePath!)).toBe(true);

      const fileContent = fs.readFileSync(filePath!, 'utf-8');
      const parsed = JSON.parse(fileContent);
      expect(parsed.logo).toBe('/media/brand/logo.svg');
      expect(fileContent).not.toContain('/api/media/');
    });

    it('should save multi-language content in language-specific directories', async () => {
      const { saveContentFile } = require('../src/lib/content-transformation');

      // Mock the config
      process.env.LEADCMS_DEFAULT_LANGUAGE = 'en';

      const content = mockPullData.content[2]; // Spanish content
      const typeMap = { 'page': 'MDX' };

      const filePath = await saveContentFile({
        content,
        typeMap,
        contentDir
      });

      expect(filePath).toBe(path.join(contentDir, 'es', 'about-us.mdx'));
      expect(fs.existsSync(filePath!)).toBe(true);

      const fileContent = fs.readFileSync(filePath!, 'utf-8');
      expect(fileContent).toContain('title: Acerca de Nosotros');
      expect(fileContent).toContain('/media/pages/about/hero-es.jpg');
      expect(fileContent).not.toContain('/api/media/');
    });

    it('should handle draft content with preview slugs', async () => {
      const { saveContentFile } = require('../src/lib/content-transformation');

      // Mock the config
      process.env.LEADCMS_DEFAULT_LANGUAGE = 'en';

      const content = { ...mockPullData.content[0] };
      const typeMap = { 'article': 'MDX' };

      const filePath = await saveContentFile({
        content,
        typeMap,
        contentDir,
        previewSlug: 'draft-preview-article'
      });

      expect(filePath).toBe(path.join(contentDir, 'draft-preview-article.mdx'));
      expect(fs.existsSync(filePath!)).toBe(true);

      const fileContent = fs.readFileSync(filePath!, 'utf-8');
      expect(fileContent).toContain('draft: true');
      expect(fileContent).toContain('/media/blog/covers/test-article.jpg');
      expect(fileContent).not.toContain('/api/media/');
    });
  });

  describe('Content Comparison for Updates', () => {
    it('should transform remote content for accurate comparison with local files', async () => {
      const { transformRemoteForComparison } = require('../src/lib/content-transformation');

      // Create a mock local file content that has only some fields
      const localContent = `---
title: Test Article
coverImageUrl: /media/blog/covers/test-article.jpg
publishedAt: '2024-01-01T00:00:00Z'
---

# Test Article

This is the content with ![image](/media/inline/test.jpg).`;

      const remoteContent = {
        ...mockPullData.content[0],
        // Remote might have additional fields that local doesn't have
        extraField: 'should not appear',
        anotherField: 'also should not appear'
      };

      const typeMap = { 'article': 'MDX' };

      const result = await transformRemoteForComparison(remoteContent, localContent, typeMap);

      // Should only include fields that exist in local content
      expect(result).toContain('title: Test Article');
      expect(result).toContain('coverImageUrl: /media/blog/covers/test-article.jpg');
      expect(result).toContain('publishedAt: \'2024-01-01T00:00:00Z\'');

      // Should NOT include extra fields that don't exist in local
      expect(result).not.toContain('extraField');
      expect(result).not.toContain('anotherField');

      // URLs should still be transformed
      expect(result).toContain('/media/inline/test.jpg');
      expect(result).not.toContain('/api/media/');
    });

    it('should handle content normalization for comparison', async () => {
      const { normalizeContentForComparison, hasContentDifferences } = require('../src/lib/content-transformation');

      const content1 = `---
title: Test
---

# Content

Some text.


Another paragraph.`;

      const content2 = `---
title: Test
---

# Content

Some text.

Another paragraph.`;

      const normalized1 = normalizeContentForComparison(content1);
      const normalized2 = normalizeContentForComparison(content2);

      // Should normalize whitespace differences
      expect(hasContentDifferences(content1, content2)).toBe(false);
      expect(normalized1).toBe(normalized2);
    });

    it('should detect actual content differences after normalization', async () => {
      const { hasContentDifferences } = require('../src/lib/content-transformation');

      const content1 = `---
title: Test Article
---

# Original Content

This is the original content.`;

      const content2 = `---
title: Test Article
---

# Updated Content

This is the updated content.`;

      // Should detect real differences
      expect(hasContentDifferences(content1, content2)).toBe(true);
    });
  });
});
