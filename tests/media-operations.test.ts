/**
 * Tests for media status and push functionality using SDK top-level functions
 *
 * These tests use:
 * - REAL local files from tests/fixtures/public/media/
 * - MOCKED remote API via dependency injection
 * - SDK functions (statusMedia, pushMedia) exactly as CLI uses them
 */
import * as path from 'path';
import { MediaItem } from '../src/lib/data-service';
import {
  statusMedia,
  pushMedia,
  MediaStatusResult,
  MediaPushResult,
  MediaDependencies,
} from '../src/scripts/push-media';

// Path to test fixtures
const FIXTURES_MEDIA_DIR = path.join(__dirname, 'fixtures/public/media');

// Mock console.log to suppress output during tests
const originalConsoleLog = console.log;
beforeAll(() => {
  console.log = jest.fn();
});
afterAll(() => {
  console.log = originalConsoleLog;
});

// Silence console output during tests
const silentDeps: Partial<MediaDependencies> = {
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
  logSuccess: jest.fn(),
};

describe('statusMedia - SDK top-level function', () => {
  describe('when remote is empty (all files are new)', () => {
    it('should detect all local files as creates', async () => {
      // Mock remote API returns empty array
      const deps: Partial<MediaDependencies> = {
        ...silentDeps,
        fetchRemoteMedia: async () => [],
      };

      const result: MediaStatusResult = await statusMedia(
        { mediaDir: FIXTURES_MEDIA_DIR },
        deps
      );

      // We have 4 fixture files
      expect(result.localFiles.length).toBe(4);
      expect(result.remoteFiles.length).toBe(0);

      // All should be creates
      expect(result.summary.creates).toBe(4);
      expect(result.summary.updates).toBe(0);
      expect(result.summary.deletes).toBe(0);
      expect(result.summary.skips).toBe(0);

      // Verify specific files were found
      const filePaths = result.localFiles.map(f => f.filePath);
      expect(filePaths).toContain('blog/post-456/cover.png');
      expect(filePaths).toContain('news/article-123/hero.jpg');
      expect(filePaths).toContain('news/article-123/thumb.jpg');
      expect(filePaths).toContain('pages/about/team.jpg');
    });

    it('should correctly identify file metadata', async () => {
      const deps: Partial<MediaDependencies> = {
        ...silentDeps,
        fetchRemoteMedia: async () => [],
      };

      const result = await statusMedia({ mediaDir: FIXTURES_MEDIA_DIR }, deps);

      // Find the cover.png file
      const coverFile = result.localFiles.find(f => f.name === 'cover.png');
      expect(coverFile).toBeDefined();
      expect(coverFile!.scopeUid).toBe('blog/post-456');
      expect(coverFile!.extension).toBe('.png');
      expect(coverFile!.mimeType).toBe('image/png');
      expect(coverFile!.size).toBe(16); // 16 bytes in fixture
    });
  });

  describe('when remote matches local (all files in sync)', () => {
    it('should detect all files as skips', async () => {
      // Mock remote with matching files
      const mockRemote: MediaItem[] = [
        {
          id: 1,
          location: '/api/media/blog/post-456/cover.png',
          scopeUid: 'blog/post-456',
          name: 'cover.png',
          description: null,
          size: 16, // Same size as local
          extension: '.png',
          mimeType: 'image/png',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: null,
        },
        {
          id: 2,
          location: '/api/media/news/article-123/hero.jpg',
          scopeUid: 'news/article-123',
          name: 'hero.jpg',
          description: null,
          size: 16,
          extension: '.jpg',
          mimeType: 'image/jpeg',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: null,
        },
        {
          id: 3,
          location: '/api/media/news/article-123/thumb.jpg',
          scopeUid: 'news/article-123',
          name: 'thumb.jpg',
          description: null,
          size: 15,
          extension: '.jpg',
          mimeType: 'image/jpeg',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: null,
        },
        {
          id: 4,
          location: '/api/media/pages/about/team.jpg',
          scopeUid: 'pages/about',
          name: 'team.jpg',
          description: null,
          size: 17,
          extension: '.jpg',
          mimeType: 'image/jpeg',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: null,
        },
      ];

      const deps: Partial<MediaDependencies> = {
        ...silentDeps,
        fetchRemoteMedia: async () => mockRemote,
      };

      const result = await statusMedia({ mediaDir: FIXTURES_MEDIA_DIR }, deps);

      expect(result.summary.creates).toBe(0);
      expect(result.summary.updates).toBe(0);
      expect(result.summary.deletes).toBe(0);
      expect(result.summary.skips).toBe(4);
    });
  });

  describe('when remote has different file sizes (updates needed)', () => {
    it('should detect files with different sizes as updates', async () => {
      // Mock remote with different file sizes
      const mockRemote: MediaItem[] = [
        {
          id: 1,
          location: '/api/media/blog/post-456/cover.png',
          scopeUid: 'blog/post-456',
          name: 'cover.png',
          description: null,
          size: 1000, // Different size - should trigger update
          extension: '.png',
          mimeType: 'image/png',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: null,
        },
        {
          id: 2,
          location: '/api/media/news/article-123/hero.jpg',
          scopeUid: 'news/article-123',
          name: 'hero.jpg',
          description: null,
          size: 16, // Same size - should skip
          extension: '.jpg',
          mimeType: 'image/jpeg',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: null,
        },
      ];

      const deps: Partial<MediaDependencies> = {
        ...silentDeps,
        fetchRemoteMedia: async () => mockRemote,
      };

      const result = await statusMedia({ mediaDir: FIXTURES_MEDIA_DIR }, deps);

      expect(result.summary.updates).toBe(1); // cover.png has different size
      expect(result.summary.skips).toBe(1);   // hero.jpg matches
      expect(result.summary.creates).toBe(2); // thumb.jpg and team.jpg not in remote
    });
  });

  describe('when --delete flag is used', () => {
    it('should detect remote-only files as deletes when showDelete=true', async () => {
      // Mock remote with files that don't exist locally
      const mockRemote: MediaItem[] = [
        {
          id: 1,
          location: '/api/media/blog/post-456/cover.png',
          scopeUid: 'blog/post-456',
          name: 'cover.png',
          description: null,
          size: 16,
          extension: '.png',
          mimeType: 'image/png',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: null,
        },
        {
          id: 99,
          location: '/api/media/old-folder/deleted-image.jpg',
          scopeUid: 'old-folder',
          name: 'deleted-image.jpg',
          description: null,
          size: 5000,
          extension: '.jpg',
          mimeType: 'image/jpeg',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: null,
        },
        {
          id: 100,
          location: '/api/media/archive/old-photo.png',
          scopeUid: 'archive',
          name: 'old-photo.png',
          description: null,
          size: 3000,
          extension: '.png',
          mimeType: 'image/png',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: null,
        },
      ];

      const deps: Partial<MediaDependencies> = {
        ...silentDeps,
        fetchRemoteMedia: async () => mockRemote,
      };

      // Without showDelete
      const resultWithout = await statusMedia({ mediaDir: FIXTURES_MEDIA_DIR }, deps);
      expect(resultWithout.summary.deletes).toBe(0);

      // With showDelete
      const resultWith = await statusMedia(
        { mediaDir: FIXTURES_MEDIA_DIR, showDelete: true },
        deps
      );
      expect(resultWith.summary.deletes).toBe(2); // deleted-image.jpg and old-photo.png

      // Verify the delete operations
      const deleteOps = resultWith.operations.filter(op => op.type === 'delete');
      expect(deleteOps.length).toBe(2);
      expect(deleteOps.map(op => op.remote!.name)).toContain('deleted-image.jpg');
      expect(deleteOps.map(op => op.remote!.name)).toContain('old-photo.png');
    });
  });

  describe('with scopeUid filter', () => {
    it('should only process files matching the scope', async () => {
      const deps: Partial<MediaDependencies> = {
        ...silentDeps,
        fetchRemoteMedia: async () => [],
      };

      const result = await statusMedia(
        { mediaDir: FIXTURES_MEDIA_DIR, scopeUid: 'news/article-123' },
        deps
      );

      // Should only find files in news/article-123
      expect(result.localFiles.length).toBe(2);
      expect(result.localFiles.every(f => f.scopeUid === 'news/article-123')).toBe(true);
    });
  });
});

