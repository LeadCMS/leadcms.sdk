/**
 * Tests for post-upload media reconciliation.
 *
 * When media files are uploaded/updated, the CMS server may:
 *   1. Rename the file (UPPERCASE → lowercase, slugification)
 *   2. Change extension (.png → .avif due to optimization)
 *   3. Change file size (optimization/compression)
 *
 * The SDK must read the API response and reconcile local files:
 *   - If name changed: delete old local file, download new version
 *   - If extension changed: delete old local file, download new version
 *   - If size changed: download new version (overwrite)
 *
 * These tests use a real temp filesystem and mock only the API layer.
 *
 * TDD: Tests written before implementation.
 */

import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import FormData from 'form-data';
import {
  pushMedia,
  executeMediaPush,
  matchMediaFiles,
  reconcileLocalFile,
  type LocalMediaFile,
  type MediaOperation,
  type MediaDependencies,
} from '../src/scripts/push-media';
import type { MediaItem } from '../src/lib/data-service';

// ── Temp directory for isolation ───────────────────────────────────────
const tmpRoot = path.join(os.tmpdir(), 'leadcms-media-reconcile');
let mediaDir: string;

beforeEach(async () => {
  mediaDir = path.join(tmpRoot, `run-${Date.now()}`);
  await fsPromises.mkdir(mediaDir, { recursive: true });
});

