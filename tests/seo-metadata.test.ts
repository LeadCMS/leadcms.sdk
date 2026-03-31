/**
 * Tests for SEO metadata utilities and integration with content transformation/formatting
 *
 * Covers:
 * - computeSeoDefaults: deriving defaults from content fields
 * - apiSeoToFrontmatter: converting API SeoMetadataDto to frontmatter, stripping defaults
 * - frontmatterSeoToApi: converting frontmatter seo back to API, stripping defaults
 * - Content transformation: SEO in pull (remote → local)
 * - Content API formatting: SEO in push (local → remote)
 */

import {
    computeSeoDefaults,
    apiSeoToFrontmatter,
    frontmatterSeoToApi,
    DEFAULT_ROBOTS,
    type SeoMetadataDto,
    type FrontmatterSeo,
    type SeoDefaultSources,
} from '../src/lib/seo-utils';

describe('seo-utils', () => {
    describe('computeSeoDefaults', () => {
        it('should derive defaults from content fields', () => {
            const sources: SeoDefaultSources = {
                title: 'My Article',
                description: 'Article description',
                coverImageUrl: '/media/cover.jpg',
            };
            const defaults = computeSeoDefaults(sources);

            expect(defaults.metaTitle).toBe('My Article');
            expect(defaults.metaDescription).toBe('Article description');
            expect(defaults.canonicalUrl).toBeNull();
            expect(defaults.openGraphTitle).toBe('My Article');
            expect(defaults.openGraphDescription).toBe('Article description');
            expect(defaults.openGraphImageUrl).toBe('/media/cover.jpg');
            expect(defaults.robots).toBe('index,follow');
            expect(defaults.keywords).toBeNull();
        });

        it('should handle missing content fields gracefully', () => {
            const defaults = computeSeoDefaults({});

            expect(defaults.metaTitle).toBeNull();
            expect(defaults.metaDescription).toBeNull();
            expect(defaults.openGraphTitle).toBeNull();
            expect(defaults.openGraphDescription).toBeNull();
            expect(defaults.openGraphImageUrl).toBeNull();
            expect(defaults.robots).toBe('index,follow');
        });
    });

    describe('apiSeoToFrontmatter', () => {
        const sources: SeoDefaultSources = {
            title: 'My Article',
            description: 'Article description',
            coverImageUrl: '/media/cover.jpg',
        };

        it('should return undefined when all values match defaults', () => {
            const apiSeo: SeoMetadataDto = {
                metaTitle: 'My Article',
                metaDescription: 'Article description',
                openGraphTitle: 'My Article',
                openGraphDescription: 'Article description',
                openGraphImageUrl: '/media/cover.jpg',
                robots: 'index,follow',
                canonicalUrl: null,
                keywords: null,
            };

            expect(apiSeoToFrontmatter(apiSeo, sources)).toBeUndefined();
        });

        it('should return undefined for null/empty seo', () => {
            expect(apiSeoToFrontmatter(null, sources)).toBeUndefined();
            expect(apiSeoToFrontmatter(undefined, sources)).toBeUndefined();
        });

        it('should include only non-default values', () => {
            const apiSeo: SeoMetadataDto = {
                metaTitle: 'Custom SEO Title',
                metaDescription: 'Article description', // matches default
                openGraphTitle: 'My Article', // matches default
                openGraphDescription: 'Custom OG Description',
                openGraphImageUrl: '/media/cover.jpg', // matches default
                robots: 'noindex,nofollow',
                canonicalUrl: 'https://example.com/article',
                keywords: ['surf', 'travel'],
            };

            const result = apiSeoToFrontmatter(apiSeo, sources);

            expect(result).toEqual({
                title: 'Custom SEO Title',
                ogDescription: 'Custom OG Description',
                robots: 'noindex,nofollow',
                canonicalUrl: 'https://example.com/article',
                keywords: ['surf', 'travel'],
            });
        });

        it('should include canonicalUrl even if default is null', () => {
            const apiSeo: SeoMetadataDto = {
                canonicalUrl: 'https://example.com/canonical',
            };

            const result = apiSeoToFrontmatter(apiSeo, sources);
            expect(result).toEqual({ canonicalUrl: 'https://example.com/canonical' });
        });

        it('should not include empty keywords array', () => {
            const apiSeo: SeoMetadataDto = {
                metaTitle: 'Custom Title',
                keywords: [],
            };

            const result = apiSeoToFrontmatter(apiSeo, sources);
            expect(result).toEqual({ title: 'Custom Title' });
        });
    });

    describe('frontmatterSeoToApi', () => {
        const sources: SeoDefaultSources = {
            title: 'My Article',
            description: 'Article description',
            coverImageUrl: '/media/cover.jpg',
        };

        it('should return undefined for empty/missing seo', () => {
            expect(frontmatterSeoToApi(undefined, sources)).toBeUndefined();
            expect(frontmatterSeoToApi({}, sources)).toBeUndefined();
        });

        it('should map frontmatter fields to API fields', () => {
            const fmSeo: FrontmatterSeo = {
                title: 'Custom SEO Title',
                description: 'Custom meta description',
                canonicalUrl: 'https://example.com/article',
                robots: 'noindex',
                ogTitle: 'OG Title',
                ogDescription: 'OG Description',
                ogImage: 'https://example.com/og.jpg',
                keywords: ['surf', 'travel'],
            };

            const result = frontmatterSeoToApi(fmSeo, sources);

            expect(result).toEqual({
                metaTitle: 'Custom SEO Title',
                metaDescription: 'Custom meta description',
                canonicalUrl: 'https://example.com/article',
                robots: 'noindex',
                openGraphTitle: 'OG Title',
                openGraphDescription: 'OG Description',
                openGraphImageUrl: 'https://example.com/og.jpg',
                keywords: ['surf', 'travel'],
            });
        });

        it('should strip values that match content defaults', () => {
            const fmSeo: FrontmatterSeo = {
                title: 'My Article', // matches title → should be stripped
                canonicalUrl: 'https://example.com/article',
            };

            const result = frontmatterSeoToApi(fmSeo, sources);
            expect(result).toEqual({
                canonicalUrl: 'https://example.com/article',
            });
        });

        it('should strip default robots value', () => {
            const fmSeo: FrontmatterSeo = {
                robots: 'index,follow', // matches default → should be stripped
                canonicalUrl: 'https://example.com/article',
            };

            const result = frontmatterSeoToApi(fmSeo, sources);
            expect(result).toEqual({
                canonicalUrl: 'https://example.com/article',
            });
        });

        it('should return undefined if all frontmatter values match defaults', () => {
            const fmSeo: FrontmatterSeo = {
                title: 'My Article',
                description: 'Article description',
                robots: 'index,follow',
                ogTitle: 'My Article',
                ogDescription: 'Article description',
                ogImage: '/media/cover.jpg',
            };

            expect(frontmatterSeoToApi(fmSeo, sources)).toBeUndefined();
        });
    });
});

