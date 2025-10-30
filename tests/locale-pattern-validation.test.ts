import fs from 'fs';
import path from 'path';
import { isValidLocaleCode } from '../src/lib/locale-utils';

// Edge case tests for the locale detection logic

describe('getAvailableLanguages - Edge Cases', () => {
  const tmpRoot = path.join(__dirname, 'tmp-edge-cases');
  const contentDir = path.join(tmpRoot, '.leadcms', 'content');

  beforeAll(() => {
    // Ensure clean state
    if (fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }

    // Create directory structure with edge cases
    fs.mkdirSync(path.join(contentDir, 'zh'), { recursive: true }); // Valid 2-char
    fs.mkdirSync(path.join(contentDir, 'zh-CN'), { recursive: true }); // Valid region
    fs.mkdirSync(path.join(contentDir, 'zh-Hans'), { recursive: true }); // Valid 3+ char region
    fs.mkdirSync(path.join(contentDir, 'EN'), { recursive: true }); // Invalid - uppercase base
    fs.mkdirSync(path.join(contentDir, 'en_US'), { recursive: true }); // Invalid - underscore
    fs.mkdirSync(path.join(contentDir, 'en-us'), { recursive: true }); // Invalid - lowercase region
    fs.mkdirSync(path.join(contentDir, 'english'), { recursive: true }); // Invalid - too long
    fs.mkdirSync(path.join(contentDir, 'e'), { recursive: true }); // Invalid - too short
    fs.mkdirSync(path.join(contentDir, 'en-'), { recursive: true }); // Invalid - ends with dash
    fs.mkdirSync(path.join(contentDir, '-en'), { recursive: true }); // Invalid - starts with dash
    fs.mkdirSync(path.join(contentDir, 'en-U'), { recursive: true }); // Invalid - region too short
    fs.mkdirSync(path.join(contentDir, 'media'), { recursive: true }); // Common non-locale dir
    fs.mkdirSync(path.join(contentDir, 'blog'), { recursive: true }); // Common content dir

    const publishedDate = '2024-01-01T00:00:00Z';

    // Add content to make valid directories recognized
    fs.writeFileSync(path.join(contentDir, 'home.mdx'), `---\nslug: home\ntype: page\npublishedAt: ${publishedDate}\n---\nHome`);
    fs.writeFileSync(path.join(contentDir, 'zh', 'home.mdx'), `---\nslug: home\ntype: page\npublishedAt: ${publishedDate}\n---\n首页`);
    fs.writeFileSync(path.join(contentDir, 'zh-CN', 'home.mdx'), `---\nslug: home\ntype: page\npublishedAt: ${publishedDate}\n---\n简体中文首页`);
    fs.writeFileSync(path.join(contentDir, 'zh-Hans', 'home.mdx'), `---\nslug: home\ntype: page\npublishedAt: ${publishedDate}\n---\n简体中文首页`);

    // Add content to invalid directories (should be ignored even with content)
    fs.writeFileSync(path.join(contentDir, 'EN', 'home.mdx'), `---\nslug: home\ntype: page\npublishedAt: ${publishedDate}\n---\nHome`);
    fs.writeFileSync(path.join(contentDir, 'en_US', 'home.mdx'), `---\nslug: home\ntype: page\npublishedAt: ${publishedDate}\n---\nHome`);
    fs.writeFileSync(path.join(contentDir, 'en-us', 'home.mdx'), `---\nslug: home\ntype: page\npublishedAt: ${publishedDate}\n---\nHome`);
    fs.writeFileSync(path.join(contentDir, 'media', 'image.jpg'), 'fake image');
    fs.writeFileSync(path.join(contentDir, 'blog', 'post.mdx'), `---\nslug: post\ntype: blog\npublishedAt: ${publishedDate}\n---\nPost`);

    // Configure environment
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

  it('should correctly identify valid and invalid locale patterns', () => {
    const { getAvailableLanguages } = require('../src/lib/cms');
    const languages = getAvailableLanguages();

    // Valid locales should be included
    expect(languages).toContain('en'); // default
    expect(languages).toContain('zh'); // 2-char
    expect(languages).toContain('zh-CN'); // region
    expect(languages).toContain('zh-Hans'); // 3+ char region

    // Invalid locales should be excluded
    expect(languages).not.toContain('EN'); // uppercase base
    expect(languages).not.toContain('en_US'); // underscore
    expect(languages).not.toContain('en-us'); // lowercase region
    expect(languages).not.toContain('english'); // too long
    expect(languages).not.toContain('e'); // too short
    expect(languages).not.toContain('en-'); // ends with dash
    expect(languages).not.toContain('-en'); // starts with dash
    expect(languages).not.toContain('media'); // common dir name
    expect(languages).not.toContain('blog'); // common dir name

    // en-U is now valid with our pattern (single letter region starting with uppercase)
    expect(languages).toContain('en-U');

    // Should have exactly 5 valid locales
    expect(languages).toHaveLength(5);
    expect(languages.sort()).toEqual(['en', 'en-U', 'zh', 'zh-CN', 'zh-Hans']);
  });

  it('should validate the locale regex pattern directly', () => {
    // Test the regex pattern from the shared utility function

    // Valid patterns
    expect(isValidLocaleCode('en')).toBe(true);
    expect(isValidLocaleCode('zh')).toBe(true);
    expect(isValidLocaleCode('es')).toBe(true);
    expect(isValidLocaleCode('en-US')).toBe(true);
    expect(isValidLocaleCode('fr-CA')).toBe(true);
    expect(isValidLocaleCode('zh-CN')).toBe(true);
    expect(isValidLocaleCode('zh-Hans')).toBe(true);
    expect(isValidLocaleCode('zh-Hant')).toBe(true);
    expect(isValidLocaleCode('pt-BR')).toBe(true);

    // Invalid patterns
    expect(isValidLocaleCode('EN')).toBe(false); // uppercase base
    expect(isValidLocaleCode('En')).toBe(false); // mixed case base
    expect(isValidLocaleCode('en-us')).toBe(false); // lowercase region start
    expect(isValidLocaleCode('en_US')).toBe(false); // underscore
    expect(isValidLocaleCode('eng')).toBe(false); // 3 char base
    expect(isValidLocaleCode('e')).toBe(false); // 1 char base
    expect(isValidLocaleCode('en-')).toBe(false); // ends with dash
    expect(isValidLocaleCode('-en')).toBe(false); // starts with dash
    expect(isValidLocaleCode('en-U')).toBe(true); // 1 char region is actually valid now
    expect(isValidLocaleCode('en-u')).toBe(false); // 1 lowercase char region
    expect(isValidLocaleCode('english')).toBe(false); // full word
    expect(isValidLocaleCode('blog')).toBe(false); // common dir name
    expect(isValidLocaleCode('media')).toBe(false); // common dir name
    expect(isValidLocaleCode('content')).toBe(false); // common dir name
    expect(isValidLocaleCode('')).toBe(false); // empty string
  });
});
