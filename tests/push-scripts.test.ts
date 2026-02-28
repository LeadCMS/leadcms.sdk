/**
 * Tests for push-leadcms-content.ts pure functions
 * Covers: isLocaleDirectory, getLocalContentTypes, filterContentOperations, parseContentFile
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import matter from 'gray-matter';
import { jest } from '@jest/globals';
import { setVerbose } from '../src/lib/logger';
import { createTestConfig, createDataServiceMock } from './test-helpers';

jest.mock('../src/lib/config.js', () => ({
  getConfig: jest.fn(() => createTestConfig()),
}));

jest.mock('../src/lib/data-service.js', () => ({
  leadCMSDataService: createDataServiceMock(),
}));

import {
  isLocaleDirectory,
  getLocalContentTypes,
  filterContentOperations,
  parseContentFile,
} from '../src/scripts/push-leadcms-content';

describe('push-leadcms-content - Pure Functions', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'leadcms-push-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe('isLocaleDirectory', () => {
    it('should recognize two-letter language codes under CONTENT_DIR', async () => {
      const result = await (isLocaleDirectory as any)(
        '/tmp/test-content/en',
        '/tmp/test-content'
      );
      expect(result).toBe(true);
    });

    it('should recognize language codes with region like en-US', async () => {
      const result = await (isLocaleDirectory as any)(
        '/tmp/test-content/en-US',
        '/tmp/test-content'
      );
      expect(result).toBe(true);
    });

    it('should reject directories not directly under CONTENT_DIR', async () => {
      const result = await (isLocaleDirectory as any)(
        '/tmp/test-content/en/nested',
        '/tmp/test-content/en'
      );
      expect(result).toBe(false);
    });

    it('should reject non-locale directory names', async () => {
      const result = await (isLocaleDirectory as any)(
        '/tmp/test-content/articles',
        '/tmp/test-content'
      );
      expect(result).toBe(false);
    });

    it('should reject single-letter names', async () => {
      const result = await (isLocaleDirectory as any)(
        '/tmp/test-content/x',
        '/tmp/test-content'
      );
      expect(result).toBe(false);
    });

    it('should reject numeric names', async () => {
      const result = await (isLocaleDirectory as any)(
        '/tmp/test-content/123',
        '/tmp/test-content'
      );
      expect(result).toBe(false);
    });

    it('should handle three-letter language codes (e.g., deu)', async () => {
      const result = await (isLocaleDirectory as any)(
        '/tmp/test-content/deu',
        '/tmp/test-content'
      );
      // The regex is /^[a-z]{2}(-[A-Z]{2})?$/ so 3 letters don't match
      expect(result).toBe(false);
    });
  });

  describe('getLocalContentTypes', () => {
    it('should extract unique content types from local items', () => {
      const items = [
        { type: 'article' },
        { type: 'page' },
        { type: 'article' },
        { type: 'component' },
      ] as any[];

      const types = (getLocalContentTypes as any)(items);
      expect(types).toBeInstanceOf(Set);
      expect(types.size).toBe(3);
      expect(types.has('article')).toBe(true);
      expect(types.has('page')).toBe(true);
      expect(types.has('component')).toBe(true);
    });

    it('should return empty set for empty array', () => {
      const types = (getLocalContentTypes as any)([]);
      expect(types.size).toBe(0);
    });

    it('should skip items without type', () => {
      const items = [
        { type: 'article' },
        { type: '' },
        { type: undefined },
      ] as any[];

      const types = (getLocalContentTypes as any)(items);
      // Empty string is falsy, so only 'article' is included
      expect(types.has('article')).toBe(true);
    });

    it('should handle single-type collection', () => {
      const items = [
        { type: 'article' },
        { type: 'article' },
      ] as any[];

      const types = (getLocalContentTypes as any)(items);
      expect(types.size).toBe(1);
    });
  });

  describe('filterContentOperations', () => {
    const makeOp = (slug: string, localId?: number, remoteId?: number, oldSlug?: string) => ({
      local: {
        slug,
        metadata: { id: localId },
        filePath: `/tmp/${slug}.mdx`,
        locale: 'en',
        type: 'article',
        body: '',
        isLocal: true,
      },
      remote: remoteId ? { id: remoteId, slug } : undefined,
      oldSlug,
    });

    const baseOps = {
      create: [makeOp('new-article', undefined, undefined)],
      update: [makeOp('updated-article', 1, 1)],
      rename: [makeOp('renamed-article', 2, 2, 'old-name')],
      typeChange: [makeOp('type-changed', 3, 3)],
      conflict: [makeOp('conflicted', 4, 4)],
      delete: [],
    };

    it('should return all operations when no filter specified', () => {
      const result = (filterContentOperations as any)(baseOps, undefined, undefined);
      expect(result.create).toHaveLength(1);
      expect(result.update).toHaveLength(1);
      expect(result.rename).toHaveLength(1);
      expect(result.typeChange).toHaveLength(1);
      expect(result.conflict).toHaveLength(1);
    });

    it('should filter by target ID (local metadata id)', () => {
      const result = (filterContentOperations as any)(baseOps, '1', undefined);
      expect(result.update).toHaveLength(1);
      expect(result.create).toHaveLength(0);
      expect(result.rename).toHaveLength(0);
    });

    it('should filter by target ID (remote id)', () => {
      const result = (filterContentOperations as any)(baseOps, '3', undefined);
      expect(result.typeChange).toHaveLength(1);
      expect(result.update).toHaveLength(0);
    });

    it('should filter by target slug', () => {
      const result = (filterContentOperations as any)(baseOps, undefined, 'new-article');
      expect(result.create).toHaveLength(1);
      expect(result.update).toHaveLength(0);
    });

    it('should match oldSlug for renames', () => {
      const result = (filterContentOperations as any)(baseOps, undefined, 'old-name');
      expect(result.rename).toHaveLength(1);
      expect(result.update).toHaveLength(0);
    });

    it('should return empty arrays when nothing matches', () => {
      const result = (filterContentOperations as any)(baseOps, '999', undefined);
      expect(result.create).toHaveLength(0);
      expect(result.update).toHaveLength(0);
      expect(result.rename).toHaveLength(0);
      expect(result.typeChange).toHaveLength(0);
      expect(result.conflict).toHaveLength(0);
    });

    it('should handle delete operations in filter', () => {
      const opsWithDelete = {
        ...baseOps,
        delete: [makeOp('to-delete', 10, 10)],
      };
      const result = (filterContentOperations as any)(opsWithDelete, '10', undefined);
      expect(result.delete).toHaveLength(1);
    });

    it('should filter by remote ID when local metadata has no ID (JSON content without local id)', () => {
      // Simulates JSON content files that don't have an `id` field locally
      // but are matched to remote content by slug
      const opsWithRemoteOnlyId = {
        create: [],
        update: [makeOp('partners-logos', undefined, 121)],
        rename: [],
        typeChange: [],
        conflict: [],
        delete: [],
      };
      const result = (filterContentOperations as any)(opsWithRemoteOnlyId, '121', undefined);
      expect(result.update).toHaveLength(1);
      expect(result.update[0].remote.id).toBe(121);
    });

    it('should not match when neither local nor remote has the target ID', () => {
      const ops = {
        create: [makeOp('some-article', undefined, undefined)],
        update: [makeOp('other-article', undefined, 50)],
        rename: [],
        typeChange: [],
        conflict: [],
        delete: [],
      };
      const result = (filterContentOperations as any)(ops, '999', undefined);
      expect(result.create).toHaveLength(0);
      expect(result.update).toHaveLength(0);
    });
  });

  describe('parseContentFile', () => {
    it('should parse MDX file with frontmatter', async () => {
      const filePath = path.join(tmpDir, 'test-article.mdx');
      await fs.writeFile(filePath, matter.stringify('# Hello World', {
        title: 'Test Article',
        type: 'article',
        description: 'A test',
      }));

      const result = await (parseContentFile as any)(filePath, 'en', tmpDir);
      expect(result).not.toBeNull();
      expect(result.slug).toBe('test-article');
      expect(result.type).toBe('article');
      expect(result.metadata.title).toBe('Test Article');
      expect(result.locale).toBe('en');
      expect(result.filePath).toBe(filePath);
    });

    it('should parse JSON content file', async () => {
      const filePath = path.join(tmpDir, 'header.json');
      await fs.writeFile(filePath, JSON.stringify({
        title: 'Header',
        type: 'component',
        body: '{"key": "value"}',
      }));

      const result = await (parseContentFile as any)(filePath, 'en', tmpDir);
      expect(result).not.toBeNull();
      expect(result.slug).toBe('header');
      expect(result.type).toBe('component');
    });

    it('should preserve locale from parameter', async () => {
      const filePath = path.join(tmpDir, 'article.mdx');
      await fs.writeFile(filePath, matter.stringify('Contenido', {
        title: 'Artículo',
        type: 'article',
      }));

      const result = await (parseContentFile as any)(filePath, 'es', tmpDir);
      expect(result.locale).toBe('es');
    });

    it('should return null for unsupported file extensions', async () => {
      const filePath = path.join(tmpDir, 'readme.txt');
      await fs.writeFile(filePath, 'Just text');

      const result = await (parseContentFile as any)(filePath, 'en', tmpDir);
      expect(result).toBeNull();
    });

    it('should handle nested directory paths for slug', async () => {
      const subDir = path.join(tmpDir, 'blog');
      await fs.mkdir(subDir, { recursive: true });
      const filePath = path.join(subDir, 'my-post.mdx');
      await fs.writeFile(filePath, matter.stringify('Post content', {
        title: 'My Post',
        type: 'article',
      }));

      const result = await (parseContentFile as any)(filePath, 'en', tmpDir);
      expect(result).not.toBeNull();
      expect(result.slug).toBe('blog/my-post');
    });

    it('should warn when type is missing from metadata', async () => {
      setVerbose(true);
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => { });
      const filePath = path.join(tmpDir, 'no-type.mdx');
      await fs.writeFile(filePath, matter.stringify('Hello', {
        title: 'No Type',
      }));

      const result = await (parseContentFile as any)(filePath, 'en', tmpDir);
      expect(result).not.toBeNull();
      expect(result.type).toBeUndefined();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('missing a "type" property')
      );
      logSpy.mockRestore();
      setVerbose(false);
    });

    it('should extract body from JSON content', async () => {
      const filePath = path.join(tmpDir, 'widget.json');
      await fs.writeFile(filePath, JSON.stringify({
        title: 'Widget',
        type: 'component',
        body: '<div>Content</div>',
      }));

      const result = await (parseContentFile as any)(filePath, 'en', tmpDir);
      expect(result.body).toBe('<div>Content</div>');
      // body should not be in metadata
      expect(result.metadata.body).toBeUndefined();
    });

    it('should preserve id in metadata for JSON content with id field', async () => {
      const filePath = path.join(tmpDir, 'partners-logos.json');
      await fs.writeFile(filePath, JSON.stringify({
        id: 121,
        slug: 'partners-logos',
        type: 'component',
        title: 'Partners Logos',
        items: [{ logo: 'logo1.png' }],
      }));

      const result = await (parseContentFile as any)(filePath, 'ru-RU', tmpDir);
      expect(result).not.toBeNull();
      expect(result.metadata.id).toBe(121);
      expect(result.metadata.id?.toString()).toBe('121');
      expect(result.locale).toBe('ru-RU');
    });

    it('should handle JSON content without id field (component body only)', async () => {
      const filePath = path.join(tmpDir, 'header.json');
      await fs.writeFile(filePath, JSON.stringify({
        type: 'component',
        title: 'Header',
        logo: 'logo.png',
        navigation: [{ label: 'Home', href: '/' }],
      }));

      const result = await (parseContentFile as any)(filePath, 'en', tmpDir);
      expect(result).not.toBeNull();
      expect(result.metadata.id).toBeUndefined();
      expect(result.slug).toBe('header');
    });
  });
});