// Integration tests with content transformation
import matter from 'gray-matter';

jest.mock('../src/lib/config.js', () => ({
    getConfig: jest.fn(() => ({
        url: 'https://test.leadcms.com',
        apiKey: 'test-api-key',
        defaultLanguage: 'en',
        contentDir: '/tmp/test-content',
        mediaDir: '/tmp/test-media',
    })),
}));

import {
    transformRemoteToLocalFormat,
    type ContentTypeMap,
} from '../src/lib/content-transformation';
import { formatContentForAPI } from '../src/lib/content-api-formatting';

describe('SEO integration with content transformation (pull)', () => {
    it('should convert API seo to frontmatter format on pull', async () => {
        const remote = {
            id: 1,
            slug: 'best-surf-camps',
            type: 'article',
            title: 'Best Surf Camps in Sri Lanka',
            description: 'A guide to surf camps.',
            body: '# Surf Camps\n\nContent here.',
            seo: {
                metaTitle: 'Best Surf Camps for Beginners',
                metaDescription: 'A guide to surf camps.', // matches description → stripped
                canonicalUrl: 'https://example.com/best-surf-camps',
                openGraphTitle: 'Best Surf Camps in Sri Lanka', // matches title → stripped
                openGraphDescription: 'Where to surf in Sri Lanka.',
                openGraphImageUrl: null,
                robots: 'index,follow', // default → stripped
                keywords: ['surf', 'sri lanka'],
            },
        };

        const result = await transformRemoteToLocalFormat(remote, { article: 'MDX' });
        const parsed = matter(result);

        expect(parsed.data.seo).toBeDefined();
        expect(parsed.data.seo.title).toBe('Best Surf Camps for Beginners');
        expect(parsed.data.seo.canonicalUrl).toBe('https://example.com/best-surf-camps');
        expect(parsed.data.seo.ogDescription).toBe('Where to surf in Sri Lanka.');
        expect(parsed.data.seo.keywords).toEqual(['surf', 'sri lanka']);

        // Stripped default values should not be present
        expect(parsed.data.seo.description).toBeUndefined();
        expect(parsed.data.seo.ogTitle).toBeUndefined();
        expect(parsed.data.seo.robots).toBeUndefined();
    });

    it('should omit seo block entirely when all values are defaults', async () => {
        const remote = {
            id: 2,
            slug: 'basic-article',
            type: 'article',
            title: 'Basic Article',
            description: 'Simple description.',
            body: 'Content.',
            seo: {
                metaTitle: 'Basic Article',
                metaDescription: 'Simple description.',
                canonicalUrl: null,
                openGraphTitle: 'Basic Article',
                openGraphDescription: 'Simple description.',
                openGraphImageUrl: null,
                robots: 'index,follow',
                keywords: null,
            },
        };

        const result = await transformRemoteToLocalFormat(remote, { article: 'MDX' });
        const parsed = matter(result);

        expect(parsed.data.seo).toBeUndefined();
    });

    it('should omit seo block when seo is null', async () => {
        const remote = {
            id: 3,
            slug: 'no-seo-article',
            type: 'article',
            title: 'No SEO',
            body: 'Content.',
            seo: null,
        };

        const result = await transformRemoteToLocalFormat(remote, { article: 'MDX' });
        const parsed = matter(result);

        expect(parsed.data.seo).toBeUndefined();
    });

    it('should handle SEO in JSON format content', async () => {
        const remote = {
            id: 4,
            slug: 'json-page',
            type: 'page',
            title: 'JSON Page',
            description: 'Page desc.',
            body: '{}',
            seo: {
                metaTitle: 'Custom JSON Page Title',
                metaDescription: null,
                canonicalUrl: null,
                openGraphTitle: null,
                openGraphDescription: null,
                openGraphImageUrl: null,
                robots: 'noindex',
                keywords: null,
            },
        };

        const result = await transformRemoteToLocalFormat(remote, { page: 'JSON' });
        const parsed = JSON.parse(result);

        expect(parsed.seo).toBeDefined();
        expect(parsed.seo.title).toBe('Custom JSON Page Title');
        expect(parsed.seo.robots).toBe('noindex');
    });
});

