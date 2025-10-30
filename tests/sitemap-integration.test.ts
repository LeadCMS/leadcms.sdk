import fs from 'fs';
import path from 'path';

// Test to verify that the sitemap scenario works correctly with our getAvailableLanguages fix

describe('Sitemap Integration - getAvailableLanguages', () => {
  const tmpRoot = path.join(__dirname, 'tmp-sitemap-test');
  const contentDir = path.join(tmpRoot, '.leadcms', 'content');

  beforeAll(() => {
    // Ensure clean state
    if (fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }

    // Create directory structure similar to what a site might have
    fs.mkdirSync(path.join(contentDir, 'en-US'), { recursive: true });
    fs.mkdirSync(path.join(contentDir, 'fr-CA'), { recursive: true });
    fs.mkdirSync(path.join(contentDir, 'es'), { recursive: true });

    const publishedDate = '2024-01-01T00:00:00Z';

    // Default language content (en) - in root directory
    fs.writeFileSync(path.join(contentDir, 'home.mdx'), `---\nslug: home\ntype: page\npublishedAt: ${publishedDate}\n---\nHome`);
    fs.writeFileSync(path.join(contentDir, 'about.mdx'), `---\nslug: about\ntype: page\npublishedAt: ${publishedDate}\n---\nAbout`);

    // US English content
    fs.writeFileSync(path.join(contentDir, 'en-US', 'home.mdx'), `---\nslug: home\ntype: page\npublishedAt: ${publishedDate}\n---\nHome US`);
    fs.writeFileSync(path.join(contentDir, 'en-US', 'about.mdx'), `---\nslug: about\ntype: page\npublishedAt: ${publishedDate}\n---\nAbout US`);

    // Canadian French content
    fs.writeFileSync(path.join(contentDir, 'fr-CA', 'home.mdx'), `---\nslug: home\ntype: page\npublishedAt: ${publishedDate}\n---\nAccueil`);
    fs.writeFileSync(path.join(contentDir, 'fr-CA', 'about.mdx'), `---\nslug: about\ntype: page\npublishedAt: ${publishedDate}\n---\nÀ propos`);

    // Spanish content
    fs.writeFileSync(path.join(contentDir, 'es', 'home.mdx'), `---\nslug: home\ntype: page\npublishedAt: ${publishedDate}\n---\nInicio`);
    fs.writeFileSync(path.join(contentDir, 'es', 'about.mdx'), `---\nslug: about\ntype: page\npublishedAt: ${publishedDate}\n---\nAcerca de`);

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

  it('should support the original sitemap use case with multiple locale formats', () => {
    const { getAvailableLanguages, getAllContentSlugsForLocale } = require('../src/lib/cms');

    // This is similar to what the sitemap code does
    const languages = getAvailableLanguages();

    // Should detect all language variants including region-specific ones
    expect(languages).toContain('en');
    expect(languages).toContain('en-US');
    expect(languages).toContain('fr-CA');
    expect(languages).toContain('es');
    expect(languages).toHaveLength(4);

    // Verify that getAllContentSlugsForLocale works for each detected language
    const pagesContentTypes = ['page'];
    const DEFAULT_LANGUAGE = 'en';

    const allParams: { locale?: string; slug: string[] }[] = [];

    for (const locale of languages) {
      const slugs = getAllContentSlugsForLocale(locale, pagesContentTypes as string[], false, null);

      for (const slug of slugs) {
        if (locale === DEFAULT_LANGUAGE) {
          // Default language doesn't need locale prefix
          allParams.push({ slug: slug.split("/") });
        } else {
          // Non-default languages get locale prefix
          allParams.push({ locale, slug: slug.split("/") });
        }
      }
    }

    // Verify we got the expected params structure
    expect(allParams.length).toBeGreaterThan(4); // Should have content for all locales

    // Check for default language entries (no locale property)
    const defaultLangEntries = allParams.filter(param => !param.locale);
    expect(defaultLangEntries.length).toBe(2); // home and about for default language

    // Check for locale-specific entries
    const enUSEntries = allParams.filter(param => param.locale === 'en-US');
    const frCAEntries = allParams.filter(param => param.locale === 'fr-CA');
    const esEntries = allParams.filter(param => param.locale === 'es');

    expect(enUSEntries.length).toBe(2);
    expect(frCAEntries.length).toBe(2);
    expect(esEntries.length).toBe(2);

    // Verify slug structures
    expect(defaultLangEntries.map(p => p.slug)).toEqual(expect.arrayContaining([['home'], ['about']]));
    expect(enUSEntries.map(p => p.slug)).toEqual(expect.arrayContaining([['home'], ['about']]));
    expect(frCAEntries.map(p => p.slug)).toEqual(expect.arrayContaining([['home'], ['about']]));
    expect(esEntries.map(p => p.slug)).toEqual(expect.arrayContaining([['home'], ['about']]));
  });

  it('should generate proper route structure for sitemap', () => {
    const { getAvailableLanguages, getAllContentSlugsForLocale } = require('../src/lib/cms');

    const languages = getAvailableLanguages();
    const DEFAULT_LANGUAGE = 'en';
    const baseUrl = 'https://example.com';

    // Simulate sitemap generation logic
    const sitemapEntries: { url: string; locale: string; alternates?: Record<string, string> }[] = [];

    // Get all slugs for all locales
    const localeSlugs: Record<string, Set<string>> = {};

    for (const locale of languages) {
      const slugs = getAllContentSlugsForLocale(locale, ['page'], false, null);
      localeSlugs[locale] = new Set(slugs);
    }

    // Generate sitemap entries for default language
    const defaultSlugs = Array.from(localeSlugs[DEFAULT_LANGUAGE] || []);

    for (const slug of defaultSlugs) {
      const alternates: Record<string, string> = {};

      // Find alternates in other locales
      for (const locale of languages) {
        if (locale !== DEFAULT_LANGUAGE && localeSlugs[locale]?.has(slug)) {
          alternates[locale] = `${baseUrl}/${locale}/${slug}`;
        }
      }

      sitemapEntries.push({
        url: slug === 'home' ? baseUrl : `${baseUrl}/${slug}`,
        locale: DEFAULT_LANGUAGE,
        alternates: Object.keys(alternates).length > 0 ? alternates : undefined
      });
    }

    // Verify sitemap structure
    expect(sitemapEntries).toHaveLength(2); // home and about

    const homeEntry = sitemapEntries.find(entry => entry.url === baseUrl);
    const aboutEntry = sitemapEntries.find(entry => entry.url === `${baseUrl}/about`);

    expect(homeEntry).toBeDefined();
    expect(aboutEntry).toBeDefined();

    // Verify alternates are properly detected for all locale formats
    expect(homeEntry?.alternates).toEqual({
      'en-US': 'https://example.com/en-US/home',
      'fr-CA': 'https://example.com/fr-CA/home',
      'es': 'https://example.com/es/home'
    });

    expect(aboutEntry?.alternates).toEqual({
      'en-US': 'https://example.com/en-US/about',
      'fr-CA': 'https://example.com/fr-CA/about',
      'es': 'https://example.com/es/about'
    });
  });
});
