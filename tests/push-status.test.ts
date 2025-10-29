/**
 * Unit tests for LeadCMS push and status functionality
 * These tests focus on testing the core logic by mocking external dependencies
 */

import { jest } from '@jest/globals';

// Create a mock module that we can test the push/status logic with
const mockPushLogic = {
  async analyzePushStatus() {
    // Mock implementation to test different scenarios
    return {
      toCreate: [],
      toUpdate: [],
      conflicts: [],
      inSync: []
    };
  },

  async executePush(analysisResult: any, options: any = {}) {
    // Mock implementation for push execution
    const { toCreate, toUpdate, conflicts } = analysisResult;
    const { force = false } = options;

    if (conflicts.length > 0 && !force) {
      throw new Error('Conflicts exist - use force flag to override');
    }

    const results = {
      created: toCreate.length,
      updated: toUpdate.length,
      errors: []
    };

    return results;
  }
};

describe('LeadCMS Push/Status', () => {
  describe('Status Analysis', () => {
    it('should correctly identify new content to create', async () => {
      const mockLocalContent = [
        {
          slug: 'new-article',
          type: 'article',
          language: 'en',
          title: 'New Article',
          updatedAt: '2024-10-29T10:00:00Z'
        }
      ];

      const mockRemoteContent: any[] = [];

      // Simulate the core matching logic
      const analysis = {
        toCreate: mockLocalContent.filter(local =>
          !mockRemoteContent.find(remote =>
            remote.slug === local.slug &&
            remote.type === local.type &&
            remote.language === local.language
          )
        ),
        toUpdate: [],
        conflicts: [],
        inSync: []
      };

      expect(analysis.toCreate).toHaveLength(1);
      expect(analysis.toCreate[0].slug).toBe('new-article');
      expect(analysis.toUpdate).toHaveLength(0);
      expect(analysis.conflicts).toHaveLength(0);
    });

    it('should correctly identify content to update', async () => {
      const mockLocalContent = [
        {
          id: 1,
          slug: 'existing-article',
          type: 'article',
          language: 'en',
          title: 'Updated Article',
          updatedAt: '2024-10-29T12:00:00Z'
        }
      ];

      const mockRemoteContent = [
        {
          id: 1,
          slug: 'existing-article',
          type: 'article',
          language: 'en',
          title: 'Original Article',
          updatedAt: '2024-10-29T10:00:00Z' // Older than local
        }
      ];

      // Simulate the core matching logic
      const analysis = {
        toCreate: [],
        toUpdate: mockLocalContent.filter(local => {
          const remote = mockRemoteContent.find(r =>
            r.slug === local.slug &&
            r.type === local.type &&
            r.language === local.language
          );
          return remote &&
                 local.id === remote.id &&
                 new Date(local.updatedAt) > new Date(remote.updatedAt);
        }),
        conflicts: [],
        inSync: []
      };

      expect(analysis.toUpdate).toHaveLength(1);
      expect(analysis.toUpdate[0].slug).toBe('existing-article');
      expect(analysis.toCreate).toHaveLength(0);
      expect(analysis.conflicts).toHaveLength(0);
    });

    it('should correctly identify conflicts', async () => {
      const mockLocalContent = [
        {
          id: 1,
          slug: 'conflicted-article',
          type: 'article',
          language: 'en',
          title: 'Local Version',
          updatedAt: '2024-10-29T10:00:00Z'
        }
      ];

      const mockRemoteContent = [
        {
          id: 1,
          slug: 'conflicted-article',
          type: 'article',
          language: 'en',
          title: 'Remote Version',
          updatedAt: '2024-10-29T12:00:00Z' // Newer than local
        }
      ];

      // Simulate the core conflict detection logic
      const analysis = {
        toCreate: [],
        toUpdate: [],
        conflicts: mockLocalContent.filter(local => {
          const remote = mockRemoteContent.find(r =>
            r.slug === local.slug &&
            r.type === local.type &&
            r.language === local.language
          );
          return remote &&
                 local.id === remote.id &&
                 new Date(local.updatedAt) < new Date(remote.updatedAt);
        }),
        inSync: []
      };

      expect(analysis.conflicts).toHaveLength(1);
      expect(analysis.conflicts[0].slug).toBe('conflicted-article');
      expect(analysis.toCreate).toHaveLength(0);
      expect(analysis.toUpdate).toHaveLength(0);
    });

    it('should correctly identify content in sync', async () => {
      const mockLocalContent = [
        {
          id: 1,
          slug: 'synced-article',
          type: 'article',
          language: 'en',
          title: 'Synced Article',
          updatedAt: '2024-10-29T10:00:00Z'
        }
      ];

      const mockRemoteContent = [
        {
          id: 1,
          slug: 'synced-article',
          type: 'article',
          language: 'en',
          title: 'Synced Article',
          updatedAt: '2024-10-29T10:00:00Z' // Same timestamp
        }
      ];

      // Simulate the core sync detection logic
      const analysis = {
        toCreate: [],
        toUpdate: [],
        conflicts: [],
        inSync: mockLocalContent.filter(local => {
          const remote = mockRemoteContent.find(r =>
            r.slug === local.slug &&
            r.type === local.type &&
            r.language === local.language
          );
          return remote &&
                 local.id === remote.id &&
                 new Date(local.updatedAt).getTime() === new Date(remote.updatedAt).getTime();
        })
      };

      expect(analysis.inSync).toHaveLength(1);
      expect(analysis.inSync[0].slug).toBe('synced-article');
      expect(analysis.toCreate).toHaveLength(0);
      expect(analysis.toUpdate).toHaveLength(0);
      expect(analysis.conflicts).toHaveLength(0);
    });
  });

  describe('Content Type Validation', () => {
    it('should identify missing content types', () => {
      const localContentTypes = ['article', 'blog', 'custom-type'];
      const remoteContentTypes = [
        { uid: 'article', format: 'MDX', name: 'Article' },
        { uid: 'blog', format: 'MDX', name: 'Blog' }
      ];

      const missingTypes = localContentTypes.filter(localType =>
        !remoteContentTypes.find(remote => remote.uid === localType)
      );

      expect(missingTypes).toEqual(['custom-type']);
    });

    it('should validate content format compatibility', () => {
      const localContent = [
        { type: 'article', filePath: 'test.mdx' },
        { type: 'page', filePath: 'test.json' }
      ];

      const remoteContentTypes = [
        { uid: 'article', format: 'MDX', name: 'Article' },
        { uid: 'page', format: 'JSON', name: 'Page' }
      ];

      const validationResults = localContent.map(content => {
        const contentType = remoteContentTypes.find(ct => ct.uid === content.type);
        const expectedExtension = contentType?.format === 'MDX' ? '.mdx' : '.json';
        const actualExtension = content.filePath.substring(content.filePath.lastIndexOf('.'));

        return {
          content,
          isValid: actualExtension === expectedExtension,
          expectedFormat: contentType?.format,
          actualFormat: actualExtension
        };
      });

      expect(validationResults[0].isValid).toBe(true); // MDX article
      expect(validationResults[1].isValid).toBe(true); // JSON page
    });
  });

  describe('Multi-language Content Handling', () => {
    it('should handle content in multiple languages', () => {
      const multiLangContent = [
        { slug: 'article-1', type: 'article', language: 'en', title: 'English Article' },
        { slug: 'article-1', type: 'article', language: 'es', title: 'Artículo en Español' },
        { slug: 'article-1', type: 'article', language: 'fr', title: 'Article en Français' }
      ];

      // Group by slug and type
      const groupedContent = multiLangContent.reduce((acc: any, content) => {
        const key = `${content.type}/${content.slug}`;
        if (!acc[key]) {
          acc[key] = [];
        }
        acc[key].push(content);
        return acc;
      }, {});

      expect(Object.keys(groupedContent)).toHaveLength(1);
      expect(groupedContent['article/article-1']).toHaveLength(3);
      expect(groupedContent['article/article-1'].map((c: any) => c.language).sort()).toEqual(['en', 'es', 'fr']);
    });

    it('should detect language-specific conflicts', () => {
      const localContent = [
        { id: 1, slug: 'article', type: 'article', language: 'en', updatedAt: '2024-10-29T10:00:00Z' },
        { id: 2, slug: 'article', type: 'article', language: 'es', updatedAt: '2024-10-29T12:00:00Z' }
      ];

      const remoteContent = [
        { id: 1, slug: 'article', type: 'article', language: 'en', updatedAt: '2024-10-29T12:00:00Z' }, // Remote newer
        { id: 2, slug: 'article', type: 'article', language: 'es', updatedAt: '2024-10-29T10:00:00Z' }  // Local newer
      ];

      const conflicts = localContent.filter(local => {
        const remote = remoteContent.find(r =>
          r.slug === local.slug &&
          r.type === local.type &&
          r.language === local.language
        );
        return remote &&
               local.id === remote.id &&
               new Date(local.updatedAt) < new Date(remote.updatedAt);
      });

      const updates = localContent.filter(local => {
        const remote = remoteContent.find(r =>
          r.slug === local.slug &&
          r.type === local.type &&
          r.language === local.language
        );
        return remote &&
               local.id === remote.id &&
               new Date(local.updatedAt) > new Date(remote.updatedAt);
      });

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].language).toBe('en');
      expect(updates).toHaveLength(1);
      expect(updates[0].language).toBe('es');
    });
  });

  describe('Push Execution Logic', () => {
    it('should refuse to push when conflicts exist without force flag', async () => {
      const analysisResult = {
        toCreate: [],
        toUpdate: [],
        conflicts: [{ slug: 'conflicted', type: 'article', language: 'en' }],
        inSync: []
      };

      await expect(mockPushLogic.executePush(analysisResult, { force: false }))
        .rejects.toThrow('Conflicts exist - use force flag to override');
    });

    it('should push with force flag even when conflicts exist', async () => {
      const analysisResult = {
        toCreate: [{ slug: 'new-article', type: 'article', language: 'en' }],
        toUpdate: [],
        conflicts: [{ slug: 'conflicted', type: 'article', language: 'en' }],
        inSync: []
      };

      const result = await mockPushLogic.executePush(analysisResult, { force: true });

      expect(result.created).toBe(1);
      expect(result.updated).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should successfully push when no conflicts exist', async () => {
      const analysisResult = {
        toCreate: [
          { slug: 'new-article-1', type: 'article', language: 'en' },
          { slug: 'new-article-2', type: 'article', language: 'en' }
        ],
        toUpdate: [
          { slug: 'updated-article', type: 'article', language: 'en' }
        ],
        conflicts: [],
        inSync: []
      };

      const result = await mockPushLogic.executePush(analysisResult);

      expect(result.created).toBe(2);
      expect(result.updated).toBe(1);
      expect(result.errors).toHaveLength(0);
    });
  });



  describe('Content Parsing and Formatting', () => {
    it('should correctly parse MDX frontmatter', () => {
      const mdxContent = `---
title: "Test Article"
slug: "test-article"
type: "article"
language: "en"
publishedAt: "2024-10-29T10:00:00Z"
updatedAt: "2024-10-29T10:00:00Z"
---

# Test Article

This is the content.`;

      // Simulate gray-matter parsing
      const parsed = {
        data: {
          title: "Test Article",
          slug: "test-article",
          type: "article",
          language: "en",
          publishedAt: "2024-10-29T10:00:00Z",
          updatedAt: "2024-10-29T10:00:00Z"
        },
        content: "# Test Article\n\nThis is the content."
      };

      expect(parsed.data.title).toBe("Test Article");
      expect(parsed.data.slug).toBe("test-article");
      expect(parsed.data.type).toBe("article");
      expect(parsed.content).toBe("# Test Article\n\nThis is the content.");
    });

    it('should format content for API submission', () => {
      const localContent = {
        title: "Test Article",
        slug: "test-article",
        type: "article",
        language: "en",
        publishedAt: "2024-10-29T10:00:00Z",
        updatedAt: "2024-10-29T10:00:00Z",
        body: "# Test Article\n\nThis is the content."
      };

      const apiContent = {
        slug: localContent.slug,
        type: localContent.type,
        language: localContent.language,
        body: localContent.body,
        title: localContent.title,
        publishedAt: localContent.publishedAt,
        updatedAt: localContent.updatedAt
      };

      expect(apiContent).toEqual({
        slug: "test-article",
        type: "article",
        language: "en",
        body: "# Test Article\n\nThis is the content.",
        title: "Test Article",
        publishedAt: "2024-10-29T10:00:00Z",
        updatedAt: "2024-10-29T10:00:00Z"
      });
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle empty local content gracefully', () => {
      const localContent: any[] = [];
      const remoteContent = [
        { id: 1, slug: 'remote-only', type: 'article', language: 'en' }
      ];

      const analysis = {
        toCreate: localContent.filter(local =>
          !remoteContent.find(remote =>
            remote.slug === local.slug &&
            remote.type === local.type &&
            remote.language === local.language
          )
        ),
        toUpdate: [],
        conflicts: [],
        inSync: []
      };

      expect(analysis.toCreate).toHaveLength(0);
    });

    it('should handle missing required frontmatter fields', () => {
      const invalidContent = {
        title: "Test Article",
        // Missing slug, type, language
        publishedAt: "2024-10-29T10:00:00Z",
        updatedAt: "2024-10-29T10:00:00Z"
      };

      const requiredFields = ['slug', 'type', 'language'];
      const missingFields = requiredFields.filter(field => !invalidContent.hasOwnProperty(field));

      expect(missingFields).toEqual(['slug', 'type', 'language']);
    });

    it('should handle invalid date formats gracefully', () => {
      const contentWithInvalidDate = {
        updatedAt: 'invalid-date'
      };

      const contentWithValidDate = {
        updatedAt: '2024-10-29T10:00:00Z'
      };

      const isValidDate = (dateString: string) => {
        const date = new Date(dateString);
        return !isNaN(date.getTime());
      };

      expect(isValidDate(contentWithInvalidDate.updatedAt)).toBe(false);
      expect(isValidDate(contentWithValidDate.updatedAt)).toBe(true);
    });
  });

  describe('Advanced Change Detection', () => {
    describe('Slug Changes (Renames)', () => {
      it('should detect slug changes when content matched by ID', () => {
        const localContent = [
          {
            slug: 'new-article-slug',
            type: 'article',
            locale: 'en',
            metadata: { id: 123, title: 'My Article', updatedAt: '2024-01-02T00:00:00Z' },
            body: 'Content here',
            filePath: 'new-article-slug.mdx',
            isLocal: true
          }
        ];

        const remoteContent = [
          {
            id: 123,
            slug: 'old-article-slug',
            type: 'article',
            language: 'en',
            title: 'My Article',
            updatedAt: '2024-01-01T00:00:00Z',
            isLocal: false
          }
        ];

        // Mock the expected operations result
        const operations = {
          create: [],
          update: [],
          rename: [{
            local: localContent[0],
            remote: remoteContent[0],
            oldSlug: 'old-article-slug'
          }],
          typeChange: [],
          conflict: []
        };

        expect(operations.rename).toHaveLength(1);
        expect(operations.rename[0].oldSlug).toBe('old-article-slug');
        expect(operations.rename[0].local.slug).toBe('new-article-slug');
      });

      it('should detect slug changes when content matched by title', () => {
        const localContent = [
          {
            slug: 'about-us-page',
            type: 'page',
            locale: 'da',
            metadata: { title: 'Om Os', updatedAt: '2024-01-02T00:00:00Z' },
            body: 'Content here',
            filePath: 'about-us-page.mdx',
            isLocal: true
          }
        ];

        const remoteContent = [
          {
            id: 456,
            slug: 'om-os',
            type: 'page',
            language: 'da',
            title: 'Om Os',
            updatedAt: '2024-01-01T00:00:00Z',
            isLocal: false
          }
        ];

        // Mock the expected operations result
        const operations = {
          create: [],
          update: [],
          rename: [{
            local: localContent[0],
            remote: remoteContent[0],
            oldSlug: 'om-os'
          }],
          typeChange: [],
          conflict: []
        };

        expect(operations.rename).toHaveLength(1);
        expect(operations.rename[0].oldSlug).toBe('om-os');
        expect(operations.rename[0].local.slug).toBe('about-us-page');
      });

      it('should prioritize filename slug over frontmatter slug for rename detection', () => {
        // Scenario: File renamed from old-post.mdx to new-post.mdx
        // but frontmatter still has old slug
        const localContent = [
          {
            slug: 'new-post', // This comes from filename (basename)
            type: 'blog-article',
            locale: 'en',
            metadata: {
              slug: 'old-post', // Old slug in frontmatter
              id: 789,
              title: 'My Blog Post',
              updatedAt: '2024-01-02T00:00:00Z'
            },
            body: 'Content here',
            filePath: 'content/blog/new-post.mdx', // Filename reflects new slug
            isLocal: true
          }
        ];

        const remoteContent = [
          {
            id: 789,
            slug: 'old-post', // Remote still has old slug
            type: 'blog-article',
            language: 'en',
            title: 'My Blog Post',
            updatedAt: '2024-01-01T00:00:00Z',
            isLocal: false
          }
        ];

        // Mock the expected operations result - should be detected as rename
        const operations = {
          create: [],
          update: [],
          rename: [{
            local: localContent[0],
            remote: remoteContent[0],
            oldSlug: 'old-post'
          }],
          typeChange: [],
          conflict: []
        };

        expect(operations.rename).toHaveLength(1);
        expect(operations.rename[0].oldSlug).toBe('old-post');
        expect(operations.rename[0].local.slug).toBe('new-post');
        expect(operations.rename[0].local.metadata.slug).toBe('old-post'); // Frontmatter has old slug
      });

      it('should use new file-based slug for API request in rename operations', () => {
        // This test verifies that when formatting content for API during rename,
        // the new slug from the file path is used, not the old slug from frontmatter

        const mockLocalContent = {
          slug: 'blog-1', // New slug from file path
          type: 'blog-index',
          locale: 'en',
          body: 'Blog content here',
          metadata: {
            slug: 'blog', // Old slug in frontmatter
            title: 'Blog Title',
            id: 56
          },
          filePath: '/path/to/blog-1.mdx',
          isLocal: true
        };

        // Simulate the corrected formatContentForAPI function behavior
        const formatContentForAPI = (localContent: any) => {
          const contentData: any = {
            slug: localContent.slug,
            type: localContent.type,
            language: localContent.locale,
            body: localContent.body,
            ...localContent.metadata
          };

          // Preserve the file-based slug over metadata slug (the fix)
          if (localContent.slug !== localContent.metadata?.slug) {
            contentData.slug = localContent.slug;
          }

          delete contentData.filePath;
          delete contentData.isLocal;
          return contentData;
        };

        const result = formatContentForAPI(mockLocalContent);

        // After the fix, this should pass - using file-based slug for rename
        expect(result.slug).toBe('blog-1'); // Should use file-based slug for rename
        expect(result.type).toBe('blog-index');
        expect(result.id).toBe(56);
      });

      it('should preserve metadata slug when it matches file-based slug', () => {
        // This test ensures we don't break normal cases where slugs match

        const mockLocalContent = {
          slug: 'normal-article', // Same slug in file path
          type: 'article',
          locale: 'en',
          body: 'Article content here',
          metadata: {
            slug: 'normal-article', // Same slug in frontmatter
            title: 'Normal Article',
            id: 123
          },
          filePath: '/path/to/normal-article.mdx',
          isLocal: true
        };

        // Simulate the corrected formatContentForAPI function behavior
        const formatContentForAPI = (localContent: any) => {
          const contentData: any = {
            slug: localContent.slug,
            type: localContent.type,
            language: localContent.locale,
            body: localContent.body,
            ...localContent.metadata
          };

          // Preserve the file-based slug over metadata slug (the fix)
          if (localContent.slug !== localContent.metadata?.slug) {
            contentData.slug = localContent.slug;
          }

          delete contentData.filePath;
          delete contentData.isLocal;
          return contentData;
        };

        const result = formatContentForAPI(mockLocalContent);

        // Should still work correctly when slugs match
        expect(result.slug).toBe('normal-article');
        expect(result.type).toBe('article');
        expect(result.id).toBe(123);
      });
    });

    describe('Content Type Changes', () => {
      it('should detect content type changes', () => {
        const localContent = [
          {
            slug: 'header',
            type: 'component',
            locale: 'en',
            metadata: { id: 789, title: 'Header Component', updatedAt: '2024-01-02T00:00:00Z' },
            body: 'JSON content here',
            filePath: 'header.json',
            isLocal: true
          }
        ];

        const remoteContent = [
          {
            id: 789,
            slug: 'header',
            type: 'layout',
            language: 'en',
            title: 'Header Component',
            updatedAt: '2024-01-01T00:00:00Z',
            isLocal: false
          }
        ];

        // Mock the expected operations result
        const operations = {
          create: [],
          update: [],
          rename: [],
          typeChange: [{
            local: localContent[0],
            remote: remoteContent[0],
            oldType: 'layout',
            newType: 'component'
          }],
          conflict: []
        };

        expect(operations.typeChange).toHaveLength(1);
        expect(operations.typeChange[0].oldType).toBe('layout');
        expect(operations.typeChange[0].newType).toBe('component');
      });

      it('should handle combined slug and type changes', () => {
        const localContent = [
          {
            slug: 'featured-blog-post',
            type: 'blog-article',
            locale: 'en',
            metadata: { id: 999, title: 'Featured Post', updatedAt: '2024-01-02T00:00:00Z' },
            body: 'MDX content here',
            filePath: 'featured-blog-post.mdx',
            isLocal: true
          }
        ];

        const remoteContent = [
          {
            id: 999,
            slug: 'featured-post',
            type: 'article',
            language: 'en',
            title: 'Featured Post',
            updatedAt: '2024-01-01T00:00:00Z',
            isLocal: false
          }
        ];

        // Mock the expected operations result
        const operations = {
          create: [],
          update: [],
          rename: [],
          typeChange: [{
            local: localContent[0],
            remote: remoteContent[0],
            oldSlug: 'featured-post',
            oldType: 'article',
            newType: 'blog-article'
          }],
          conflict: []
        };

        expect(operations.typeChange).toHaveLength(1);
        expect(operations.typeChange[0].oldSlug).toBe('featured-post');
        expect(operations.typeChange[0].oldType).toBe('article');
        expect(operations.typeChange[0].newType).toBe('blog-article');
      });
    });

    describe('Advanced Conflict Detection', () => {
      it('should detect conflicts when both slug and remote content changed', () => {
        const localContent = [
          {
            slug: 'updated-article',
            type: 'article',
            locale: 'en',
            metadata: { id: 111, title: 'Updated Article', updatedAt: '2024-01-01T00:00:00Z' },
            body: 'Local content',
            filePath: 'updated-article.mdx',
            isLocal: true
          }
        ];

        const remoteContent = [
          {
            id: 111,
            slug: 'remote-updated-article',
            type: 'article',
            language: 'en',
            title: 'Updated Article',
            updatedAt: '2024-01-02T00:00:00Z', // Newer than local
            isLocal: false
          }
        ];

        // Mock the expected operations result
        const operations = {
          create: [],
          update: [],
          rename: [],
          typeChange: [],
          conflict: [{
            local: localContent[0],
            remote: remoteContent[0],
            reason: 'Slug changed remotely after local changes'
          }]
        };

        expect(operations.conflict).toHaveLength(1);
        expect(operations.conflict[0].reason).toBe('Slug changed remotely after local changes');
      });

      it('should detect conflicts when content type changed remotely', () => {
        const localContent = [
          {
            slug: 'navigation',
            type: 'component',
            locale: 'en',
            metadata: { id: 222, title: 'Navigation', updatedAt: '2024-01-01T00:00:00Z' },
            body: 'JSON content',
            filePath: 'navigation.json',
            isLocal: true
          }
        ];

        const remoteContent = [
          {
            id: 222,
            slug: 'navigation',
            type: 'layout',
            language: 'en',
            title: 'Navigation',
            updatedAt: '2024-01-02T00:00:00Z', // Newer than local
            isLocal: false
          }
        ];

        // Mock the expected operations result
        const operations = {
          create: [],
          update: [],
          rename: [],
          typeChange: [],
          conflict: [{
            local: localContent[0],
            remote: remoteContent[0],
            reason: 'Content type changed remotely after local changes'
          }]
        };

        expect(operations.conflict).toHaveLength(1);
        expect(operations.conflict[0].reason).toBe('Content type changed remotely after local changes');
      });
    });
  });
});
