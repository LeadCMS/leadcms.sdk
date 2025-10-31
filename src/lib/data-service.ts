/**
 * LeadCMS Data Service - Unified interface for content operations
 * Handles API calls vs mock data internally using dependency injection pattern
 */

import axios, { AxiosResponse } from 'axios';

/**
 * Formats API validation errors in a user-friendly way
 */
function formatApiValidationErrors(errorResponse: any): string {
  if (!errorResponse?.data?.errors) {
    return 'Unknown validation error';
  }

  const errors = errorResponse.data.errors;
  const errorMessages: string[] = [];

  for (const [field, messages] of Object.entries(errors)) {
    if (Array.isArray(messages)) {
      messages.forEach((msg: string) => {
        errorMessages.push(`  • ${field}: ${msg}`);
      });
    }
  }

  return errorMessages.length > 0
    ? `\nValidation errors:\n${errorMessages.join('\n')}`
    : 'Validation failed';
}

/**
 * Formats authentication errors with helpful guidance
 */
function formatAuthenticationError(error: any): Error {
  const enhancedError = new Error(
    'Authentication failed: Invalid or missing API key\n' +
    '\n💡 To fix this:\n' +
    '   • Verify your LEADCMS_API_KEY in .env file is correct\n' +
    '   • Or run: leadcms login\n' +
    '   • Check that your API key has not expired'
  );
  (enhancedError as any).status = 401;
  (enhancedError as any).originalError = error;
  return enhancedError;
}// Type definitions
interface ContentItem {
  id?: number;
  slug: string;
  type: string;
  title: string;
  publishedAt?: string;
  updatedAt?: string;
  createdAt?: string;
  body?: string;
  language?: string;
  [key: string]: any;
}

interface ContentType {
  uid: string;
  format: string;
  name: string;
}

interface MockScenario {
  name: string;
  description: string;
  remoteContent: ContentItem[];
  contentTypes: Record<string, string>;
}

interface MockData {
  remoteContent: ContentItem[];
  contentTypes: Record<string, string>;
  scenario: string;
}



interface ApiHeaders {
  'Authorization': string;
  'Content-Type': string;
  [key: string]: string;
}

// Import mock scenarios inline to avoid TypeScript issues
const MOCK_SCENARIOS: Record<string, MockScenario> = {
  allNew: {
    name: 'All Content New',
    description: 'Local content that doesn\'t exist remotely',
    remoteContent: [],
    contentTypes: { article: 'MDX', page: 'JSON', blog: 'MDX' }
  },
  noChanges: {
    name: 'No Changes',
    description: 'All content is in sync',
    remoteContent: [
      {
        id: 1,
        slug: 'existing-article',
        type: 'article',
        title: 'Existing Article',
        publishedAt: '2024-10-29T10:00:00Z',
        updatedAt: '2024-10-29T10:00:00Z',
        body: 'This article exists both locally and remotely.'
      }
    ],
    contentTypes: { article: 'MDX', page: 'JSON', blog: 'MDX' }
  },
  hasConflicts: {
    name: 'Has Conflicts',
    description: 'Remote content is newer than local',
    remoteContent: [
      {
        id: 1,
        slug: 'conflicted-post',
        type: 'blog',
        title: 'Conflicted Post',
        publishedAt: '2024-10-29T10:00:00Z',
        updatedAt: '2024-10-29T12:00:00Z',
        body: 'This is the remote version that was updated after the local version.'
      }
    ],
    contentTypes: { article: 'MDX', page: 'JSON', blog: 'MDX' }
  },
  hasUpdates: {
    name: 'Has Updates',
    description: 'Local content is newer than remote',
    remoteContent: [
      {
        id: 1,
        slug: 'updated-post',
        type: 'blog',
        title: 'Updated Post',
        publishedAt: '2024-10-29T10:00:00Z',
        updatedAt: '2024-10-29T10:00:00Z',
        body: 'This is the original content.'
      }
    ],
    contentTypes: { article: 'MDX', page: 'JSON', blog: 'MDX' }
  },
  mixedOperations: {
    name: 'Mixed Operations',
    description: 'Mix of new, updated, and conflicted content',
    remoteContent: [
      {
        id: 1,
        slug: 'existing-post',
        type: 'blog',
        title: 'Existing Post',
        publishedAt: '2024-10-29T09:00:00Z',
        updatedAt: '2024-10-29T09:00:00Z',
        body: 'Original post content.'
      }
    ],
    contentTypes: { article: 'MDX', page: 'JSON', blog: 'MDX' }
  },
  missingContentTypes: {
    name: 'Missing Content Types',
    description: 'Content with unknown content types',
    remoteContent: [],
    contentTypes: { article: 'MDX', page: 'JSON', blog: 'MDX' }
  }
};