describe('SEO integration with content API formatting (push)', () => {
    it('should convert frontmatter seo to API SeoMetadataDto on push', () => {
        const localContent = {
            slug: 'best-surf-camps',
            type: 'article',
            locale: 'en',
            filePath: '/tmp/content/best-surf-camps.mdx',
            metadata: {
                title: 'Best Surf Camps in Sri Lanka',
                description: 'A guide to surf camps.',
                slug: 'best-surf-camps',
                type: 'article',
                seo: {
                    title: 'Best Surf Camps for Beginners',
                    canonicalUrl: 'https://example.com/best-surf-camps',
                    ogDescription: 'Where to surf in Sri Lanka.',
                    keywords: ['surf', 'sri lanka'],
                },
            },
            body: '# Surf Camps\n\nContent here.',
        };

        const result = formatContentForAPI(localContent);

        expect(result.seo).toBeDefined();
        expect(result.seo.metaTitle).toBe('Best Surf Camps for Beginners');
        expect(result.seo.canonicalUrl).toBe('https://example.com/best-surf-camps');
        expect(result.seo.openGraphDescription).toBe('Where to surf in Sri Lanka.');
        expect(result.seo.keywords).toEqual(['surf', 'sri lanka']);

        // Default-matching values should not be present
        expect(result.seo.openGraphTitle).toBeUndefined();
        expect(result.seo.metaDescription).toBeUndefined();
        expect(result.seo.robots).toBeUndefined();
    });

    it('should omit seo field when all frontmatter seo values match defaults', () => {
        const localContent = {
            slug: 'basic-article',
            type: 'article',
            locale: 'en',
            filePath: '/tmp/content/basic-article.mdx',
            metadata: {
                title: 'Basic Article',
                description: 'Simple description.',
                slug: 'basic-article',
                type: 'article',
                seo: {
                    title: 'Basic Article', // matches content title
                    description: 'Simple description.', // matches content description
                    robots: 'index,follow', // matches default
                },
            },
            body: 'Content.',
        };

        const result = formatContentForAPI(localContent);
        expect(result.seo).toBeUndefined();
    });

    it('should omit seo field when frontmatter has no seo', () => {
        const localContent = {
            slug: 'no-seo',
            type: 'article',
            locale: 'en',
            filePath: '/tmp/content/no-seo.mdx',
            metadata: {
                title: 'No SEO Article',
                slug: 'no-seo',
                type: 'article',
            },
            body: 'Content.',
        };

        const result = formatContentForAPI(localContent);
        expect(result.seo).toBeUndefined();
    });

    it('should handle push with robots override', () => {
        const localContent = {
            slug: 'hidden-page',
            type: 'page',
            locale: 'en',
            filePath: '/tmp/content/hidden-page.mdx',
            metadata: {
                title: 'Hidden Page',
                description: 'Should not be indexed.',
                slug: 'hidden-page',
                type: 'page',
                seo: {
                    robots: 'noindex,nofollow',
                },
            },
            body: 'Hidden content.',
        };

        const result = formatContentForAPI(localContent);
        expect(result.seo).toBeDefined();
        expect(result.seo.robots).toBe('noindex,nofollow');
    });
});

