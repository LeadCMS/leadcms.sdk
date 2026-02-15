/**
 * Tests for fetch-leadcms-content.ts - findAndDeleteContentFile and indexed deletion
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { jest } from '@jest/globals';
import { createTestConfig, createDataServiceMock, createAxiosMock } from './test-helpers';

jest.mock('../src/lib/config.js', () => ({
  getConfig: jest.fn(() => createTestConfig()),
}));

jest.mock('../src/lib/data-service.js', () => ({
  leadCMSDataService: createDataServiceMock({
    syncContent: jest.fn(() => Promise.resolve([])),
  }),
}));

jest.mock('axios', () => createAxiosMock());

import { findAndDeleteContentFile, buildContentIdIndex, deleteContentFilesById, extractContentId } from '../src/scripts/fetch-leadcms-content';

describe('findAndDeleteContentFile', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'leadcms-delete-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should delete MDX file with matching YAML frontmatter id', async () => {
    const filePath = path.join(tmpDir, 'article.mdx');
    await fs.writeFile(filePath, `---
title: Test Article
id: 42
type: article
---
# Content here`);

    await findAndDeleteContentFile(tmpDir, '42');

    await expect(fs.access(filePath)).rejects.toThrow();
  });

  it('should delete JSON file with matching id', async () => {
    const filePath = path.join(tmpDir, 'widget.json');
    await fs.writeFile(filePath, JSON.stringify({
      id: 99,
      title: 'Widget',
      type: 'component',
      body: '<div>Content</div>',
    }, null, 2));

    await findAndDeleteContentFile(tmpDir, '99');

    await expect(fs.access(filePath)).rejects.toThrow();
  });

  it('should not delete files with non-matching id', async () => {
    const filePath = path.join(tmpDir, 'article.mdx');
    await fs.writeFile(filePath, `---
title: Other Article
id: 100
type: article
---
# Other content`);

    await findAndDeleteContentFile(tmpDir, '42');

    // File should still exist
    await expect(fs.access(filePath)).resolves.toBeUndefined();
  });

  it('should recursively search subdirectories', async () => {
    const subDir = path.join(tmpDir, 'blog');
    await fs.mkdir(subDir, { recursive: true });
    const filePath = path.join(subDir, 'nested-article.mdx');
    await fs.writeFile(filePath, `---
title: Nested
id: 55
type: article
---
Content`);

    await findAndDeleteContentFile(tmpDir, '55');

    await expect(fs.access(filePath)).rejects.toThrow();
  });

  it('should handle YAML id with quoted value', async () => {
    const filePath = path.join(tmpDir, 'quoted.mdx');
    await fs.writeFile(filePath, `---
title: Quoted ID
id: '77'
type: article
---
Content`);

    await findAndDeleteContentFile(tmpDir, '77');

    await expect(fs.access(filePath)).rejects.toThrow();
  });

  it('should handle non-existent directory gracefully', async () => {
    // Should not throw
    await expect(
      findAndDeleteContentFile('/tmp/nonexistent-dir-abc123', '1')
    ).resolves.toBeUndefined();
  });

  it('should not delete files when id is a substring of another id', async () => {
    const filePath = path.join(tmpDir, 'article.mdx');
    // File has id: 100, searching for id: 10
    await fs.writeFile(filePath, `---
title: Article
id: 100
type: article
---
Content`);

    await findAndDeleteContentFile(tmpDir, '10');

    // The regex matches "10" followed by end-of-line, so id: 100 should NOT match
    // because after "10" there's still "0" before newline
    await expect(fs.access(filePath)).resolves.toBeUndefined();
  });

  it('should handle empty directory', async () => {
    await expect(
      findAndDeleteContentFile(tmpDir, '1')
    ).resolves.toBeUndefined();
  });

  it('should delete only matching file among multiple files', async () => {
    const keep = path.join(tmpDir, 'keep.mdx');
    const remove = path.join(tmpDir, 'remove.mdx');

    await fs.writeFile(keep, `---
title: Keep
id: 1
type: article
---
Content`);

    await fs.writeFile(remove, `---
title: Remove
id: 2
type: article
---
Content`);

    await findAndDeleteContentFile(tmpDir, '2');

    await expect(fs.access(keep)).resolves.toBeUndefined();
    await expect(fs.access(remove)).rejects.toThrow();
  });
});

describe('extractContentId', () => {
  it('should extract id from YAML frontmatter', () => {
    const content = `---\ntitle: Test\nid: 42\ntype: article\n---\n# Content`;
    expect(extractContentId(content)).toBe('42');
  });

  it('should extract id from JSON', () => {
    const content = JSON.stringify({ id: 99, title: 'Test' }, null, 2);
    expect(extractContentId(content)).toBe('99');
  });

  it('should extract quoted YAML id', () => {
    const content = `---\nid: '77'\ntype: article\n---\nContent`;
    expect(extractContentId(content)).toBe('77');
  });

  it('should return undefined for content without id', () => {
    const content = `---\ntitle: No ID\n---\nContent`;
    expect(extractContentId(content)).toBeUndefined();
  });

  it('should not match id as substring of another number', () => {
    // id: 100 should extract '100', not '10'
    const content = `---\nid: 100\ntype: article\n---\nContent`;
    expect(extractContentId(content)).toBe('100');
  });
});

describe('buildContentIdIndex', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'leadcms-index-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should index MDX files by their id', async () => {
    await fs.writeFile(path.join(tmpDir, 'article.mdx'), `---\nid: 42\ntitle: Test\n---\n# Content`);
    await fs.writeFile(path.join(tmpDir, 'page.mdx'), `---\nid: 55\ntitle: Page\n---\n# Page`);

    const index = await buildContentIdIndex(tmpDir);

    expect(index.get('42')).toEqual([path.join(tmpDir, 'article.mdx')]);
    expect(index.get('55')).toEqual([path.join(tmpDir, 'page.mdx')]);
    expect(index.size).toBe(2);
  });

  it('should index JSON files by their id', async () => {
    await fs.writeFile(path.join(tmpDir, 'widget.json'), JSON.stringify({ id: 99, title: 'Widget' }, null, 2));

    const index = await buildContentIdIndex(tmpDir);

    expect(index.get('99')).toEqual([path.join(tmpDir, 'widget.json')]);
  });

  it('should recursively index subdirectories', async () => {
    const subDir = path.join(tmpDir, 'es');
    await fs.mkdir(subDir, { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'article.mdx'), `---\nid: 1\n---\nEN`);
    await fs.writeFile(path.join(subDir, 'article.mdx'), `---\nid: 2\n---\nES`);

    const index = await buildContentIdIndex(tmpDir);

    expect(index.get('1')).toEqual([path.join(tmpDir, 'article.mdx')]);
    expect(index.get('2')).toEqual([path.join(subDir, 'article.mdx')]);
  });

  it('should skip files without an id', async () => {
    await fs.writeFile(path.join(tmpDir, 'no-id.mdx'), `---\ntitle: No ID\n---\nContent`);
    await fs.writeFile(path.join(tmpDir, 'has-id.mdx'), `---\nid: 10\n---\nContent`);

    const index = await buildContentIdIndex(tmpDir);

    expect(index.size).toBe(1);
    expect(index.get('10')).toBeDefined();
  });

  it('should handle empty directory', async () => {
    const index = await buildContentIdIndex(tmpDir);
    expect(index.size).toBe(0);
  });

  it('should handle non-existent directory gracefully', async () => {
    const index = await buildContentIdIndex('/tmp/nonexistent-dir-xyz-987');
    expect(index.size).toBe(0);
  });
});

describe('deleteContentFilesById', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'leadcms-delbyid-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should delete files using an indexed lookup', async () => {
    const filePath = path.join(tmpDir, 'article.mdx');
    await fs.writeFile(filePath, `---\nid: 42\n---\nContent`);

    const index = await buildContentIdIndex(tmpDir);
    expect(index.get('42')).toHaveLength(1);

    await deleteContentFilesById(index, '42');

    await expect(fs.access(filePath)).rejects.toThrow();
    // Index entry should be removed after deletion
    expect(index.has('42')).toBe(false);
  });

  it('should be a no-op for non-existent ids', async () => {
    await fs.writeFile(path.join(tmpDir, 'keep.mdx'), `---\nid: 1\n---\nContent`);

    const index = await buildContentIdIndex(tmpDir);
    await deleteContentFilesById(index, '999');

    // Original file should still exist
    await expect(fs.access(path.join(tmpDir, 'keep.mdx'))).resolves.toBeUndefined();
    expect(index.get('1')).toHaveLength(1);
  });

  it('should delete only the targeted id and leave others intact', async () => {
    const keep = path.join(tmpDir, 'keep.mdx');
    const remove = path.join(tmpDir, 'remove.mdx');
    await fs.writeFile(keep, `---\nid: 1\n---\nKeep`);
    await fs.writeFile(remove, `---\nid: 2\n---\nRemove`);

    const index = await buildContentIdIndex(tmpDir);
    await deleteContentFilesById(index, '2');

    await expect(fs.access(keep)).resolves.toBeUndefined();
    await expect(fs.access(remove)).rejects.toThrow();
    expect(index.get('1')).toHaveLength(1);
    expect(index.has('2')).toBe(false);
  });

  it('should handle batch deletions efficiently (no redundant filesystem walks)', async () => {
    // Simulate a larger sync: 5 files, delete 3 using the index
    for (let i = 1; i <= 5; i++) {
      await fs.writeFile(
        path.join(tmpDir, `item-${i}.mdx`),
        `---\nid: ${i}\ntitle: Item ${i}\n---\nContent ${i}`
      );
    }

    const index = await buildContentIdIndex(tmpDir);
    expect(index.size).toBe(5);

    // Delete items 2, 4, 5 using the index (no repeated directory walks)
    await deleteContentFilesById(index, '2');
    await deleteContentFilesById(index, '4');
    await deleteContentFilesById(index, '5');

    // Items 1 and 3 should still exist
    await expect(fs.access(path.join(tmpDir, 'item-1.mdx'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(tmpDir, 'item-3.mdx'))).resolves.toBeUndefined();

    // Items 2, 4, 5 should be gone
    await expect(fs.access(path.join(tmpDir, 'item-2.mdx'))).rejects.toThrow();
    await expect(fs.access(path.join(tmpDir, 'item-4.mdx'))).rejects.toThrow();
    await expect(fs.access(path.join(tmpDir, 'item-5.mdx'))).rejects.toThrow();

    // Index should reflect deletions
    expect(index.size).toBe(2);
  });
});