/**
 * Determine if we should use mock mode based on environment
 */
function shouldUseMock(): boolean {
  // Use mock in test environment
  if (process.env.NODE_ENV === 'test') {
    return true;
  }

  // Use mock only if explicitly requested
  if (process.env.LEADCMS_USE_MOCK === 'true') {
    return true;
  }

  return false;
}

/**
 * LeadCMS Data Service - Unified interface that abstracts API vs mock data
 */
class LeadCMSDataService {
  private initialized = false;
  private useMock = false;
  private mockScenario = 'allNew';
  private baseURL?: string;
  private apiKey?: string;
  private currentScenario?: MockScenario;
  private mockData?: MockData;

  /**
   * Initialize the service lazily when first used
   */
  private _initialize(): void {
    if (this.initialized) return;

    this.useMock = shouldUseMock();
    this.mockScenario = process.env.LEADCMS_MOCK_SCENARIO || 'allNew';
    // Use same fallback logic as helpers: LEADCMS_URL or NEXT_PUBLIC_LEADCMS_URL
    this.baseURL = process.env.LEADCMS_URL || process.env.NEXT_PUBLIC_LEADCMS_URL;
    this.apiKey = process.env.LEADCMS_API_KEY;

    // Initialize mock data if needed
    if (this.useMock) {
      this.initializeMockData();
      console.log(`[DATA SERVICE] Using mock mode with scenario: ${this.currentScenario?.name}`);
    } else {
      console.log(`[DATA SERVICE] Using real API mode: ${this.baseURL}`);
    }

    this.initialized = true;
  }

  private initializeMockData(): void {
    const scenario = MOCK_SCENARIOS[this.mockScenario];
    if (!scenario) {
      throw new Error(`Unknown mock scenario: ${this.mockScenario}`);
    }

    this.currentScenario = scenario;
    // Deep clone to avoid mutations
    this.mockData = {
      remoteContent: JSON.parse(JSON.stringify(scenario.remoteContent)),
      contentTypes: { ...scenario.contentTypes },
      scenario: scenario.name
    };
  }

  /**
   * Get HTTP headers for API calls
   */
  private getApiHeaders(): ApiHeaders {
    const headers: ApiHeaders = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    };