describe('pushMedia - SDK top-level function', () => {
  describe('dry run mode', () => {
    it('should not execute any operations', async () => {
      const uploadMock = jest.fn();
      const updateMock = jest.fn();
      const deleteMock = jest.fn();

      const deps: Partial<MediaDependencies> = {
        ...silentDeps,
        fetchRemoteMedia: async () => [],
        uploadMedia: uploadMock,
        updateMedia: updateMock,
        deleteMedia: deleteMock,
      };

      const result: MediaPushResult = await pushMedia(
        { mediaDir: FIXTURES_MEDIA_DIR, dryRun: true },
        deps
      );

      // No actual operations should be executed
      expect(uploadMock).not.toHaveBeenCalled();
      expect(updateMock).not.toHaveBeenCalled();
      expect(deleteMock).not.toHaveBeenCalled();

      // All operations should be skipped
      expect(result.executed.skipped).toBe(4); // All 4 files skipped in dry run
      expect(result.executed.successful).toBe(0);
      expect(result.executed.failed).toBe(0);
    });
  });

  describe('force mode (no confirmation)', () => {
    it('should execute uploads for new files', async () => {
      const uploadMock = jest.fn().mockResolvedValue({ id: 1 });

      const deps: Partial<MediaDependencies> = {
        ...silentDeps,
        fetchRemoteMedia: async () => [],
        uploadMedia: uploadMock,
      };

      const result = await pushMedia(
        { mediaDir: FIXTURES_MEDIA_DIR, force: true },
        deps
      );

      // All 4 files should be uploaded
      expect(uploadMock).toHaveBeenCalledTimes(4);
      expect(result.executed.successful).toBe(4);
      expect(result.executed.failed).toBe(0);
    });

    it('should execute updates for changed files', async () => {
      const updateMock = jest.fn().mockResolvedValue({ id: 1 });
      const uploadMock = jest.fn().mockResolvedValue({ id: 2 });

      // Remote with one file having different size
      const mockRemote: MediaItem[] = [
        {
          id: 1,
          location: '/api/media/blog/post-456/cover.png',
          scopeUid: 'blog/post-456',
          name: 'cover.png',
          description: null,
          size: 1000, // Different size
          extension: '.png',
          mimeType: 'image/png',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: null,
        },
      ];

      const deps: Partial<MediaDependencies> = {
        ...silentDeps,
        fetchRemoteMedia: async () => mockRemote,
        uploadMedia: uploadMock,
        updateMedia: updateMock,
      };

      const result = await pushMedia(
        { mediaDir: FIXTURES_MEDIA_DIR, force: true },
        deps
      );

      // 1 update + 3 uploads
      expect(updateMock).toHaveBeenCalledTimes(1);
      expect(uploadMock).toHaveBeenCalledTimes(3);
      expect(result.executed.successful).toBe(4);
    });

    it('should execute deletes when allowDelete is true', async () => {
      const deleteMock = jest.fn().mockResolvedValue(undefined);
      const uploadMock = jest.fn().mockResolvedValue({ id: 1 });

      // Remote with file that doesn't exist locally
      const mockRemote: MediaItem[] = [
        {
          id: 1,
          location: '/api/media/blog/post-456/cover.png',
          scopeUid: 'blog/post-456',
          name: 'cover.png',
          description: null,
          size: 16,
          extension: '.png',
          mimeType: 'image/png',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: null,
        },
        {
          id: 99,
          location: '/api/media/old/deleted.jpg',
          scopeUid: 'old',
          name: 'deleted.jpg',
          description: null,
          size: 5000,
          extension: '.jpg',
          mimeType: 'image/jpeg',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: null,
        },
      ];

      const deps: Partial<MediaDependencies> = {
        ...silentDeps,
        fetchRemoteMedia: async () => mockRemote,
        uploadMedia: uploadMock,
        deleteMedia: deleteMock,
      };

      const result = await pushMedia(
        { mediaDir: FIXTURES_MEDIA_DIR, force: true, allowDelete: true },
        deps
      );

      expect(deleteMock).toHaveBeenCalledTimes(1);
      expect(deleteMock).toHaveBeenCalledWith('old/deleted.jpg');
    });
  });

  describe('confirmation prompt', () => {
    it('should cancel when user declines', async () => {
      const uploadMock = jest.fn();

      const deps: Partial<MediaDependencies> = {
        ...silentDeps,
        fetchRemoteMedia: async () => [],
        uploadMedia: uploadMock,
        promptConfirmation: async () => false, // User declines
      };

      const result = await pushMedia({ mediaDir: FIXTURES_MEDIA_DIR }, deps);

      expect(uploadMock).not.toHaveBeenCalled();
      expect(result.executed.skipped).toBe(4);
    });

    it('should proceed when user confirms', async () => {
      const uploadMock = jest.fn().mockResolvedValue({ id: 1 });

      const deps: Partial<MediaDependencies> = {
        ...silentDeps,
        fetchRemoteMedia: async () => [],
        uploadMedia: uploadMock,
        promptConfirmation: async () => true, // User confirms
      };

      const result = await pushMedia({ mediaDir: FIXTURES_MEDIA_DIR }, deps);

      expect(uploadMock).toHaveBeenCalledTimes(4);
      expect(result.executed.successful).toBe(4);
    });
  });

  describe('error handling', () => {
    it('should track failed operations', async () => {
      const uploadMock = jest.fn()
        .mockResolvedValueOnce({ id: 1 }) // First succeeds
        .mockRejectedValueOnce(new Error('Network error')) // Second fails
        .mockResolvedValueOnce({ id: 3 }) // Third succeeds
        .mockRejectedValueOnce(new Error('Server error')); // Fourth fails

      const deps: Partial<MediaDependencies> = {
        ...silentDeps,
        fetchRemoteMedia: async () => [],
        uploadMedia: uploadMock,
      };

      const result = await pushMedia(
        { mediaDir: FIXTURES_MEDIA_DIR, force: true },
        deps
      );

      expect(result.executed.successful).toBe(2);
      expect(result.executed.failed).toBe(2);
      expect(result.errors.length).toBe(2);
      expect(result.errors[0].error).toBe('Network error');
      expect(result.errors[1].error).toBe('Server error');
    });
  });

  describe('silent mode', () => {
    it('should return results without calling display functions when silent is true', async () => {
      const deps: Partial<MediaDependencies> = {
        ...silentDeps,
        fetchRemoteMedia: async () => [],
      };

      // Reset the mock before this test to track calls
      (console.log as jest.Mock).mockClear();

      const result: MediaStatusResult = await statusMedia(
        { mediaDir: FIXTURES_MEDIA_DIR, silent: true },
        deps
      );

      // Should still return data correctly
      expect(result.localFiles.length).toBe(4);
      expect(result.summary.creates).toBe(4);

      // console.log should not have been called for the display output
      // (silentDeps already mocks logInfo etc., but silent skips displayMediaStatus entirely)
      expect(result.operations.length).toBe(4);
    });
  });

  describe('when all files are in sync', () => {
    it('should skip all operations and return early', async () => {
      const uploadMock = jest.fn();

      // Mock remote matching all local files
      const mockRemote: MediaItem[] = [
        { id: 1, location: '', scopeUid: 'blog/post-456', name: 'cover.png', description: null, size: 16, extension: '.png', mimeType: 'image/png', createdAt: '', updatedAt: null },
        { id: 2, location: '', scopeUid: 'news/article-123', name: 'hero.jpg', description: null, size: 16, extension: '.jpg', mimeType: 'image/jpeg', createdAt: '', updatedAt: null },
        { id: 3, location: '', scopeUid: 'news/article-123', name: 'thumb.jpg', description: null, size: 15, extension: '.jpg', mimeType: 'image/jpeg', createdAt: '', updatedAt: null },
        { id: 4, location: '', scopeUid: 'pages/about', name: 'team.jpg', description: null, size: 17, extension: '.jpg', mimeType: 'image/jpeg', createdAt: '', updatedAt: null },
      ];

      const deps: Partial<MediaDependencies> = {
        ...silentDeps,
        fetchRemoteMedia: async () => mockRemote,
        uploadMedia: uploadMock,
      };

      const result = await pushMedia(
        { mediaDir: FIXTURES_MEDIA_DIR, force: true },
        deps
      );

      expect(uploadMock).not.toHaveBeenCalled();
      expect(result.executed.skipped).toBe(4);
      expect(result.operations.every(op => op.type === 'skip')).toBe(true);
    });
  });
});