describe('SEO roundtrip: pull then push preserves overrides', () => {
    it('should preserve non-default SEO values through pull → edit → push', async () => {
        // Simulate pull: API returns content with SEO overrides
        const remote = {
            id: 10,
            slug: 'roundtrip-article',
            type: 'article',
            title: 'Roundtrip Article',
            description: 'Description.',
            coverImageUrl: '/api/media/cover.jpg',
            body: '# Content',
            seo: {
                metaTitle: 'Custom Meta Title',
                metaDescription: 'Description.', // matches default → stripped on pull
                canonicalUrl: 'https://example.com/roundtrip',
                openGraphTitle: 'Roundtrip Article', // matches default → stripped on pull
                openGraphDescription: null,
                openGraphImageUrl: '/api/media/cover.jpg', // matches default → stripped on pull
                robots: 'index,follow', // default → stripped on pull
                keywords: ['test'],
            },
        };

        // Pull: transform to local
        const localContent = await transformRemoteToLocalFormat(remote, { article: 'MDX' });
        const parsed = matter(localContent);

        // Verify pull result has only overrides
        expect(parsed.data.seo).toEqual({
            title: 'Custom Meta Title',
            canonicalUrl: 'https://example.com/roundtrip',
            keywords: ['test'],
        });

        // Push: format for API
        const pushData = {
            slug: 'roundtrip-article',
            type: 'article',
            locale: 'en',
            filePath: '/tmp/content/roundtrip-article.mdx',
            metadata: parsed.data,
            body: parsed.content.trim(),
        };

        const apiPayload = formatContentForAPI(pushData);

        // Verify push sends the same overrides
        expect(apiPayload.seo).toEqual({
            metaTitle: 'Custom Meta Title',
            canonicalUrl: 'https://example.com/roundtrip',
            keywords: ['test'],
        });
    });
});
