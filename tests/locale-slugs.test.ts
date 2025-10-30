import fs from 'fs';
import path from 'path';

// We'll dynamically load the library under test after configuring environment
// to avoid interfering with the global jest mock in `tests/setup.ts`.

// This test reproduces the bug report: getAllContentSlugsForLocale returns [] for non-English locales
// It creates a temporary content directory structure with a "si" locale and asserts we get the expected slugs.

describe('Localization - getAllContentSlugsForLocale', () => {
  const tmpRoot = path.join(__dirname, 'tmp-content');
  const contentDir = path.join(tmpRoot, '.leadcms', 'content');

  beforeAll(() => {
    // Ensure clean state
    if (fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }

    // Create directory structure
    fs.mkdirSync(path.join(contentDir, 'si', 'legal'), { recursive: true });

    // Create files for 'si' locale with publishedAt fields to avoid being treated as drafts
    const publishedDate = '2024-01-01T00:00:00Z';
    fs.writeFileSync(path.join(contentDir, 'si', 'home.mdx'), `---\nslug: home\ntype: page\npublishedAt: ${publishedDate}\n---\nHome content`);
    fs.writeFileSync(path.join(contentDir, 'si', 'contact-us.mdx'), `---\nslug: contact-us\ntype: page\npublishedAt: ${publishedDate}\n---\nContact content`);
    fs.writeFileSync(path.join(contentDir, 'si', 'contact-us-form.json'), JSON.stringify({ slug: 'contact-us-form', type: 'form', publishedAt: publishedDate }));
    fs.writeFileSync(path.join(contentDir, 'si', 'not-found.mdx'), `---\nslug: not-found\ntype: page\npublishedAt: ${publishedDate}\n---\nNot found`);
    fs.writeFileSync(path.join(contentDir, 'si', 'legal', 'privacy.mdx'), `---\nslug: legal/privacy\ntype: page\npublishedAt: ${publishedDate}\n---\nPrivacy`);
    fs.writeFileSync(path.join(contentDir, 'si', 'legal', 'terms.mdx'), `---\nslug: legal/terms\ntype: page\npublishedAt: ${publishedDate}\n---\nTerms`);

    // Create default language content in root directory (for 'en' locale test)
    fs.writeFileSync(path.join(contentDir, 'about.mdx'), `---\nslug: about\ntype: page\npublishedAt: ${publishedDate}\n---\nAbout page`);
    fs.writeFileSync(path.join(contentDir, 'services.json'), JSON.stringify({ slug: 'services', type: 'page', publishedAt: publishedDate }));

    // Configure only the minimal required environment variables
    // Reset modules to ensure real config implementation is used instead of jest mock
    jest.resetModules();
    jest.unmock('../src/lib/config');

    // Only set the essential variables for getAllContentSlugsForLocale
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

  it('should return slugs for non-English locale si (reproduction of bug)', () => {
    // Import the cms module after env/config is set
    const { getAllContentSlugsForLocale } = require('../src/lib/cms');
    const slugs = getAllContentSlugsForLocale('si');

    // We expect these slugs to be found for 'si'
    const expected = [
      'home',
      'contact-us',
      'contact-us-form',
      'legal/privacy',
      'legal/terms',
      'not-found'
    ];

    // The bug report states this returns [] — assert the expected slugs are present.
    expect(slugs).toEqual(expect.arrayContaining(expected));
    expect(slugs.length).toBeGreaterThanOrEqual(expected.length);
  });

  it('should return slugs for default locale en', () => {
    // Import the cms module after env/config is set
    const { getAllContentSlugsForLocale } = require('../src/lib/cms');

    const slugs = getAllContentSlugsForLocale('en');

    // For default locale, content should be found in the root content directory
    expect(slugs).toEqual(expect.arrayContaining(['about', 'services']));
    expect(slugs.length).toBeGreaterThanOrEqual(2);
  });

  it('should return slugs for Russian locale ru (another failing case)', () => {
    // Create content for Russian locale
    const publishedDate = '2024-01-01T00:00:00Z';
    fs.mkdirSync(path.join(contentDir, 'ru'), { recursive: true });
    fs.writeFileSync(path.join(contentDir, 'ru', 'home.mdx'), `---\nslug: home\ntype: page\npublishedAt: ${publishedDate}\n---\nДомашняя страница`);
    fs.writeFileSync(path.join(contentDir, 'ru', 'about.json'), JSON.stringify({ slug: 'about', type: 'page', publishedAt: publishedDate }));

    const { getAllContentSlugsForLocale } = require('../src/lib/cms');
    const slugs = getAllContentSlugsForLocale('ru');

    // According to the bug report, this also returns [] instead of expected slugs
    expect(slugs).toEqual(expect.arrayContaining(['home', 'about']));
    expect(slugs.length).toBeGreaterThanOrEqual(2);
  });

  it('should return slugs for US English locale en-US (extended locale format)', () => {
    // Create content for US English locale with full locale code
    const publishedDate = '2024-01-01T00:00:00Z';
    fs.mkdirSync(path.join(contentDir, 'en-US'), { recursive: true });
    fs.writeFileSync(path.join(contentDir, 'en-US', 'products.mdx'), `---\nslug: products\ntype: page\npublishedAt: ${publishedDate}\n---\nProducts page`);
    fs.writeFileSync(path.join(contentDir, 'en-US', 'services.json'), JSON.stringify({ slug: 'services', type: 'page', publishedAt: publishedDate }));

    const { getAllContentSlugsForLocale } = require('../src/lib/cms');
    const slugs = getAllContentSlugsForLocale('en-US');

    // This should find the content in the en-US directory
    expect(slugs).toEqual(expect.arrayContaining(['products', 'services']));
    expect(slugs.length).toBeGreaterThanOrEqual(2);
  });

  it('should return slugs for Russian Russia locale ru-RU (extended locale format)', () => {
    // Create content for Russian Russia locale with full locale code
    const publishedDate = '2024-01-01T00:00:00Z';
    fs.mkdirSync(path.join(contentDir, 'ru-RU', 'category'), { recursive: true });
    fs.writeFileSync(path.join(contentDir, 'ru-RU', 'index.mdx'), `---\nslug: index\ntype: page\npublishedAt: ${publishedDate}\n---\nГлавная страница`);
    fs.writeFileSync(path.join(contentDir, 'ru-RU', 'category', 'tech.mdx'), `---\nslug: category/tech\ntype: page\npublishedAt: ${publishedDate}\n---\nТехнологии`);
    fs.writeFileSync(path.join(contentDir, 'ru-RU', 'news.json'), JSON.stringify({ slug: 'news', type: 'page', publishedAt: publishedDate }));

    const { getAllContentSlugsForLocale } = require('../src/lib/cms');
    const slugs = getAllContentSlugsForLocale('ru-RU');

    // This should find the content in the ru-RU directory including nested paths
    expect(slugs).toEqual(expect.arrayContaining(['index', 'category/tech', 'news']));
    expect(slugs.length).toBeGreaterThanOrEqual(3);
  });

  it('should return slugs for German locale de (short locale format)', () => {
    // Create content for German locale
    const publishedDate = '2024-01-01T00:00:00Z';
    fs.mkdirSync(path.join(contentDir, 'de', 'company'), { recursive: true });
    fs.writeFileSync(path.join(contentDir, 'de', 'home.mdx'), `---\nslug: home\ntype: page\npublishedAt: ${publishedDate}\n---\nStartseite`);
    fs.writeFileSync(path.join(contentDir, 'de', 'company', 'about.mdx'), `---\nslug: company/about\ntype: page\npublishedAt: ${publishedDate}\n---\nÜber uns`);

    const { getAllContentSlugsForLocale } = require('../src/lib/cms');
    const slugs = getAllContentSlugsForLocale('de');

    // This should find the content in the de directory
    expect(slugs).toEqual(expect.arrayContaining(['home', 'company/about']));
    expect(slugs.length).toBeGreaterThanOrEqual(2);
  });

  it('should return slugs for French Canada locale fr-CA (regional variant)', () => {
    // Create content for French Canadian locale
    const publishedDate = '2024-01-01T00:00:00Z';
    fs.mkdirSync(path.join(contentDir, 'fr-CA'), { recursive: true });
    fs.writeFileSync(path.join(contentDir, 'fr-CA', 'accueil.mdx'), `---\nslug: accueil\ntype: page\npublishedAt: ${publishedDate}\n---\nPage d'accueil`);
    fs.writeFileSync(path.join(contentDir, 'fr-CA', 'contact.json'), JSON.stringify({ slug: 'contact', type: 'form', publishedAt: publishedDate }));

    const { getAllContentSlugsForLocale } = require('../src/lib/cms');
    const slugs = getAllContentSlugsForLocale('fr-CA');

    // This should find the content in the fr-CA directory
    expect(slugs).toEqual(expect.arrayContaining(['accueil', 'contact']));
    expect(slugs.length).toBeGreaterThanOrEqual(2);
  });
});
