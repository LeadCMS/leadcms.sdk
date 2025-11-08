import axios from 'axios';
import { leadCMSDataService, LeadCMSDataService } from '../src/lib/data-service';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('LeadCMS Data Service', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    originalEnv = process.env;
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe('Mock Mode', () => {
    beforeEach(() => {
      process.env.LEADCMS_USE_MOCK = 'true';
    });

    it('should use mock mode when LEADCMS_USE_MOCK is true', async () => {
      const content = await leadCMSDataService.getAllContent();

      expect(leadCMSDataService.isMockMode()).toBe(true);
      expect(Array.isArray(content)).toBe(true);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('[DATA SERVICE] Using mock mode with scenario:')
      );
    });

    it('should use mock mode in test environment', async () => {
      process.env.LEADCMS_USE_MOCK = 'false';
      process.env.NODE_ENV = 'test';

      const service = new LeadCMSDataService();
      const content = await service.getAllContent();

      expect(service.isMockMode()).toBe(true);
      expect(Array.isArray(content)).toBe(true);
    });

    it('should return mock content for getAllContent', async () => {
      process.env.LEADCMS_MOCK_SCENARIO = 'noChanges';
      const service = new LeadCMSDataService();

      const content = await service.getAllContent();

      expect(Array.isArray(content)).toBe(true);
      expect(content.length).toBeGreaterThanOrEqual(0);
      expect(consoleLogSpy).toHaveBeenCalledWith('[MOCK] Returning mock content data');
    });

    it('should return mock content types for getContentTypes', async () => {
      const service = new LeadCMSDataService();

      const contentTypes = await service.getContentTypes();

      expect(Array.isArray(contentTypes)).toBe(true);
      expect(contentTypes.length).toBeGreaterThan(0);
      expect(contentTypes[0]).toHaveProperty('uid');
      expect(contentTypes[0]).toHaveProperty('format');
      expect(contentTypes[0]).toHaveProperty('name');
      expect(consoleLogSpy).toHaveBeenCalledWith('[MOCK] Returning mock content types');
    });

    it('should create content in mock mode', async () => {
      const service = new LeadCMSDataService();
      const newContent = {
        slug: 'test-post',
        title: 'Test Post',
        type: 'article',
        body: 'Test content'
      };

      const created = await service.createContent(newContent);

      expect(created).toMatchObject(newContent);
      expect(created.id).toBeDefined();
      expect(created.createdAt).toBeDefined();
      expect(created.updatedAt).toBeDefined();
      expect(consoleLogSpy).toHaveBeenCalledWith('[MOCK] Creating content: Test Post');
    });

    it('should update content in mock mode', async () => {
      const service = new LeadCMSDataService();

      // First create content
      const newContent = await service.createContent({
        slug: 'test-post',
        title: 'Test Post',
        type: 'article'
      });

      // Then update it
      const updates = { title: 'Updated Post' };
      const updated = await service.updateContent(newContent.id!, updates);

      expect(updated.title).toBe('Updated Post');
      expect(updated.id).toBe(newContent.id);
      expect(updated.updatedAt).not.toBe(newContent.updatedAt);
      expect(consoleLogSpy).toHaveBeenCalledWith(`[MOCK] Updating content ID ${newContent.id}: Updated Post`);
    });

    it('should throw error when updating non-existent content in mock mode', async () => {
      const service = new LeadCMSDataService();

      await expect(service.updateContent(999, { title: 'Updated' })).rejects.toThrow(
        'Content with id 999 not found'
      );
    });

    it('should create content type in mock mode', async () => {
      const service = new LeadCMSDataService();
      const contentType = {
        uid: 'news',
        format: 'MDX',
        name: 'News'
      };

      const created = await service.createContentType(contentType);

      expect(created).toEqual(contentType);
      expect(consoleLogSpy).toHaveBeenCalledWith('[MOCK] Creating content type: news');
    });

    it('should switch mock scenarios', () => {
      const service = new LeadCMSDataService();

      const mockData = service.switchMockScenario('hasConflicts');

      expect(mockData.scenario).toBe('Has Conflicts');
      expect(consoleLogSpy).toHaveBeenCalledWith('[MOCK] Switched to scenario: Has Conflicts');
    });

    it('should throw error for unknown mock scenario', () => {
      const service = new LeadCMSDataService();

      expect(() => service.switchMockScenario('unknown')).toThrow('Unknown scenario: unknown');
    });

    it('should get current mock scenario', async () => {
      process.env.LEADCMS_MOCK_SCENARIO = 'hasUpdates';
      const service = new LeadCMSDataService();

      // Initialize by calling a method
      await service.getAllContent();

      expect(service.getMockScenario()).toBe('Has Updates');
    });

    it('should get mock state', async () => {
      const service = new LeadCMSDataService();

      // Initialize by calling a method
      await service.getAllContent();

      const state = service.getMockState();
      expect(state).not.toBeNull();
      expect(state).toHaveProperty('remoteContent');
      expect(state).toHaveProperty('contentTypes');
      expect(state).toHaveProperty('scenario');
    });

    it('should reset mock data', async () => {
      const service = new LeadCMSDataService();

      // Create some content first
      await service.createContent({ slug: 'test', title: 'Test', type: 'article' });

      service.resetMockData();

      const state = service.getMockState();
      expect(state?.scenario).toBeDefined();
    });
  });

  describe('API Mode', () => {
    beforeEach(() => {
      process.env.LEADCMS_USE_MOCK = 'false';
      process.env.NODE_ENV = 'development';
      process.env.LEADCMS_URL = 'https://api.example.com';
      process.env.LEADCMS_API_KEY = 'test-api-key';
    });

    it('should use API mode when mock is disabled', async () => {
      const service = new LeadCMSDataService();

      mockedAxios.get.mockResolvedValue({ data: [] });

      await service.getAllContent();

      expect(service.isMockMode()).toBe(false);
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[DATA SERVICE] Using real API mode: https://api.example.com'
      );
    });

    it('should fetch content from API', async () => {
      const mockContent = [
        { id: 1, slug: 'test', title: 'Test', type: 'article' }
      ];

      mockedAxios.get.mockResolvedValue({
        status: 200,
        data: { items: mockContent }
      });

      const service = new LeadCMSDataService();
      const content = await service.getAllContent();

      expect(content).toEqual(mockContent);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://api.example.com/api/content/sync',
        {
          headers: {
            'Authorization': 'Bearer test-api-key',
            'Content-Type': 'application/json'
          }
        }
      );
    });

    it('should handle direct array response from API', async () => {
      const mockContent = [
        { id: 1, slug: 'test', title: 'Test', type: 'article' }
      ];

      mockedAxios.get.mockResolvedValue({
        status: 200,
        data: mockContent
      });

      const service = new LeadCMSDataService();
      const content = await service.getAllContent();

      expect(content).toEqual(mockContent);
      expect(consoleLogSpy).toHaveBeenCalledWith('[API] Response data is direct array with 1 items');
    });

    it('should handle 204 No Content response', async () => {
      mockedAxios.get.mockResolvedValue({ status: 204 });

      const service = new LeadCMSDataService();
      const content = await service.getAllContent();

      expect(content).toEqual([]);
      expect(consoleLogSpy).toHaveBeenCalledWith('[API DEBUG] Status 204 - No Content');
    });

    it('should handle empty response data', async () => {
      mockedAxios.get.mockResolvedValue({
        status: 200,
        data: null
      });

      const service = new LeadCMSDataService();
      const content = await service.getAllContent();

      expect(content).toEqual([]);
      expect(consoleLogSpy).toHaveBeenCalledWith('[API DEBUG] No content data returned from API (data is falsy)');
    });

    it('should handle unexpected response format', async () => {
      mockedAxios.get.mockResolvedValue({
        status: 200,
        data: { unexpected: 'format' }
      });

      const service = new LeadCMSDataService();
      const content = await service.getAllContent();

      expect(content).toEqual([]);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        '[API] API returned unexpected data format:',
        'object',
        { unexpected: 'format' }
      );
    });

    it('should throw error when API fails', async () => {
      mockedAxios.get.mockRejectedValue(new Error('Network error'));

      const service = new LeadCMSDataService();

      await expect(service.getAllContent()).rejects.toThrow('Network error');
      expect(consoleErrorSpy).toHaveBeenCalledWith('[API] Failed to fetch content:', 'Network error');
    });

    it('should throw error when URL is not configured', async () => {
      delete process.env.LEADCMS_URL;
      delete process.env.NEXT_PUBLIC_LEADCMS_URL;

      const service = new LeadCMSDataService();

      await expect(service.getAllContent()).rejects.toThrow(
        'LeadCMS URL is not configured. Please set LEADCMS_URL or NEXT_PUBLIC_LEADCMS_URL in your .env file.'
      );
    });

    it('should fetch content types from API', async () => {
      const mockContentTypes = [
        { uid: 'article', format: 'MDX', name: 'Article' }
      ];

      mockedAxios.get.mockResolvedValue({ data: mockContentTypes });

      const service = new LeadCMSDataService();
      const contentTypes = await service.getContentTypes();

      expect(contentTypes).toEqual(mockContentTypes);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://api.example.com/api/content-types',
        {
          headers: {
            'Authorization': 'Bearer test-api-key',
            'Content-Type': 'application/json'
          }
        }
      );
    });

    it('should create content via API', async () => {
      const newContent = { slug: 'test', title: 'Test', type: 'article' };
      const createdContent = { ...newContent, id: 1 };

      mockedAxios.post.mockResolvedValue({ data: createdContent });

      const service = new LeadCMSDataService();
      const result = await service.createContent(newContent);

      expect(result).toEqual(createdContent);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.example.com/api/content',
        newContent,
        {
          headers: {
            'Authorization': 'Bearer test-api-key',
            'Content-Type': 'application/json'
          }
        }
      );
    });

    it('should handle 401 authentication error on create', async () => {
      const error = {
        response: { status: 401 }
      };

      mockedAxios.post.mockRejectedValue(error);

      const service = new LeadCMSDataService();

      await expect(service.createContent({ slug: 'test', title: 'Test', type: 'article' }))
        .rejects.toThrow('Authentication failed: Invalid or missing API key');
    });

    it('should handle 422 validation error on create', async () => {
      const error = {
        response: {
          status: 422,
          data: {
            errors: {
              title: ['Title is required'],
              slug: ['Slug must be unique']
            }
          }
        }
      };

      mockedAxios.post.mockRejectedValue(error);

      const service = new LeadCMSDataService();

      const thrownError = await service.createContent({ slug: 'test', type: 'article' })
        .catch(e => e);

      expect(thrownError.message).toContain('Validation failed');
      expect(thrownError.message).toContain('title: Title is required');
      expect(thrownError.message).toContain('slug: Slug must be unique');
      expect(thrownError.status).toBe(422);
    });

    it('should update content via API', async () => {
      const updates = { title: 'Updated Title' };
      const updatedContent = { id: 1, slug: 'test', title: 'Updated Title', type: 'article' };

      mockedAxios.put.mockResolvedValue({ data: updatedContent });

      const service = new LeadCMSDataService();
      const result = await service.updateContent(1, updates);

      expect(result).toEqual(updatedContent);
      expect(mockedAxios.put).toHaveBeenCalledWith(
        'https://api.example.com/api/content/1',
        updates,
        {
          headers: {
            'Authorization': 'Bearer test-api-key',
            'Content-Type': 'application/json'
          }
        }
      );
    });

    it('should handle 401 authentication error on update', async () => {
      const error = {
        response: { status: 401 }
      };

      mockedAxios.put.mockRejectedValue(error);

      const service = new LeadCMSDataService();

      await expect(service.updateContent(1, { title: 'Updated' }))
        .rejects.toThrow('Authentication failed: Invalid or missing API key');
    });

    it('should create content type via API', async () => {
      const contentType = { uid: 'news', format: 'MDX', name: 'News' };

      mockedAxios.post.mockResolvedValue({ data: contentType });

      const service = new LeadCMSDataService();
      const result = await service.createContentType(contentType);

      expect(result).toEqual(contentType);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.example.com/api/content-types',
        contentType,
        {
          headers: {
            'Authorization': 'Bearer test-api-key',
            'Content-Type': 'application/json'
          }
        }
      );
    });

    it('should return null mock scenario in API mode', async () => {
      const service = new LeadCMSDataService();

      mockedAxios.get.mockResolvedValue({ data: [] });
      await service.getAllContent(); // Initialize

      expect(service.getMockScenario()).toBeNull();
    });

    it('should return null mock state in API mode', async () => {
      const service = new LeadCMSDataService();

      mockedAxios.get.mockResolvedValue({ data: [] });
      await service.getAllContent(); // Initialize

      expect(service.getMockState()).toBeNull();
    });

    it('should throw error when trying to switch scenario in API mode', async () => {
      const service = new LeadCMSDataService();

      mockedAxios.get.mockResolvedValue({ data: [] });
      await service.getAllContent(); // Initialize

      expect(() => service.switchMockScenario('test')).toThrow('Cannot switch scenario: not in mock mode');
    });

    it('should use NEXT_PUBLIC_LEADCMS_URL as fallback', async () => {
      delete process.env.LEADCMS_URL;
      process.env.NEXT_PUBLIC_LEADCMS_URL = 'https://next.example.com';

      mockedAxios.get.mockResolvedValue({ data: [] });

      const service = new LeadCMSDataService();
      await service.getAllContent();

      expect(mockedAxios.get).toHaveBeenCalledWith(
        'https://next.example.com/api/content/sync',
        expect.any(Object)
      );
    });
  });
});
