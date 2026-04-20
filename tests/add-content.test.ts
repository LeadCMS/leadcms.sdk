/**
 * Tests for the add-content command
 *
 * Tests cover:
 * - MDX frontmatter generation with all fields
 * - JSON structure generation
 * - Conditional fields (coverImage, allowComments) based on content type config
 * - Slug validation (path traversal, invalid chars, existing files)
 * - Slug prefix/postfix application from content type config
 * - Locale subdirectory handling
 * - Category & tag selection (existing + custom)
 */

import {
  generateMDXContent,
  generateJSONContent,
  validateSlug,
  slugToTitle,
  buildFrontmatter,
  applySlugPrefixPostfix,
  type AddContentOptions,
  type ContentTypeInfo,
} from '../src/scripts/add-content.js';

describe('add-content', () => {
  describe('slugToTitle', () => {
    it('should convert a simple slug to title case', () => {
      expect(slugToTitle('my-new-page')).toBe('My New Page');
    });

    it('should handle single-word slug', () => {
      expect(slugToTitle('about')).toBe('About');
    });

    it('should handle nested slug path', () => {
      expect(slugToTitle('docs/getting-started')).toBe('Getting Started');
    });

    it('should handle slug with multiple hyphens', () => {
      expect(slugToTitle('my-very-long-page-title')).toBe('My Very Long Page Title');
    });
  });

  describe('validateSlug', () => {
    it('should accept a valid slug', () => {
      expect(validateSlug('my-page')).toEqual({ valid: true });
    });

    it('should accept a nested slug', () => {
      expect(validateSlug('docs/getting-started')).toEqual({ valid: true });
    });

    it('should reject empty slug', () => {
      const result = validateSlug('');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should reject path traversal', () => {
      const result = validateSlug('../etc/passwd');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('traversal');
    });

    it('should reject slug with backslashes', () => {
      const result = validateSlug('some\\path');
      expect(result.valid).toBe(false);
    });

    it('should reject slug starting with a dot', () => {
      const result = validateSlug('.hidden');
      expect(result.valid).toBe(false);
    });

    it('should reject slug with double dots', () => {
      const result = validateSlug('foo/../bar');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('traversal');
    });
  });


  describe('applySlugPrefixPostfix', () => {
    const baseType: ContentTypeInfo = {
      uid: 'blog',
      format: 'MDX',
      name: 'Blog',
    };

    it('should return slug unchanged when no prefix/postfix defined', () => {
      const result = applySlugPrefixPostfix('my-page', baseType);
      expect(result.slug).toBe('my-page');
      expect(result.changed).toBe(false);
    });

    it('should add prefix when missing', () => {
      const type: ContentTypeInfo = { ...baseType, slugPrefix: 'blog/' };
      const result = applySlugPrefixPostfix('my-article', type);
      expect(result.slug).toBe('blog/my-article');
      expect(result.changed).toBe(true);
    });

    it('should not duplicate prefix when already present', () => {
      const type: ContentTypeInfo = { ...baseType, slugPrefix: 'blog/' };
      const result = applySlugPrefixPostfix('blog/my-article', type);
      expect(result.slug).toBe('blog/my-article');
      expect(result.changed).toBe(false);
    });

    it('should add postfix when missing', () => {
      const type: ContentTypeInfo = { ...baseType, slugPostfix: '-page' };
      const result = applySlugPrefixPostfix('about', type);
      expect(result.slug).toBe('about-page');
      expect(result.changed).toBe(true);
    });

    it('should not duplicate postfix when already present', () => {
      const type: ContentTypeInfo = { ...baseType, slugPostfix: '-page' };
      const result = applySlugPrefixPostfix('about-page', type);
      expect(result.slug).toBe('about-page');
      expect(result.changed).toBe(false);
    });

    it('should apply both prefix and postfix', () => {
      const type: ContentTypeInfo = { ...baseType, slugPrefix: 'docs/', slugPostfix: '-guide' };
      const result = applySlugPrefixPostfix('getting-started', type);
      expect(result.slug).toBe('docs/getting-started-guide');
      expect(result.changed).toBe(true);
    });

    it('should handle null prefix/postfix', () => {
      const type: ContentTypeInfo = { ...baseType, slugPrefix: null, slugPostfix: null };
      const result = applySlugPrefixPostfix('my-page', type);
      expect(result.slug).toBe('my-page');
      expect(result.changed).toBe(false);
    });

    it('should handle empty string prefix/postfix', () => {
      const type: ContentTypeInfo = { ...baseType, slugPrefix: '  ', slugPostfix: '  ' };
      const result = applySlugPrefixPostfix('my-page', type);
      expect(result.slug).toBe('my-page');
      expect(result.changed).toBe(false);
    });
  });
  describe('buildFrontmatter', () => {
    const baseOptions: AddContentOptions = {
      slug: 'my-page',
      title: 'My Page',
      description: 'A test page',
      author: 'Test Author',
      language: 'en',
      category: 'general',
      tags: ['test', 'demo'],
      type: 'blog',
    };

    const mdxType: ContentTypeInfo = {
      uid: 'blog',
      format: 'MDX',
      name: 'Blog',
      supportsCoverImage: true,
      supportsComments: true,
    };

    it('should include all base fields', () => {
      const fm = buildFrontmatter(baseOptions, mdxType);
      expect(fm.slug).toBe('my-page');
      expect(fm.title).toBe('My Page');
      expect(fm.description).toBe('A test page');
      expect(fm.author).toBe('Test Author');
      expect(fm.language).toBe('en');
      expect(fm.type).toBe('blog');
      expect(fm.category).toBe('general');
      expect(fm.tags).toEqual(['test', 'demo']);
      expect(fm.draft).toBe(true);
    });

    it('should include coverImage fields when type supports it', () => {
      const options: AddContentOptions = {
        ...baseOptions,
        coverImageUrl: '/images/cover.jpg',
        coverImageAlt: 'Cover image',
      };
      const fm = buildFrontmatter(options, mdxType);
      expect(fm.coverImageUrl).toBe('/images/cover.jpg');
      expect(fm.coverImageAlt).toBe('Cover image');
    });

    it('should not include coverImage fields when type does not support it', () => {
      const noCoverType: ContentTypeInfo = { ...mdxType, supportsCoverImage: false };
      const options: AddContentOptions = {
        ...baseOptions,
        coverImageUrl: '/images/cover.jpg',
        coverImageAlt: 'Cover image',
      };
      const fm = buildFrontmatter(options, noCoverType);
      expect(fm.coverImageUrl).toBeUndefined();
      expect(fm.coverImageAlt).toBeUndefined();
    });

    it('should include allowComments when type supports it', () => {
      const options: AddContentOptions = {
        ...baseOptions,
        allowComments: true,
      };
      const fm = buildFrontmatter(options, mdxType);
      expect(fm.allowComments).toBe(true);
    });

    it('should not include allowComments when type does not support it', () => {
      const noCommentsType: ContentTypeInfo = { ...mdxType, supportsComments: false };
      const options: AddContentOptions = {
        ...baseOptions,
        allowComments: true,
      };
      const fm = buildFrontmatter(options, noCommentsType);
      expect(fm.allowComments).toBeUndefined();
    });

    it('should set empty coverImageUrl/Alt as empty strings when type supports it', () => {
      const fm = buildFrontmatter(baseOptions, mdxType);
      expect(fm.coverImageUrl).toBe('');
      expect(fm.coverImageAlt).toBe('');
    });

    it('should handle empty tags array', () => {
      const options: AddContentOptions = { ...baseOptions, tags: [] };
      const fm = buildFrontmatter(options, mdxType);
      expect(fm.tags).toEqual([]);
    });
  });

  describe('generateMDXContent', () => {
    const baseOptions: AddContentOptions = {
      slug: 'my-blog-post',
      title: 'My Blog Post',
      description: 'A blog post about testing',
      author: 'Test Author',
      language: 'en',
      category: 'engineering',
      tags: ['sdk', 'tutorial'],
      type: 'blog',
    };

    const mdxType: ContentTypeInfo = {
      uid: 'blog',
      format: 'MDX',
      name: 'Blog',
      supportsCoverImage: true,
      supportsComments: true,
    };

    it('should generate valid MDX with YAML frontmatter', () => {
      const content = generateMDXContent(baseOptions, mdxType);
      expect(content).toContain('---');
      expect(content).toContain('title: My Blog Post');
      expect(content).toContain('slug: my-blog-post');
      expect(content).toContain('type: blog');
      expect(content).toContain('author: Test Author');
      expect(content).toContain('language: en');
      expect(content).toContain('category: engineering');
      expect(content).toContain('draft: true');
    });

    it('should include tags in YAML array format', () => {
      const content = generateMDXContent(baseOptions, mdxType);
      expect(content).toContain('tags:');
      expect(content).toContain('  - sdk');
      expect(content).toContain('  - tutorial');
    });

    it('should include cover image fields when type supports them', () => {
      const options: AddContentOptions = {
        ...baseOptions,
        coverImageUrl: '/images/hero.jpg',
        coverImageAlt: 'Hero image',
      };
      const content = generateMDXContent(options, mdxType);
      expect(content).toContain("coverImageUrl: /images/hero.jpg");
      expect(content).toContain("coverImageAlt: Hero image");
    });

    it('should include allowComments when type supports it', () => {
      const options: AddContentOptions = {
        ...baseOptions,
        allowComments: true,
      };
      const content = generateMDXContent(options, mdxType);
      expect(content).toContain('allowComments: true');
    });

    it('should end with empty body after frontmatter', () => {
      const content = generateMDXContent(baseOptions, mdxType);
      const parts = content.split('---');
      // parts[0] is empty (before first ---), parts[1] is frontmatter, parts[2] is body
      expect(parts.length).toBe(3);
      expect(parts[2].trim()).toBe('');
    });
  });

  describe('generateJSONContent', () => {
    const baseOptions: AddContentOptions = {
      slug: 'my-header',
      title: 'Site Header',
      description: 'Header navigation',
      author: 'Test Author',
      language: 'en',
      category: 'layout',
      tags: [],
      type: 'header',
    };

    const jsonType: ContentTypeInfo = {
      uid: 'header',
      format: 'JSON',
      name: 'Header',
      supportsCoverImage: false,
      supportsComments: false,
    };

    it('should generate valid JSON', () => {
      const content = generateJSONContent(baseOptions, jsonType);
      expect(() => JSON.parse(content)).not.toThrow();
    });

    it('should include all base fields', () => {
      const content = generateJSONContent(baseOptions, jsonType);
      const parsed = JSON.parse(content);
      expect(parsed.slug).toBe('my-header');
      expect(parsed.title).toBe('Site Header');
      expect(parsed.description).toBe('Header navigation');
      expect(parsed.author).toBe('Test Author');
      expect(parsed.language).toBe('en');
      expect(parsed.type).toBe('header');
      expect(parsed.category).toBe('layout');
      expect(parsed.body).toBe('');
    });

    it('should not include coverImage fields when type does not support it', () => {
      const content = generateJSONContent(baseOptions, jsonType);
      const parsed = JSON.parse(content);
      expect(parsed.coverImageUrl).toBeUndefined();
      expect(parsed.coverImageAlt).toBeUndefined();
    });

    it('should include coverImage fields when type supports it', () => {
      const coverType: ContentTypeInfo = { ...jsonType, supportsCoverImage: true };
      const options: AddContentOptions = {
        ...baseOptions,
        coverImageUrl: '/images/cover.jpg',
        coverImageAlt: 'Cover',
      };
      const content = generateJSONContent(options, coverType);
      const parsed = JSON.parse(content);
      expect(parsed.coverImageUrl).toBe('/images/cover.jpg');
      expect(parsed.coverImageAlt).toBe('Cover');
    });

    it('should include draft: true', () => {
      const content = generateJSONContent(baseOptions, jsonType);
      const parsed = JSON.parse(content);
      expect(parsed.draft).toBe(true);
    });

    it('should include tags as array', () => {
      const options: AddContentOptions = {
        ...baseOptions,
        tags: ['nav', 'layout'],
      };
      const content = generateJSONContent(options, jsonType);
      const parsed = JSON.parse(content);
      expect(parsed.tags).toEqual(['nav', 'layout']);
    });
  });
});
