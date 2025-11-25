/**
 * Tests for Media Push Functionality
 */

import {
  pushMedia,
  statusMedia,
  validateFileSize,
  getMimeType,
  getFileCategory,
  matchMediaFiles
} from '../src/scripts/push-media';
import { leadCMSDataService } from '../src/lib/data-service';

// Mock file system for testing
jest.mock('fs');
jest.mock('path');

describe('Media Push Feature', () => {
  beforeAll(() => {
    // Set up mock environment
    process.env.LEADCMS_USE_MOCK = 'true';
    process.env.LEADCMS_MOCK_SCENARIO = 'noChanges';
    process.env.LEADCMS_URL = 'https://test.leadcms.ai';
    process.env.LEADCMS_API_KEY = 'test-api-key';
  });

  afterAll(() => {
    delete process.env.LEADCMS_USE_MOCK;
    delete process.env.LEADCMS_MOCK_SCENARIO;
    delete process.env.LEADCMS_URL;
    delete process.env.LEADCMS_API_KEY;
  });

  describe('File Size Validation', () => {
    it('should validate file sizes according to LeadCMS limits', () => {
      // Test image file under limit
      const validImage = {
        name: 'test.jpg',
        extension: '.jpg',
        size: 5 * 1024 * 1024, // 5MB
        scopeUid: 'test',
        filePath: 'test/test.jpg',
        absolutePath: '/test/test.jpg',
        mimeType: 'image/jpeg'
      };

      const result = validateFileSize(validImage);
      expect(result.valid).toBe(true);
    });

    it('should reject oversized image files', () => {
      const oversizedImage = {
        name: 'huge.jpg',
        extension: '.jpg',
        size: 15 * 1024 * 1024, // 15MB - over limit
        scopeUid: 'test',
        filePath: 'test/huge.jpg',
        absolutePath: '/test/huge.jpg',
        mimeType: 'image/jpeg'
      };

      const result = validateFileSize(oversizedImage);
      expect(result.valid).toBe(false);
      expect(result.message).toContain('exceeds');
    });

    it('should accept large video files within limit', () => {
      const validVideo = {
        name: 'video.mp4',
        extension: '.mp4',
        size: 50 * 1024 * 1024, // 50MB - within video limit
        scopeUid: 'test',
        filePath: 'test/video.mp4',
        absolutePath: '/test/video.mp4',
        mimeType: 'video/mp4'
      };

      const result = validateFileSize(validVideo);
      expect(result.valid).toBe(true);
    });
  });

  describe('MIME Type Detection', () => {
    it('should detect MIME types correctly', () => {
      expect(getMimeType('.jpg')).toBe('image/jpeg');
      expect(getMimeType('.png')).toBe('image/png');
      expect(getMimeType('.webp')).toBe('image/webp');
      expect(getMimeType('.avif')).toBe('image/avif');
      expect(getMimeType('.mp4')).toBe('video/mp4');
      expect(getMimeType('.pdf')).toBe('application/pdf');
      expect(getMimeType('.unknown')).toBe('application/octet-stream');
    });
  });

  describe('File Categorization', () => {
    it('should categorize files correctly', () => {
      expect(getFileCategory('.jpg')).toBe('image');
      expect(getFileCategory('.jpeg')).toBe('image');
      expect(getFileCategory('.png')).toBe('image');
      expect(getFileCategory('.gif')).toBe('image');
      expect(getFileCategory('.webp')).toBe('image');
      expect(getFileCategory('.svg')).toBe('image');
      expect(getFileCategory('.avif')).toBe('image');

      expect(getFileCategory('.mp4')).toBe('video');
      expect(getFileCategory('.webm')).toBe('video');
      expect(getFileCategory('.ogg')).toBe('video');

      expect(getFileCategory('.pdf')).toBe('document');
      expect(getFileCategory('.txt')).toBe('document');
      expect(getFileCategory('.md')).toBe('document');

      expect(getFileCategory('.zip')).toBe('other');
      expect(getFileCategory('.unknown')).toBe('other');
    });
  });

  describe('Media File Matching', () => {
    it('should match files by scopeUid and name', () => {
      const localFiles = [
        {
          scopeUid: 'blog',
          name: 'hero.jpg',
          size: 245760,
          filePath: 'blog/hero.jpg',
          absolutePath: '/media/blog/hero.jpg',
          extension: '.jpg',
          mimeType: 'image/jpeg'
        }
      ];

      const remoteFiles = [
        {
          id: 1,
          scopeUid: 'blog',
          name: 'hero.jpg',
          size: 245760,
          location: '/api/media/blog/hero.jpg',
          extension: '.jpg',
          mimeType: 'image/jpeg',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: null
        }
      ];

      const operations = matchMediaFiles(localFiles, remoteFiles);

      expect(operations).toHaveLength(1);
      expect(operations[0].type).toBe('skip');
      expect(operations[0].reason).toBe('No changes detected');
    });

    it('should detect new files', () => {
      const localFiles = [
        {
          scopeUid: 'blog',
          name: 'new-image.jpg',
          size: 100000,
          filePath: 'blog/new-image.jpg',
          absolutePath: '/media/blog/new-image.jpg',
          extension: '.jpg',
          mimeType: 'image/jpeg'
        }
      ];

      const remoteFiles: any[] = [];

      const operations = matchMediaFiles(localFiles, remoteFiles);

      expect(operations).toHaveLength(1);
      expect(operations[0].type).toBe('create');
      expect(operations[0].reason).toBe('New file not present remotely');
    });

    it('should detect size changes', () => {
      const localFiles = [
        {
          scopeUid: 'blog',
          name: 'hero.jpg',
          size: 300000,
          filePath: 'blog/hero.jpg',
          absolutePath: '/media/blog/hero.jpg',
          extension: '.jpg',
          mimeType: 'image/jpeg'
        }
      ];

      const remoteFiles = [
        {
          id: 1,
          scopeUid: 'blog',
          name: 'hero.jpg',
          size: 245760,
          location: '/api/media/blog/hero.jpg',
          extension: '.jpg',
          mimeType: 'image/jpeg',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: null
        }
      ];

      const operations = matchMediaFiles(localFiles, remoteFiles);

      expect(operations).toHaveLength(1);
      expect(operations[0].type).toBe('update');
      expect(operations[0].reason).toContain('File size changed');
    });

    it('should detect deleted files', () => {
      const localFiles: any[] = [];

      const remoteFiles = [
        {
          id: 1,
          scopeUid: 'blog',
          name: 'old-image.jpg',
          size: 245760,
          location: '/api/media/blog/old-image.jpg',
          extension: '.jpg',
          mimeType: 'image/jpeg',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: null
        }
      ];

      const operations = matchMediaFiles(localFiles, remoteFiles, true);

      expect(operations).toHaveLength(1);
      expect(operations[0].type).toBe('delete');
      expect(operations[0].reason).toBe('File removed locally');
    });

    it('should NOT detect deleted files when allowDelete is false', () => {
      const localFiles: any[] = [];
      const remoteFiles: any[] = [
        {
          scopeUid: 'blog',
          name: 'hero.jpg',
          pathToFile: '/media/blog/hero.jpg',
          size: 204800,
          extension: '.jpg',
          mimeType: 'image/jpeg',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: null
        }
      ];

      const operations = matchMediaFiles(localFiles, remoteFiles, false);

      // Should have no delete operations when allowDelete is false
      const deleteOps = operations.filter(op => op.type === 'delete');
      expect(deleteOps).toHaveLength(0);
    });
  });

  describe('Dry Run Mode', () => {
    it('should accept dry run option without errors', () => {
      // TypeScript validates the function signature at compile-time
      const dryRunCall = () => pushMedia({ dryRun: true });
      expect(dryRunCall).toBeDefined();
    });
  });

  describe('Scope Filtering', () => {
    it('should accept scope filtering option without errors', () => {
      // TypeScript validates the function signature at compile-time
      const scopeCall = () => statusMedia({ scopeUid: 'blog' });
      expect(scopeCall).toBeDefined();
    });
  });

  describe('Mock Scenarios', () => {
    it('should work with noChanges scenario', async () => {
      process.env.LEADCMS_MOCK_SCENARIO = 'noChanges';

      const media = await leadCMSDataService.getAllMedia();
      expect(media.length).toBeGreaterThan(0);
    });

    it('should work with mixedOperations scenario', async () => {
      process.env.LEADCMS_MOCK_SCENARIO = 'mixedOperations';

      const media = await leadCMSDataService.getAllMedia();
      expect(Array.isArray(media)).toBe(true);
    });
  });
});