    return headers;
  }

  /**
   * Get all content from LeadCMS or mock data
   */
  async getAllContent(): Promise<ContentItem[]> {
    this._initialize();

    if (this.useMock && this.mockData) {
      console.log('[MOCK] Returning mock content data');
      // Simulate network delay
      await new Promise(resolve => setTimeout(resolve, 50));
      return [...this.mockData.remoteContent];
    }

    try {
      console.log('[API] Fetching content from LeadCMS...');

      if (!this.baseURL) {
        throw new Error('LeadCMS URL is not configured. Please set LEADCMS_URL or NEXT_PUBLIC_LEADCMS_URL in your .env file.');
      }

      const fullUrl = `${this.baseURL}/api/content/sync`;

      const response: AxiosResponse = await axios.get(fullUrl, {
        headers: this.getApiHeaders()
      });

      // Ensure we always return an array
      if (response.status === 204) {
        console.log('[API DEBUG] Status 204 - No Content');
        return [];
      }

      const data = response.data;
      if (!data) {
        console.log('[API DEBUG] No content data returned from API (data is falsy)');
        return [];
      }

      // Check if response has 'items' property (API wrapper format)
      let items: ContentItem[];
      if (data.items && Array.isArray(data.items)) {
        console.log(`[API] Found items array in response wrapper with ${data.items.length} items`);
        items = data.items;
      } else if (Array.isArray(data)) {
        console.log(`[API] Response data is direct array with ${data.length} items`);
        items = data;
      } else {
        console.warn('[API] API returned unexpected data format:', typeof data, data);
        return [];
      }

      console.log(`[API DEBUG] Successfully parsed ${items.length} content items`);
      return items;
    } catch (error: any) {
      console.error('[API] Failed to fetch content:', error.message);
      throw error;
    }
  }

  /**
   * Get all content types from LeadCMS or mock data
   */
  async getContentTypes(): Promise<ContentType[]> {
    this._initialize();

    if (this.useMock && this.mockData) {
      console.log('[MOCK] Returning mock content types');
      await new Promise(resolve => setTimeout(resolve, 30));
      return Object.entries(this.mockData.contentTypes).map(([uid, format]) => ({
        uid,
        format,
        name: uid.charAt(0).toUpperCase() + uid.slice(1)
      }));
    }

    try {
      console.log('[API] Fetching content types from LeadCMS...');

      if (!this.baseURL) {
        throw new Error('LeadCMS URL is not configured. Please set LEADCMS_URL or NEXT_PUBLIC_LEADCMS_URL in your .env file.');
      }

      const response: AxiosResponse<ContentType[]> = await axios.get(`${this.baseURL}/api/content-types`, {
        headers: this.getApiHeaders()
      });

      return response.data;
    } catch (error: any) {
      console.error('[API] Failed to fetch content types:', error.message);
      throw error;
    }
  }

  /**
   * Create new content in LeadCMS or mock
   */
  async createContent(content: Partial<ContentItem>): Promise<ContentItem> {
    this._initialize();

    if (this.useMock && this.mockData) {
      console.log(`[MOCK] Creating content: ${content.title}`);
      await new Promise(resolve => setTimeout(resolve, 100));

      const newContent: ContentItem = {
        ...content,
        id: Math.floor(Math.random() * 1000) + 100,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      } as ContentItem;

      this.mockData.remoteContent.push(newContent);
      return newContent;
    }

    try {
      console.log(`[API] Creating content: ${content.title}`);
      const response: AxiosResponse<ContentItem> = await axios.post(`${this.baseURL}/api/content`, content, {
        headers: this.getApiHeaders()
      });

      return response.data;
    } catch (error: any) {
      // Handle authentication errors (401)
      if (error.response?.status === 401) {
        throw formatAuthenticationError(error);
      }

      // Handle validation errors (422) with user-friendly formatting
      if (error.response?.status === 422 && error.response?.data?.errors) {
        const validationMessage = formatApiValidationErrors(error.response);

        // Create a more descriptive error with validation details
        // The error message will be displayed by the caller, so we don't log it here
        const enhancedError = new Error(`Validation failed${validationMessage}`);
        (enhancedError as any).status = 422;
        (enhancedError as any).validationErrors = error.response.data.errors;
        throw enhancedError;
      }

      // For other errors, log detailed information
      console.error(`[API] Failed to create content:`, error.message);
      if (error.response) {
        console.error(`[API] Status: ${error.response.status}`);
        console.error(`[API] Response data:`, JSON.stringify(error.response.data, null, 2));
      }

      throw error;
    }
  }

  /**
   * Update existing content in LeadCMS or mock
   */
  async updateContent(id: number, content: Partial<ContentItem>): Promise<ContentItem> {
    this._initialize();

    if (this.useMock && this.mockData) {
      console.log(`[MOCK] Updating content ID ${id}: ${content.title}`);
      await new Promise(resolve => setTimeout(resolve, 80));

      const existingIndex = this.mockData.remoteContent.findIndex(c => c.id === id);
      if (existingIndex === -1) {
        throw new Error(`Content with id ${id} not found`);
      }

      const updatedContent: ContentItem = {
        ...this.mockData.remoteContent[existingIndex],
        ...content,
        updatedAt: new Date().toISOString()
      };

      this.mockData.remoteContent[existingIndex] = updatedContent;
      return updatedContent;
    }

    try {
      console.log(`[API] Updating content ID ${id}: ${content.title}`);
      const response: AxiosResponse<ContentItem> = await axios.put(`${this.baseURL}/api/content/${id}`, content, {
        headers: this.getApiHeaders()
      });

      return response.data;
    } catch (error: any) {
      // Handle authentication errors (401)
      if (error.response?.status === 401) {
        throw formatAuthenticationError(error);
      }

      // Handle validation errors (422) with user-friendly formatting
      if (error.response?.status === 422 && error.response?.data?.errors) {
        const validationMessage = formatApiValidationErrors(error.response);

        // Create a more descriptive error with validation details
        // The error message will be displayed by the caller, so we don't log it here
        const enhancedError = new Error(`Validation failed${validationMessage}`);
        (enhancedError as any).status = 422;
        (enhancedError as any).validationErrors = error.response.data.errors;
        throw enhancedError;
      }

      // For other errors, log detailed information
      console.error(`[API] Failed to update content:`, error.message);
      if (error.response) {
        console.error(`[API] Status: ${error.response.status}`);
        console.error(`[API] Response data:`, JSON.stringify(error.response.data, null, 2));
      }

      throw error;
    }
  }



  /**
   * Create content type in LeadCMS or mock
   */
  async createContentType(contentType: Partial<ContentType>): Promise<ContentType> {
    this._initialize();

    if (this.useMock && this.mockData && contentType.uid && contentType.format) {
      console.log(`[MOCK] Creating content type: ${contentType.uid}`);
      await new Promise(resolve => setTimeout(resolve, 60));

      this.mockData.contentTypes[contentType.uid] = contentType.format;
      return {
        uid: contentType.uid,
        format: contentType.format,
        name: contentType.name || contentType.uid.charAt(0).toUpperCase() + contentType.uid.slice(1)
      };
    }

    try {
      console.log(`[API] Creating content type: ${contentType.uid}`);
      const response: AxiosResponse<ContentType> = await axios.post(`${this.baseURL}/api/content-types`, contentType, {
        headers: this.getApiHeaders()
      });

      return response.data;
    } catch (error: any) {
      console.error(`[API] Failed to create content type:`, error.message);
      throw error;
    }
  }

  /**
   * Check if we're using mock data
   */
  isMockMode(): boolean {
    this._initialize();
    return this.useMock;
  }

  /**
   * Get current mock scenario name
   */
  getMockScenario(): string | null {
    this._initialize();
    return this.useMock ? this.currentScenario?.name || null : null;
  }

  /**
   * Switch mock scenario (only in mock mode)
   */
  switchMockScenario(scenarioKey: string): MockData {
    this._initialize();

    if (!this.useMock) {
      throw new Error('Cannot switch scenario: not in mock mode');
    }

    const scenario = MOCK_SCENARIOS[scenarioKey];
    if (!scenario) {
      throw new Error(`Unknown scenario: ${scenarioKey}`);
    }

    this.currentScenario = scenario;
    this.mockData = {
      remoteContent: JSON.parse(JSON.stringify(scenario.remoteContent)),
      contentTypes: { ...scenario.contentTypes },
      scenario: scenario.name
    };

    console.log(`[MOCK] Switched to scenario: ${scenario.name}`);
    return this.mockData;
  }

  /**
   * Get current mock state (for testing)
   */
  getMockState(): MockData | null {
    this._initialize();

    if (!this.useMock || !this.mockData) {
      return null;
    }

    return {
      remoteContent: [...this.mockData.remoteContent],
      contentTypes: { ...this.mockData.contentTypes },
      scenario: this.currentScenario?.name || ''
    };
  }

  /**
   * Reset mock data to original scenario state
   */
  resetMockData(): void {
    this._initialize();

    if (this.useMock) {
      this.initializeMockData();
    }
  }
}

// Create and export singleton instance
export const leadCMSDataService = new LeadCMSDataService();

// Export class for testing
export { LeadCMSDataService };

// Export types for use in other modules
export type { ContentItem, ContentType, MockScenario, MockData };
