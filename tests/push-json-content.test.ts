import fs from 'fs/promises';
import path from 'path';
import { jest } from '@jest/globals';
import { createTestConfig, createDataServiceMock } from './test-helpers';

const tmpRoot = path.join(__dirname, 'tmp-json-push-test');
const contentDir = path.join(tmpRoot, '.leadcms', 'content');

jest.mock('../src/lib/config.js', () => ({
  getConfig: jest.fn(() => createTestConfig({ contentDir })),
}));

jest.mock('../src/lib/data-service.js', () => ({
  leadCMSDataService: createDataServiceMock(),
}));

import { parseContentFile, formatContentForAPI } from '../src/scripts/push-leadcms-content';

describe('Push JSON Content', () => {

  afterAll(async () => {
    // Cleanup
    try {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  });

  beforeEach(async () => {
    // Clean up before each test
    try {
      await fs.rm(tmpRoot, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  });

  it('should format JSON content correctly for API', async () => {
    // Create minimal JSON content with basic required fields
    const jsonContent = {
      "slug": "test-component",
      "type": "component",
      "title": "Test Component",
      "source": "test-source",
      "body": JSON.stringify({
        "componentData": {
          "setting": "value"
        }
      }, null, 2)
    };

    // Create the local JSON file
    await fs.mkdir(contentDir, { recursive: true });
    const jsonFilePath = path.join(contentDir, 'test-component.json');
    await fs.writeFile(jsonFilePath, JSON.stringify(jsonContent, null, 2));

    const parsed = await parseContentFile(jsonFilePath, 'en', contentDir);
    expect(parsed).not.toBeNull();
    const apiFormattedContent = formatContentForAPI(parsed!);

    // Test the expected behavior: body should contain JSON string, not MDX frontmatter
    expect(apiFormattedContent.body).toBe(jsonContent.body);
    expect(apiFormattedContent.slug).toBe('test-component');
    expect(apiFormattedContent.type).toBe('component');
    expect(apiFormattedContent.language).toBe('en');
    expect(apiFormattedContent.title).toBe('Test Component');
    expect(apiFormattedContent.source).toBe('test-source');

    // The body should NOT contain frontmatter syntax for JSON files
    expect(apiFormattedContent.body).not.toContain('---');
    expect(apiFormattedContent.body).not.toContain('source:');

    // The body should be valid JSON
    expect(() => JSON.parse(apiFormattedContent.body)).not.toThrow();
  });

  it('should handle JSON files with custom fields correctly', async () => {
    // Create JSON with custom fields like the real-world footer example
    // Note: body field in JSON is for storing additional data, not the content body
    // Custom fields like footerData should be serialized into the API body
    const footerJsonContent = {
      "slug": "footer-test",
      "type": "component",
      "title": "Footer Test",
      "author": "Test Author",
      "category": "Component",
      "footerData": {
        "logo": { "src": "/images/logo.png", "alt": "Logo" },
        "copyright": { "text": "© 2025 Test", "showYear": true },
        "navigation": [{ "label": "Terms", "href": "/terms" }]
      }
    };

    await fs.mkdir(contentDir, { recursive: true });
    const jsonFilePath = path.join(contentDir, 'footer-test.json');
    await fs.writeFile(jsonFilePath, JSON.stringify(footerJsonContent, null, 2));

    const parsed = await parseContentFile(jsonFilePath, 'en', contentDir);
    expect(parsed).not.toBeNull();
    const apiFormattedContent = formatContentForAPI(parsed!);

    // CRITICAL: Custom fields like footerData should NOT be at root level
    // They should be serialized in the body as JSON string
    expect(apiFormattedContent).not.toHaveProperty('footerData');

    // Standard fields should be at root level
    expect(apiFormattedContent.title).toBe('Footer Test');
    expect(apiFormattedContent.author).toBe('Test Author');
    expect(apiFormattedContent.category).toBe('Component');

    // Body should contain ALL custom fields serialized as JSON string
    expect(apiFormattedContent.body).toBeTruthy();
    expect(apiFormattedContent.body).not.toBe('');
    expect(() => JSON.parse(apiFormattedContent.body)).not.toThrow();

    // Body should contain the footerData custom field (and ONLY custom fields)
    const bodyData = JSON.parse(apiFormattedContent.body);
    expect(bodyData.footerData).toBeDefined();
    expect(bodyData.footerData.logo.src).toBe('/images/logo.png');
    expect(bodyData.footerData.copyright.text).toBe('© 2025 Test');
    expect(bodyData.footerData.navigation).toHaveLength(1);

    // Body should NOT contain standard fields
    expect(bodyData.title).toBeUndefined();
    expect(bodyData.slug).toBeUndefined();
    expect(bodyData.type).toBeUndefined();
  });

  it('should handle media URL transformation in JSON body content', async () => {
    // Test /media/ to /api/media/ URL transformation
    const jsonWithMedia = {
      "slug": "media-test",
      "type": "component",
      "title": "Media Test",
      "body": JSON.stringify({
        "image": "/media/test.jpg",
        "images": ["/media/img1.png", "/media/img2.jpg"]
      }, null, 2)
    };

    await fs.mkdir(contentDir, { recursive: true });
    const jsonFilePath = path.join(contentDir, 'media-test.json');
    await fs.writeFile(jsonFilePath, JSON.stringify(jsonWithMedia, null, 2));

    const parsed = await parseContentFile(jsonFilePath, 'en', contentDir);
    expect(parsed).not.toBeNull();
    const apiFormattedContent = formatContentForAPI(parsed!);

    // URLs should be transformed from /media/ to /api/media/
    expect(apiFormattedContent.body).toContain('/api/media/test.jpg');
    expect(apiFormattedContent.body).toContain('/api/media/img1.png');
    expect(apiFormattedContent.body).toContain('/api/media/img2.jpg');

    // Should not contain original /media/ URLs
    expect(apiFormattedContent.body).not.toContain('"/media/');
  });

  describe('Complex JSON Scenarios', () => {
    it('should reproduce the real-world footer bug with custom fields in wrong location', async () => {
      // Reproduce the exact scenario from the user's bug report
      const footerJsonContent = {
        "id": 19,
        "slug": "footer",
        "type": "component",
        "language": "ru",
        "title": "Footer Configuration",
        "description": "Footer configuration including logo, copyright and navigation links.",
        "author": "Test Author",
        "category": "Component",
        "source": "Translated from 0",
        "publishedAt": "2025-08-31T00:00:00Z",
        "footerData": {
          "logo": {
            "src": "/images/icon-192x192.png",
            "alt": "LeadCMS Logo"
          },
          "copyright": {
            "text": "© {year} LeadCMS. All rights reserved.",
            "showYear": true
          },
          "navigation": [
            { "label": "Terms", "href": "/legal/terms" },
            { "label": "Privacy", "href": "/legal/privacy" }
          ]
        },
        "body": ""
      };

      await fs.mkdir(path.join(contentDir, 'ru'), { recursive: true });
      const jsonFilePath = path.join(contentDir, 'ru', 'footer.json');
      await fs.writeFile(jsonFilePath, JSON.stringify(footerJsonContent, null, 2));

      const parsed = await parseContentFile(jsonFilePath, 'ru', path.join(contentDir, 'ru'));
      expect(parsed).not.toBeNull();
      const apiFormattedContent = formatContentForAPI(parsed!);

      // FIXED: footerData should NOT appear at root level
      expect(apiFormattedContent).not.toHaveProperty('footerData');

      // CORRECT: Body should contain custom fields serialized as JSON
      expect(apiFormattedContent.body).toBeTruthy();
      expect(() => JSON.parse(apiFormattedContent.body)).not.toThrow();

      // Body should contain the footerData custom field
      const bodyData = JSON.parse(apiFormattedContent.body);
      expect(bodyData.footerData).toBeDefined();
      expect(bodyData.footerData.logo.src).toBe('/images/icon-192x192.png');
      expect(bodyData.footerData.copyright.showYear).toBe(true);

      // CORRECT: Only standard API fields should be at root level
      // Note: id, createdAt, updatedAt are removed (read-only, managed by API)
      expect(apiFormattedContent.id).toBeUndefined();
      expect(apiFormattedContent.createdAt).toBeUndefined();
      expect(apiFormattedContent.updatedAt).toBeUndefined();
      expect(apiFormattedContent.slug).toBe('footer');
      expect(apiFormattedContent.type).toBe('component');
      expect(apiFormattedContent.language).toBe('ru');
      expect(apiFormattedContent.title).toBe('Footer Configuration');
      expect(apiFormattedContent.publishedAt).toBe('2025-08-31T00:00:00Z');
    });

    it('should format complex JSON component with all API fields correctly', async () => {
      // Test complex JSON with all API fields (mimics real-world usage)
      const complexJsonContent = {
        "id": 42,
        "slug": "test-header",
        "type": "component",
        "title": "Test Header",
        "description": "Test component description",
        "author": "Test Author",
        "language": "en",
        "translationKey": "12345678-1234-1234-1234-123456789abc",
        "category": "Component",
        "source": "test-source",
        "publishedAt": null,
        "body": JSON.stringify({
          "config": {
            "title": "Test Title",
            "navigation": [
              { "label": "Home", "href": "/" },
              { "label": "About", "href": "/about" }
            ]
          }
        }, null, 2)
      };

      // Create the local JSON file
      await fs.mkdir(contentDir, { recursive: true });
      const jsonFilePath = path.join(contentDir, 'test-header.json');
      await fs.writeFile(jsonFilePath, JSON.stringify(complexJsonContent, null, 2));

      const parsed = await parseContentFile(jsonFilePath, 'en', contentDir);
      expect(parsed).not.toBeNull();
      const apiFormattedContent = formatContentForAPI(parsed!);

      // Verify API structure with all fields
      // Note: id, createdAt, updatedAt are removed (read-only, managed by API)
      expect(apiFormattedContent.id).toBeUndefined();
      expect(apiFormattedContent.createdAt).toBeUndefined();
      expect(apiFormattedContent.updatedAt).toBeUndefined();
      expect(apiFormattedContent.slug).toBe('test-header');
      expect(apiFormattedContent.type).toBe('component');
      expect(apiFormattedContent.language).toBe('en');
      expect(apiFormattedContent.title).toBe('Test Header');
      expect(apiFormattedContent.description).toBe('Test component description');
      expect(apiFormattedContent.author).toBe('Test Author');
      expect(apiFormattedContent.translationKey).toBe('12345678-1234-1234-1234-123456789abc');
      expect(apiFormattedContent.category).toBe('Component');
      expect(apiFormattedContent.source).toBe('test-source');
      expect(apiFormattedContent.publishedAt).toBe(null);

      // Body should be pure JSON, not MDX with frontmatter
      expect(apiFormattedContent.body).toBe(complexJsonContent.body);

      // Verify body is valid JSON with correct structure
      const parsedBody = JSON.parse(apiFormattedContent.body);
      expect(parsedBody.config.title).toBe('Test Title');
      expect(parsedBody.config.navigation[0].label).toBe('Home');
      expect(parsedBody.config.navigation[1].href).toBe('/about');

      // Verify NO frontmatter syntax in body
      expect(apiFormattedContent.body).not.toContain('---');
      expect(apiFormattedContent.body).not.toContain('source:');

      // Verify no local-only fields remain
      expect(apiFormattedContent).not.toHaveProperty('filePath');
      expect(apiFormattedContent).not.toHaveProperty('isLocal');
      expect(apiFormattedContent).not.toHaveProperty('locale');
    });

    it('should handle publishedAt field changes correctly', async () => {
      // Test that publishedAt changes are handled as metadata, not in body
      const jsonWithPublishedAt = {
        "slug": "published-test",
        "type": "component",
        "title": "Published Test",
        "publishedAt": "2025-01-01T00:00:00Z",
        "body": JSON.stringify({ "content": "test" }, null, 2)
      };

      await fs.mkdir(contentDir, { recursive: true });
      const jsonFilePath = path.join(contentDir, 'published-test.json');
      await fs.writeFile(jsonFilePath, JSON.stringify(jsonWithPublishedAt, null, 2));

      const parsed = await parseContentFile(jsonFilePath, 'en', contentDir);
      expect(parsed).not.toBeNull();
      const apiFormattedContent = formatContentForAPI(parsed!);

      // publishedAt should be a top-level field, not in body
      expect(apiFormattedContent.publishedAt).toBe("2025-01-01T00:00:00Z");
      expect(apiFormattedContent.body).toBe(jsonWithPublishedAt.body);
      expect(apiFormattedContent.body).not.toContain('publishedAt:');
    });
  });
});