afterEach(async () => {
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

// ── Helper: create a local media file ──────────────────────────────────
async function createLocalFile(
  relPath: string,
  content: string | Buffer = 'fake-image-data'
): Promise<string> {
  const fullPath = path.join(mediaDir, relPath);
  await fsPromises.mkdir(path.dirname(fullPath), { recursive: true });
  await fsPromises.writeFile(fullPath, content);
  return fullPath;
}

// ── Helper: check file exists ──────────────────────────────────────────
async function fileExists(relPath: string): Promise<boolean> {
  try {
    await fsPromises.access(path.join(mediaDir, relPath));
    return true;
  } catch {
    return false;
  }
}

// ── Helper: check file exists with exact case (important for case-insensitive FS)
async function fileExistsExactCase(relPath: string): Promise<boolean> {
  const fullPath = path.join(mediaDir, relPath);
  const dir = path.dirname(fullPath);
  const basename = path.basename(fullPath);
  try {
    const entries = await fsPromises.readdir(dir);
    return entries.includes(basename);
  } catch {
    return false;
  }
}

// ── Helper: read file content ──────────────────────────────────────────
async function readLocalFile(relPath: string): Promise<string> {
  return fsPromises.readFile(path.join(mediaDir, relPath), 'utf8');
}

// ════════════════════════════════════════════════════════════════════════
//  reconcileLocalFile — unit tests
// ════════════════════════════════════════════════════════════════════════

describe('reconcileLocalFile', () => {
  it('should do nothing when server name matches local name exactly', async () => {
    await createLocalFile('blog/hero.jpg', 'original-data');

    const local: LocalMediaFile = {
      filePath: 'blog/hero.jpg',
      absolutePath: path.join(mediaDir, 'blog/hero.jpg'),
      scopeUid: 'blog',
      name: 'hero.jpg',
      size: 14,
      extension: '.jpg',
      mimeType: 'image/jpeg',
    };

    const serverResponse: MediaItem = {
      id: 1,
      location: '/api/media/blog/hero.jpg',
      scopeUid: 'blog',
      name: 'hero.jpg',
      size: 14,
      extension: '.jpg',
      mimeType: 'image/jpeg',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: null,
    };

    const downloadFn = jest.fn().mockResolvedValue(Buffer.from('new-data'));

    const result = await reconcileLocalFile(local, serverResponse, mediaDir, downloadFn);

    expect(result.changed).toBe(false);
    expect(downloadFn).not.toHaveBeenCalled();
    // Original file untouched
    expect(await readLocalFile('blog/hero.jpg')).toBe('original-data');
  });

  it('should rename local file when server lowercases the name', async () => {
    await createLocalFile('img/cases/Neural-Network-Image.webp', 'original-data');

    const local: LocalMediaFile = {
      filePath: 'img/cases/Neural-Network-Image.webp',
      absolutePath: path.join(mediaDir, 'img/cases/Neural-Network-Image.webp'),
      scopeUid: 'img/cases',
      name: 'Neural-Network-Image.webp',
      size: 13,
      extension: '.webp',
      mimeType: 'image/webp',
    };

    const serverResponse: MediaItem = {
      id: 2,
      location: '/api/media/img/cases/neural-network-image.webp',
      scopeUid: 'img/cases',
      name: 'neural-network-image.webp',
      size: 13,
      extension: '.webp',
      mimeType: 'image/webp',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: null,
    };

    const downloadFn = jest.fn().mockResolvedValue(Buffer.from('original-data'));

    const result = await reconcileLocalFile(local, serverResponse, mediaDir, downloadFn);

    expect(result.changed).toBe(true);
    expect(result.reason).toContain('name');
    // Old file should be gone (use exact case check for case-insensitive FS)
    expect(await fileExistsExactCase('img/cases/Neural-Network-Image.webp')).toBe(false);
    // New file should exist with server's name
    expect(await fileExistsExactCase('img/cases/neural-network-image.webp')).toBe(true);
  });

  it('should replace local file when server changes extension (optimization)', async () => {
    await createLocalFile('blog/photo.png', 'original-png-data');

    const local: LocalMediaFile = {
      filePath: 'blog/photo.png',
      absolutePath: path.join(mediaDir, 'blog/photo.png'),
      scopeUid: 'blog',
      name: 'photo.png',
      size: 16,
      extension: '.png',
      mimeType: 'image/png',
    };

    const serverResponse: MediaItem = {
      id: 3,
      location: '/api/media/blog/photo.avif',
      scopeUid: 'blog',
      name: 'photo.avif',
      size: 8,
      extension: '.avif',
      mimeType: 'image/avif',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: null,
    };

    const downloadFn = jest.fn().mockResolvedValue(Buffer.from('optimized-avif-data'));

    const result = await reconcileLocalFile(local, serverResponse, mediaDir, downloadFn);

    expect(result.changed).toBe(true);
    expect(result.reason).toContain('extension');
    // Old .png file should be deleted
    expect(await fileExists('blog/photo.png')).toBe(false);
    // New .avif file should exist with downloaded content
    expect(await fileExists('blog/photo.avif')).toBe(true);
    const content = await readLocalFile('blog/photo.avif');
    expect(content).toBe('optimized-avif-data');
    expect(downloadFn).toHaveBeenCalledTimes(1);
  });

  it('should re-download when server reports different size (optimization)', async () => {
    await createLocalFile('blog/large.jpg', 'large-original-content');

    const local: LocalMediaFile = {
      filePath: 'blog/large.jpg',
      absolutePath: path.join(mediaDir, 'blog/large.jpg'),
      scopeUid: 'blog',
      name: 'large.jpg',
      size: 22,
      extension: '.jpg',
      mimeType: 'image/jpeg',
    };

    const serverResponse: MediaItem = {
      id: 4,
      location: '/api/media/blog/large.jpg',
      scopeUid: 'blog',
      name: 'large.jpg',
      size: 10, // Server optimized the image
      extension: '.jpg',
      mimeType: 'image/jpeg',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: null,
    };

    const downloadFn = jest.fn().mockResolvedValue(Buffer.from('optimized'));

    const result = await reconcileLocalFile(local, serverResponse, mediaDir, downloadFn);

    expect(result.changed).toBe(true);
    expect(result.reason).toContain('size');
    // File should be overwritten with server version
    expect(await fileExists('blog/large.jpg')).toBe(true);
    const content = await readLocalFile('blog/large.jpg');
    expect(content).toBe('optimized');
    expect(downloadFn).toHaveBeenCalledTimes(1);
  });

  it('should handle simultaneous name change + extension change + size change', async () => {
    await createLocalFile('img/My-Photo.PNG', 'raw-png-data');

    const local: LocalMediaFile = {
      filePath: 'img/My-Photo.PNG',
      absolutePath: path.join(mediaDir, 'img/My-Photo.PNG'),
      scopeUid: 'img',
      name: 'My-Photo.PNG',
      size: 12,
      extension: '.PNG',
      mimeType: 'image/png',
    };

    const serverResponse: MediaItem = {
      id: 5,
      location: '/api/media/img/my-photo.avif',
      scopeUid: 'img',
      name: 'my-photo.avif',
      size: 5,
      extension: '.avif',
      mimeType: 'image/avif',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: null,
    };

    const downloadFn = jest.fn().mockResolvedValue(Buffer.from('avif'));

    const result = await reconcileLocalFile(local, serverResponse, mediaDir, downloadFn);

    expect(result.changed).toBe(true);
    // Old file gone
    expect(await fileExists('img/My-Photo.PNG')).toBe(false);
    // New file present
    expect(await fileExists('img/my-photo.avif')).toBe(true);
    expect(await readLocalFile('img/my-photo.avif')).toBe('avif');
  });
});

// ════════════════════════════════════════════════════════════════════════
//  matchMediaFiles — case-insensitive matching
// ════════════════════════════════════════════════════════════════════════

describe('matchMediaFiles: case-insensitive matching', () => {
  it('should match files with different cases as the same file (skip, not create)', () => {
    const localFiles: LocalMediaFile[] = [
      {
        scopeUid: 'img/cases',
        name: 'Neural-Network-Image.webp',
        size: 5000,
        filePath: 'img/cases/Neural-Network-Image.webp',
        absolutePath: '/media/img/cases/Neural-Network-Image.webp',
        extension: '.webp',
        mimeType: 'image/webp',
      },
    ];

    const remoteFiles: MediaItem[] = [
      {
        id: 1,
        scopeUid: 'img/cases',
        name: 'neural-network-image.webp',
        size: 5000,
        location: '/api/media/img/cases/neural-network-image.webp',
        extension: '.webp',
        mimeType: 'image/webp',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: null,
      },
    ];

    const operations = matchMediaFiles(localFiles, remoteFiles);

    // Should NOT be "create" — should be "skip" since it's the same file
    const creates = operations.filter(op => op.type === 'create');
    expect(creates).toHaveLength(0);

    const skips = operations.filter(op => op.type === 'skip');
    expect(skips).toHaveLength(1);
  });

  it('should detect size change even when names differ only in case', () => {
    const localFiles: LocalMediaFile[] = [
      {
        scopeUid: 'blog',
        name: 'Hero-Image.jpg',
        size: 50000,
        filePath: 'blog/Hero-Image.jpg',
        absolutePath: '/media/blog/Hero-Image.jpg',
        extension: '.jpg',
        mimeType: 'image/jpeg',
      },
    ];

    const remoteFiles: MediaItem[] = [
      {
        id: 1,
        scopeUid: 'blog',
        name: 'hero-image.jpg',
        size: 30000,
        location: '/api/media/blog/hero-image.jpg',
        extension: '.jpg',
        mimeType: 'image/jpeg',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: null,
      },
    ];

    const operations = matchMediaFiles(localFiles, remoteFiles);

    const updates = operations.filter(op => op.type === 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0].reason).toContain('size');
  });

  it('should not double-count: file matched case-insensitively should not also appear as delete', () => {
    const localFiles: LocalMediaFile[] = [
      {
        scopeUid: 'blog',
        name: 'Photo.JPG',
        size: 10000,
        filePath: 'blog/Photo.JPG',
        absolutePath: '/media/blog/Photo.JPG',
        extension: '.JPG',
        mimeType: 'image/jpeg',
      },
    ];

    const remoteFiles: MediaItem[] = [
      {
        id: 1,
        scopeUid: 'blog',
        name: 'photo.jpg',
        size: 10000,
        location: '/api/media/blog/photo.jpg',
        extension: '.jpg',
        mimeType: 'image/jpeg',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: null,
      },
    ];

    const operations = matchMediaFiles(localFiles, remoteFiles, true);

    const deletes = operations.filter(op => op.type === 'delete');
    expect(deletes).toHaveLength(0);

    const creates = operations.filter(op => op.type === 'create');
    expect(creates).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════
//  executeMediaPush — post-upload reconciliation integration
// ════════════════════════════════════════════════════════════════════════

describe('executeMediaPush: post-upload reconciliation', () => {
  it('should rename local file after upload when server lowercases the name', async () => {
    const originalPath = await createLocalFile(
      'img/cases/Neural-Network.webp', 'image-content'
    );

    const local: LocalMediaFile = {
      filePath: 'img/cases/Neural-Network.webp',
      absolutePath: originalPath,
      scopeUid: 'img/cases',
      name: 'Neural-Network.webp',
      size: 13,
      extension: '.webp',
      mimeType: 'image/webp',
    };

    const serverResponse: MediaItem = {
      id: 10,
      location: '/api/media/img/cases/neural-network.webp',
      scopeUid: 'img/cases',
      name: 'neural-network.webp',
      size: 13,
      extension: '.webp',
      mimeType: 'image/webp',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: null,
    };

    const mockUpload = jest.fn().mockResolvedValue(serverResponse);
    const mockDownload = jest.fn().mockResolvedValue(Buffer.from('image-content'));

    const operations: MediaOperation[] = [
      { type: 'create', local, reason: 'New file' },
    ];

    const result = await executeMediaPush(operations, false, {
      uploadMedia: mockUpload,
      updateMedia: jest.fn(),
      deleteMedia: jest.fn(),
      downloadMediaFile: mockDownload,
      logInfo: jest.fn(),
      logWarn: jest.fn(),
      logError: jest.fn(),
      logSuccess: jest.fn(),
    }, mediaDir);

    expect(result.executed.successful).toBe(1);
    // Old uppercase file should be deleted
    expect(await fileExistsExactCase('img/cases/Neural-Network.webp')).toBe(false);
    // New lowercase file should exist
    expect(await fileExistsExactCase('img/cases/neural-network.webp')).toBe(true);
  });

  it('should replace local file after upload when server changes extension', async () => {
    const originalPath = await createLocalFile('blog/photo.png', 'png-data');

    const local: LocalMediaFile = {
      filePath: 'blog/photo.png',
      absolutePath: originalPath,
      scopeUid: 'blog',
      name: 'photo.png',
      size: 8,
      extension: '.png',
      mimeType: 'image/png',
    };

    const serverResponse: MediaItem = {
      id: 11,
      location: '/api/media/blog/photo.avif',
      scopeUid: 'blog',
      name: 'photo.avif',
      size: 4,
      extension: '.avif',
      mimeType: 'image/avif',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: null,
    };

    const mockUpload = jest.fn().mockResolvedValue(serverResponse);
    const mockDownload = jest.fn().mockResolvedValue(Buffer.from('avif-optimized'));

    const operations: MediaOperation[] = [
      { type: 'create', local, reason: 'New file' },
    ];

    const result = await executeMediaPush(operations, false, {
      uploadMedia: mockUpload,
      updateMedia: jest.fn(),
      deleteMedia: jest.fn(),
      downloadMediaFile: mockDownload,
      logInfo: jest.fn(),
      logWarn: jest.fn(),
      logError: jest.fn(),
      logSuccess: jest.fn(),
    }, mediaDir);

    expect(result.executed.successful).toBe(1);
    expect(await fileExists('blog/photo.png')).toBe(false);
    expect(await fileExists('blog/photo.avif')).toBe(true);
    expect(await readLocalFile('blog/photo.avif')).toBe('avif-optimized');
  });

  it('should re-download file after update when server optimizes (size changed)', async () => {
    const originalPath = await createLocalFile('blog/large.jpg', 'large-unoptimized-content');

    const local: LocalMediaFile = {
      filePath: 'blog/large.jpg',
      absolutePath: originalPath,
      scopeUid: 'blog',
      name: 'large.jpg',
      size: 25,
      extension: '.jpg',
      mimeType: 'image/jpeg',
    };

    const remoteExisting: MediaItem = {
      id: 12,
      scopeUid: 'blog',
      name: 'large.jpg',
      size: 20,
      location: '/api/media/blog/large.jpg',
      extension: '.jpg',
      mimeType: 'image/jpeg',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: null,
    };

    const serverResponse: MediaItem = {
      ...remoteExisting,
      size: 15,
      updatedAt: '2026-02-01T00:00:00Z',
    };

    const mockUpdate = jest.fn().mockResolvedValue(serverResponse);
    const mockDownload = jest.fn().mockResolvedValue(Buffer.from('server-optimized'));

    const operations: MediaOperation[] = [
      { type: 'update', local, remote: remoteExisting, reason: 'Size changed' },
    ];

    const result = await executeMediaPush(operations, false, {
      uploadMedia: jest.fn(),
      updateMedia: mockUpdate,
      deleteMedia: jest.fn(),
      downloadMediaFile: mockDownload,
      logInfo: jest.fn(),
      logWarn: jest.fn(),
      logError: jest.fn(),
      logSuccess: jest.fn(),
    }, mediaDir);

    expect(result.executed.successful).toBe(1);
    expect(await fileExists('blog/large.jpg')).toBe(true);
    expect(await readLocalFile('blog/large.jpg')).toBe('server-optimized');
  });

  it('should handle reconciliation failure gracefully (still counts as successful upload)', async () => {
    const originalPath = await createLocalFile('blog/test.png', 'png-data');

    const local: LocalMediaFile = {
      filePath: 'blog/test.png',
      absolutePath: originalPath,
      scopeUid: 'blog',
      name: 'test.png',
      size: 8,
      extension: '.png',
      mimeType: 'image/png',
    };

    const serverResponse: MediaItem = {
      id: 20,
      location: '/api/media/blog/test.avif',
      scopeUid: 'blog',
      name: 'test.avif',
      size: 4,
      extension: '.avif',
      mimeType: 'image/avif',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: null,
    };

    const mockUpload = jest.fn().mockResolvedValue(serverResponse);
    const mockDownload = jest.fn().mockRejectedValue(new Error('Download failed'));
    const mockLogWarn = jest.fn();

    const operations: MediaOperation[] = [
      { type: 'create', local, reason: 'New file' },
    ];

    const result = await executeMediaPush(operations, false, {
      uploadMedia: mockUpload,
      updateMedia: jest.fn(),
      deleteMedia: jest.fn(),
      downloadMediaFile: mockDownload,
      logInfo: jest.fn(),
      logWarn: mockLogWarn,
      logError: jest.fn(),
      logSuccess: jest.fn(),
    }, mediaDir);

    // Upload itself succeeded
    expect(result.executed.successful).toBe(1);
    // A reconciliation warning should have been logged
    expect(mockLogWarn).toHaveBeenCalled();
    expect(mockLogWarn.mock.calls.some((c: any[]) =>
      typeof c[0] === 'string' && c[0].includes('reconcil')
    )).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════
//  pushMedia end-to-end: full flow with reconciliation
// ════════════════════════════════════════════════════════════════════════

describe('pushMedia: end-to-end with post-upload reconciliation', () => {
  it('should upload and reconcile files with case-changed names', async () => {
    // Create local files with uppercase names
    await createLocalFile('img/cases/Neural-Network-Reads.webp', 'webp-data-1');
    await createLocalFile('img/cases/Neural-Network-Reads@2x.webp', 'webp-data-2');

    const serverResponses = [
      {
        id: 30,
        location: '/api/media/img/cases/neural-network-reads.webp',
        scopeUid: 'img/cases',
        name: 'neural-network-reads.webp',
        size: 10,
        extension: '.webp',
        mimeType: 'image/webp',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: null,
      },
      {
        id: 31,
        location: '/api/media/img/cases/neural-network-reads@2x.webp',
        scopeUid: 'img/cases',
        name: 'neural-network-reads@2x.webp',
        size: 10,
        extension: '.webp',
        mimeType: 'image/webp',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: null,
      },
    ];

    let uploadCallIndex = 0;
    const mockUpload = jest.fn().mockImplementation(() => {
      return Promise.resolve(serverResponses[uploadCallIndex++]);
    });

    const mockDownload = jest.fn().mockImplementation(() => {
      return Promise.resolve(Buffer.from('downloaded-data'));
    });

    const result = await pushMedia(
      { force: true, mediaDir },
      {
        fetchRemoteMedia: jest.fn().mockResolvedValue([]),
        uploadMedia: mockUpload,
        updateMedia: jest.fn(),
        deleteMedia: jest.fn(),
        downloadMediaFile: mockDownload,
        logInfo: jest.fn(),
        logWarn: jest.fn(),
        logError: jest.fn(),
        logSuccess: jest.fn(),
        promptConfirmation: jest.fn().mockResolvedValue(true),
      },
    );

    expect(result.executed.successful).toBe(2);

    // Uppercase files should be removed
    expect(await fileExistsExactCase('img/cases/Neural-Network-Reads.webp')).toBe(false);
    expect(await fileExistsExactCase('img/cases/Neural-Network-Reads@2x.webp')).toBe(false);

    // Lowercase files should exist
    expect(await fileExistsExactCase('img/cases/neural-network-reads.webp')).toBe(true);
    expect(await fileExistsExactCase('img/cases/neural-network-reads@2x.webp')).toBe(true);
  });
});
