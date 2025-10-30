import fs from 'fs/promises';
import path from 'path';

// Test for JSON content type push functionality
// This should reproduce the issue where JSON files are incorrectly formatted for API

describe('Push JSON Content', () => {
  const tmpRoot = path.join(__dirname, 'tmp-json-push-test');
  const contentDir = path.join(tmpRoot, '.leadcms', 'content');

  beforeAll(() => {
    // Mock the config
    process.env.LEADCMS_CONTENT_DIR = contentDir;
    process.env.LEADCMS_DEFAULT_LANGUAGE = 'en';
    process.env.LEADCMS_USE_MOCK = 'true';
  });

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

    // Import the formatContentForAPI function
    const { formatContentForAPI } = await import('../src/lib/content-api-formatting');

    // Parse the file like the push logic would
    const fileContent = await fs.readFile(jsonFilePath, 'utf-8');
    const jsonData = JSON.parse(fileContent);
    const body = jsonData.body || '';
    const metadata = { ...jsonData };
    delete metadata.body;

    const localContentItem = {
      filePath: jsonFilePath,
      slug: 'test-component',
      locale: 'en',
      type: 'component',
      metadata,
      body,
      isLocal: true
    };

    // Format for API
    const apiFormattedContent = formatContentForAPI(localContentItem);

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
    // Create minimal JSON with custom fields to test field preservation
    const customJsonContent = {
      "slug": "custom-test",
      "type": "component",
      "title": "Custom Test",
      "customField": "test-value",
      "body": JSON.stringify({
        "data": { "key": "value" }
      }, null, 2)
    };

    await fs.mkdir(contentDir, { recursive: true });
    const jsonFilePath = path.join(contentDir, 'custom-test.json');
    await fs.writeFile(jsonFilePath, JSON.stringify(customJsonContent, null, 2));

    const { formatContentForAPI } = await import('../src/lib/content-api-formatting');

    // Parse the file
    const fileContent = await fs.readFile(jsonFilePath, 'utf-8');
    const jsonData = JSON.parse(fileContent);
    const body = jsonData.body || '';
    const metadata = { ...jsonData };
    delete metadata.body;

    const localContentItem = {
      filePath: jsonFilePath,
      slug: 'custom-test',
      locale: 'en',
      type: 'component',
      metadata,
      body,
      isLocal: true
    };

    // Format for API
    const apiFormattedContent = formatContentForAPI(localContentItem);

    // Body should be valid JSON and custom fields preserved at top level
    expect(() => JSON.parse(apiFormattedContent.body)).not.toThrow();
    const bodyData = JSON.parse(apiFormattedContent.body);
    expect(bodyData.data.key).toBe('value');
    expect(apiFormattedContent.customField).toBe('test-value');
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

    const { formatContentForAPI } = await import('../src/lib/content-api-formatting');

    // Parse the file
    const fileContent = await fs.readFile(jsonFilePath, 'utf-8');
    const jsonData = JSON.parse(fileContent);
    const body = jsonData.body || '';
    const metadata = { ...jsonData };
    delete metadata.body;

    const localContentItem = {
      filePath: jsonFilePath,
      slug: 'media-test',
      locale: 'en',
      type: 'component',
      metadata,
      body,
      isLocal: true
    };

    // Format for API
    const apiFormattedContent = formatContentForAPI(localContentItem);

    // URLs should be transformed from /media/ to /api/media/
    expect(apiFormattedContent.body).toContain('/api/media/test.jpg');
    expect(apiFormattedContent.body).toContain('/api/media/img1.png');
    expect(apiFormattedContent.body).toContain('/api/media/img2.jpg');

    // Should not contain original /media/ URLs
    expect(apiFormattedContent.body).not.toContain('"/media/');
  });

  describe('Complex JSON Scenarios', () => {
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

      const { formatContentForAPI } = await import('../src/lib/content-api-formatting');

      // Parse the file exactly like the push logic would
      const fileContent = await fs.readFile(jsonFilePath, 'utf-8');
      const jsonData = JSON.parse(fileContent);
      const body = jsonData.body || '';
      const metadata = { ...jsonData };
      delete metadata.body;

      const localContentItem = {
        filePath: jsonFilePath,
        slug: 'test-header',
        locale: 'en',
        type: 'component',
        metadata,
        body,
        isLocal: true
      };

      // Format for API
      const apiFormattedContent = formatContentForAPI(localContentItem);

      // Verify API structure with all fields
      expect(apiFormattedContent.id).toBe(42);
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

      const { formatContentForAPI } = await import('../src/lib/content-api-formatting');

      const fileContent = await fs.readFile(jsonFilePath, 'utf-8');
      const jsonData = JSON.parse(fileContent);
      const body = jsonData.body || '';
      const metadata = { ...jsonData };
      delete metadata.body;

      const localContentItem = {
        filePath: jsonFilePath,
        slug: 'published-test',
        locale: 'en',
        type: 'component',
        metadata,
        body,
        isLocal: true
      };

      const apiFormattedContent = formatContentForAPI(localContentItem);

      // publishedAt should be a top-level field, not in body
      expect(apiFormattedContent.publishedAt).toBe("2025-01-01T00:00:00Z");
      expect(apiFormattedContent.body).toBe(jsonWithPublishedAt.body);
      expect(apiFormattedContent.body).not.toContain('publishedAt:');
    });
  });
});
