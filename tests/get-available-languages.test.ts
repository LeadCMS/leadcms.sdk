import fs from 'fs';
import path from 'path';

// Test file specifically for getAvailableLanguages function
// This reproduces the issue where only default language is returned

describe('getAvailableLanguages - Issue Reproduction and Fix', () => {
  const tmpRoot = path.join(__dirname, 'tmp-content-languages');
  const contentDir = path.join(tmpRoot, '.leadcms', 'content');

  beforeAll(() => {
    // Ensure clean state
    if (fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }

    // Create directory structure with various locale formats
    fs.mkdirSync(path.join(contentDir, 'si'), { recursive: true });
    fs.mkdirSync(path.join(contentDir, 'ru'), { recursive: true });
    fs.mkdirSync(path.join(contentDir, 'de'), { recursive: true });
    fs.mkdirSync(path.join(contentDir, 'en-US'), { recursive: true });
    fs.mkdirSync(path.join(contentDir, 'fr-CA'), { recursive: true });
    fs.mkdirSync(path.join(contentDir, 'zh-CN'), { recursive: true });
    fs.mkdirSync(path.join(contentDir, 'notlocale'), { recursive: true }); // Not a locale
    fs.mkdirSync(path.join(contentDir, 'toolongname'), { recursive: true }); // Not a locale

    // Create some content files to make directories valid
    const publishedDate = '2024-01-01T00:00:00Z';

    // Default language content (en) - in root directory
    fs.writeFileSync(path.join(contentDir, 'home.mdx'), `---\nslug: home\ntype: page\npublishedAt: ${publishedDate}\n---\nHome`);

    // Various locale formats with content
    fs.writeFileSync(path.join(contentDir, 'si', 'home.mdx'), `---\nslug: home\ntype: page\npublishedAt: ${publishedDate}\n---\nHome`);
    fs.writeFileSync(path.join(contentDir, 'ru', 'home.mdx'), `---\nslug: home\ntype: page\npublishedAt: ${publishedDate}\n---\nДом`);
    fs.writeFileSync(path.join(contentDir, 'de', 'home.mdx'), `---\nslug: home\ntype: page\npublishedAt: ${publishedDate}\n---\nZuhause`);
    fs.writeFileSync(path.join(contentDir, 'en-US', 'home.mdx'), `---\nslug: home\ntype: page\npublishedAt: ${publishedDate}\n---\nHome US`);
    fs.writeFileSync(path.join(contentDir, 'fr-CA', 'home.mdx'), `---\nslug: home\ntype: page\npublishedAt: ${publishedDate}\n---\nAccueil`);
    fs.writeFileSync(path.join(contentDir, 'zh-CN', 'home.mdx'), `---\nslug: home\ntype: page\npublishedAt: ${publishedDate}\n---\n首页`);

    // Non-locale directories (should be ignored)
    fs.writeFileSync(path.join(contentDir, 'notlocale', 'content.mdx'), `---\nslug: content\ntype: page\npublishedAt: ${publishedDate}\n---\nContent`);
    fs.writeFileSync(path.join(contentDir, 'toolongname', 'content.mdx'), `---\nslug: content\ntype: page\npublishedAt: ${publishedDate}\n---\nContent`);

    // Configure environment for test
    jest.resetModules();
    jest.unmock('../src/lib/config');

    process.env.LEADCMS_CONTENT_DIR = contentDir;
    process.env.LEADCMS_DEFAULT_LANGUAGE = 'en';
  });

  afterAll(() => {
    // Cleanup
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  });

  it('should properly detect all valid locale formats', () => {
    // This test verifies the fix works correctly
    const { getAvailableLanguages } = require('../src/lib/cms');
    const languages = getAvailableLanguages();

    // Should include all valid locale codes
    expect(languages).toContain('en'); // Always includes default

    // 2-character locale codes
    expect(languages).toContain('si');
    expect(languages).toContain('ru');
    expect(languages).toContain('de');

    // Longer locale codes (region-specific)
    expect(languages).toContain('en-US');
    expect(languages).toContain('fr-CA');
    expect(languages).toContain('zh-CN');

    // These should never be included (not valid locale formats)
    expect(languages).not.toContain('notlocale');
    expect(languages).not.toContain('toolongname');
  });

  it('should return all valid languages after fix', () => {
    // This test will pass after we fix the implementation
    const { getAvailableLanguages } = require('../src/lib/cms');
    const languages = getAvailableLanguages();

    // After fix, should include all valid locale codes
    const expectedLanguages = ['en', 'si', 'ru', 'de', 'en-US', 'fr-CA', 'zh-CN'];

    for (const lang of expectedLanguages) {
      expect(languages).toContain(lang);
    }

    // Should not include non-locale directories
    expect(languages).not.toContain('notlocale');
    expect(languages).not.toContain('toolongname');

    expect(languages).toHaveLength(expectedLanguages.length);
  });

  it('should handle empty content directory gracefully', () => {
    // Test with empty content directory
    const emptyDir = path.join(tmpRoot, 'empty');
    fs.mkdirSync(emptyDir, { recursive: true });

    // Temporarily change content dir to empty one
    const originalContentDir = process.env.LEADCMS_CONTENT_DIR;
    process.env.LEADCMS_CONTENT_DIR = emptyDir;

    jest.resetModules();
    const { getAvailableLanguages } = require('../src/lib/cms');
    const languages = getAvailableLanguages();

    // Should return only default language when no locale directories exist
    expect(languages).toEqual(['en']);

    // Restore original content dir
    process.env.LEADCMS_CONTENT_DIR = originalContentDir;
  });

  it('should handle non-existent content directory gracefully', () => {
    // Test with non-existent content directory
    const nonExistentDir = path.join(tmpRoot, 'non-existent');

    // Temporarily change content dir to non-existent one
    const originalContentDir = process.env.LEADCMS_CONTENT_DIR;
    process.env.LEADCMS_CONTENT_DIR = nonExistentDir;

    jest.resetModules();
    const { getAvailableLanguages } = require('../src/lib/cms');
    const languages = getAvailableLanguages();

    // Should return only default language when content directory doesn't exist
    expect(languages).toEqual(['en']);

    // Restore original content dir
    process.env.LEADCMS_CONTENT_DIR = originalContentDir;
  });
});
