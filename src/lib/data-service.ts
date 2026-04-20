/**
 * LeadCMS Data Service - Unified interface for content operations
 * Handles API calls vs mock data internally using dependency injection pattern
 */

import axios, { AxiosResponse } from 'axios';
import { logger } from './logger.js';
import type { Comment as CommentItem } from './comment-types.js';
import type {
  SegmentDetailsDto, SegmentCreateDto, SegmentUpdateDto,
  SequenceDetailsDto, SequenceCreateDto, SequenceUpdateDto,
} from './automation-types.js';

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
 * Extracts a readable API error message from common backend error shapes.
 */
function formatApiErrorTitle(errorResponse: any): string {
  const data = errorResponse?.data;

  if (typeof data?.title === 'string' && data.title.trim()) {
    return data.title.trim();
  }

  if (typeof data?.detail === 'string' && data.detail.trim()) {
    return data.detail.trim();
  }

  if (typeof data?.message === 'string' && data.message.trim()) {
    return data.message.trim();
  }

  if (Array.isArray(data?.errors) && data.errors.length > 0) {
    return String(data.errors[0]);
  }

  return 'Unknown validation error';
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
  supportsSEO?: boolean;
  supportsComments?: boolean;
  supportsCoverImage?: boolean;
  slugPrefix?: string | null;
  slugPostfix?: string | null;
}

export interface UserIdentity {
  displayName: string;
  email: string;
  userName: string;
  id?: string;
  avatarUrl?: string;
}

interface EmailTemplateItem {
  id?: number;
  name?: string;
  subject?: string;
  bodyTemplate?: string;
  fromEmail?: string;
  fromName?: string;
  language?: string;
  translationKey?: string | null;
  emailGroupId?: number | null;
  createdAt?: string;
  updatedAt?: string | null;
  emailGroup?: Record<string, any> | null;
  [key: string]: any;
}

interface EmailGroupItem {
  id?: number;
  name?: string;
  language?: string;
  translationKey?: string | null;
  createdAt?: string;
  updatedAt?: string | null;
  [key: string]: any;
}

interface CommentCreateItem {
  authorEmail: string;
  body: string;
  commentableType: string;
  authorName?: string;
  contactId?: number | null;
  parentId?: number | null;
  source?: string | null;
  language?: string;
  translationKey?: string | null;
  tags?: string[] | null;
  commentableId?: number | null;
  commentableUid?: string | null;
  status?: 'NotApproved' | 'Approved' | 'Spam' | 'Answer';
  answerStatus?: 'Unanswered' | 'Answered' | 'Closed';
  publishedAt?: string | null;
}

interface CommentUpdateItem {
  body?: string;
  authorName?: string;
  language?: string;
  status?: 'NotApproved' | 'Approved' | 'Spam' | 'Answer';
  answerStatus?: 'Unanswered' | 'Answered' | 'Closed';
  translationKey?: string | null;
  tags?: string[] | null;
  publishedAt?: string | null;
}

export interface MediaItem {
  id: number;
  location: string;
  scopeUid: string;
  name: string;
  description?: string | null;
  size: number;
  extension: string;
  mimeType: string;
  createdAt: string;
  updatedAt?: string | null;
}

interface MockScenario {
  name: string;
  description: string;
  remoteContent: ContentItem[];
  contentTypes: Record<string, string>;
  remoteMedia: MediaItem[];
  emailTemplates?: EmailTemplateItem[];
  emailGroups?: EmailGroupItem[];
  comments?: CommentItem[];
  segments?: SegmentDetailsDto[];
  sequences?: SequenceDetailsDto[];
}

interface MockData {
  remoteContent: ContentItem[];
  contentTypes: Record<string, string>;
  remoteMedia: MediaItem[];
  emailTemplates: EmailTemplateItem[];
  emailGroups: EmailGroupItem[];
  comments: CommentItem[];
  segments: SegmentDetailsDto[];
  sequences: SequenceDetailsDto[];
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
    contentTypes: { article: 'MDX', page: 'JSON', blog: 'MDX' },
    remoteMedia: []
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
    contentTypes: { article: 'MDX', page: 'JSON', blog: 'MDX' },
    remoteMedia: [
      {
        id: 1,
        location: '/api/media/blog/hero.jpg',
        scopeUid: 'blog',
        name: 'hero.jpg',
        description: null,
        size: 245760,
        extension: '.jpg',
        mimeType: 'image/jpeg',
        createdAt: '2024-10-29T10:00:00Z',
        updatedAt: null
      }
    ]
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
    contentTypes: { article: 'MDX', page: 'JSON', blog: 'MDX' },
    remoteMedia: []
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
    contentTypes: { article: 'MDX', page: 'JSON', blog: 'MDX' },
    remoteMedia: []
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
    contentTypes: { article: 'MDX', page: 'JSON', blog: 'MDX' },
    remoteMedia: [
      {
        id: 1,
        location: '/api/media/privacy-policy/bg-image.avif',
        scopeUid: 'privacy-policy',
        name: 'bg-image.avif',
        description: null,
        size: 780720,
        extension: '.avif',
        mimeType: 'image/avif',
        createdAt: '2025-06-16T06:57:41.017481Z',
        updatedAt: '2025-06-16T06:59:09.014782Z'
      }
    ]
  },
  missingContentTypes: {
    name: 'Missing Content Types',
    description: 'Content with unknown content types',
    remoteContent: [],
    contentTypes: { article: 'MDX', page: 'JSON', blog: 'MDX' },
    remoteMedia: []
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
    this.baseURL = (process.env.LEADCMS_URL || process.env.NEXT_PUBLIC_LEADCMS_URL || '').replace(/\/+$/, '') || undefined;
    this.apiKey = process.env.LEADCMS_API_KEY;

    // Initialize mock data if needed
    if (this.useMock) {
      this.initializeMockData();
      logger.verbose(`[DATA SERVICE] Using mock mode with scenario: ${this.currentScenario?.name}`);
    } else {
      logger.verbose(`[DATA SERVICE] Using real API mode: ${this.baseURL}`);
    }

    this.initialized = true;
  }

  /**
   * Configure the data service to target a specific remote.
   * Call this before any API operations when working with multi-remote configs.
   * Overrides the lazy initialization from environment variables.
   */
  configureForRemote(url: string, apiKey?: string): void {
    this._initialize();
    this.baseURL = url.replace(/\/+$/, '') || undefined;
    this.apiKey = apiKey;
    logger.verbose(`[DATA SERVICE] Configured for remote: ${this.baseURL}`);
  }

  /**
   * Return the currently configured base URL.
   * Triggers lazy initialization if not yet initialized.
   */
  getBaseUrl(): string | undefined {
    this._initialize();
    return this.baseURL;
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
      remoteMedia: JSON.parse(JSON.stringify(scenario.remoteMedia)),
      emailTemplates: JSON.parse(JSON.stringify(scenario.emailTemplates || [])),
      emailGroups: JSON.parse(JSON.stringify(scenario.emailGroups || [])),
      comments: JSON.parse(JSON.stringify(scenario.comments || [])),
      segments: JSON.parse(JSON.stringify(scenario.segments || [])),
      sequences: JSON.parse(JSON.stringify(scenario.sequences || [])),
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
      logger.verbose('[MOCK] Returning mock content data');
      // Simulate network delay
      return [...this.mockData.remoteContent];
    }

    try {
      logger.verbose('[API] Fetching content from LeadCMS...');

      if (!this.baseURL) {
        throw new Error('LeadCMS URL is not configured. Please set LEADCMS_URL or NEXT_PUBLIC_LEADCMS_URL in your .env file.');
      }

      const fullUrl = `${this.baseURL}/api/content/sync`;

      const response: AxiosResponse = await axios.get(fullUrl, {
        headers: this.getApiHeaders()
      });

      // Ensure we always return an array
      if (response.status === 204) {
        logger.verbose('[API DEBUG] Status 204 - No Content');
        return [];
      }

      const data = response.data;
      if (!data) {
        logger.verbose('[API DEBUG] No content data returned from API (data is falsy)');
        return [];
      }

      // Check if response has 'items' property (API wrapper format)
      let items: ContentItem[];
      if (data.items && Array.isArray(data.items)) {
        logger.verbose(`[API] Found items array in response wrapper with ${data.items.length} items`);
        items = data.items;
      } else if (Array.isArray(data)) {
        logger.verbose(`[API] Response data is direct array with ${data.length} items`);
        items = data;
      } else {
        console.warn('[API] API returned unexpected data format:', typeof data, data);
        return [];
      }

      logger.verbose(`[API DEBUG] Successfully parsed ${items.length} content items`);
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
      logger.verbose('[MOCK] Returning mock content types');
      return Object.entries(this.mockData.contentTypes).map(([uid, format]) => ({
        uid,
        format,
        name: uid.charAt(0).toUpperCase() + uid.slice(1)
      }));
    }

    try {
      logger.verbose('[API] Fetching content types from LeadCMS...');

      if (!this.baseURL) {
        throw new Error('LeadCMS URL is not configured. Please set LEADCMS_URL or NEXT_PUBLIC_LEADCMS_URL in your .env file.');
      }

      const response: AxiosResponse = await axios.get(`${this.baseURL}/api/content-types`, {
        headers: this.getApiHeaders()
      });

      const data = response.data;

      // /api/content-types returns a direct array (not a sync API)
      if (Array.isArray(data)) {
        return data;
      }

      logger.verbose('[API] Content types response is not an array, returning empty array');
      return [];
    } catch (error: any) {
      console.error('[API] Failed to fetch content types:', error.message);
      throw error;
    }
  }

  /**
   * Get all categories for a given language from LeadCMS
   */
  async getCategories(language?: string): Promise<string[]> {
    this._initialize();

    if (this.useMock) {
      return [];
    }

    try {
      logger.verbose('[API] Fetching categories from LeadCMS...');

      if (!this.baseURL) {
        throw new Error('LeadCMS URL is not configured.');
      }

      const url = new URL('/api/content/categories', this.baseURL);
      if (language) {
        url.searchParams.set('language', language);
      }

      const response: AxiosResponse = await axios.get(url.toString(), {
        headers: this.getApiHeaders()
      });

      return Array.isArray(response.data) ? response.data : [];
    } catch (error: any) {
      logger.verbose(`[API] Failed to fetch categories: ${error.message}`);
      return [];
    }
  }

  /**
   * Get all tags for a given language from LeadCMS
   */
  async getTags(language?: string): Promise<string[]> {
    this._initialize();

    if (this.useMock) {
      return [];
    }

    try {
      logger.verbose('[API] Fetching tags from LeadCMS...');

      if (!this.baseURL) {
        throw new Error('LeadCMS URL is not configured.');
      }

      const url = new URL('/api/content/tags', this.baseURL);
      if (language) {
        url.searchParams.set('language', language);
      }

      const response: AxiosResponse = await axios.get(url.toString(), {
        headers: this.getApiHeaders()
      });

      return Array.isArray(response.data) ? response.data : [];
    } catch (error: any) {
      logger.verbose(`[API] Failed to fetch tags: ${error.message}`);
      return [];
    }
  }

  /**
   * Get a specific content item by ID
   */
  async getContentById(id: number): Promise<ContentItem | null> {
    this._initialize();

    if (this.useMock && this.mockData) {
      logger.verbose(`[MOCK] Getting content with ID: ${id}`);
      const content = this.mockData.remoteContent.find(c => c.id === id);
      return content || null;
    }

    try {
      logger.verbose(`[API] Fetching content with ID: ${id}`);

      if (!this.baseURL) {
        throw new Error('LeadCMS URL is not configured.');
      }

      const response: AxiosResponse<ContentItem> = await axios.get(
        `${this.baseURL}/api/content/${id}`,
        {
          headers: this.getApiHeaders()
        }
      );

      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        logger.verbose(`[API] Content with ID ${id} not found`);
        return null;
      }

      if (error.response?.status === 401) {
        throw formatAuthenticationError(error);
      }

      console.error(`[API] Failed to fetch content by ID ${id}:`, error.message);
      throw error;
    }
  }

  /**
   * Get content by slug and language
   */
  async getContentBySlug(slug: string, language?: string): Promise<ContentItem | null> {
    this._initialize();

    const allContent = await this.getAllContent();
    const content = allContent.find(c =>
      c.slug === slug && (!language || c.language === language)
    );

    return content || null;
  }

  /**
   * Create new content in LeadCMS or mock
   */
  async createContent(content: Partial<ContentItem>): Promise<ContentItem> {
    this._initialize();

    if (this.useMock && this.mockData) {
      logger.verbose(`[MOCK] Creating content: ${content.title}`);

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
      logger.verbose(`[API] Creating content: ${content.title}`);
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
      logger.verbose(`[MOCK] Updating content ID ${id}: ${content.title}`);

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
      logger.verbose(`[API] Updating content ID ${id}: ${content.title}`);
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
   * Delete content from LeadCMS
   */
  async deleteContent(id: number): Promise<void> {
    this._initialize();

    if (this.useMock && this.mockData) {
      logger.verbose(`[MOCK] Deleting content with ID: ${id}`);

      // Remove from mock data
      const index = this.mockData.remoteContent.findIndex(c => c.id === id);
      if (index !== -1) {
        this.mockData.remoteContent.splice(index, 1);
      }
      return;
    }

    try {
      logger.verbose(`[API] Deleting content with ID: ${id}`);

      if (!this.baseURL) {
        throw new Error('LeadCMS URL is not configured.');
      }

      await axios.delete(
        `${this.baseURL}/api/content/${id}`,
        {
          headers: this.getApiHeaders()
        }
      );

      logger.verbose('[API] Content deleted successfully');
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw formatAuthenticationError(error);
      }

      if (error.response?.status === 422) {
        const enhancedError = new Error(
          `Content validation failed: ${formatApiValidationErrors(error.response)}`
        );
        (enhancedError as any).status = 422;
        (enhancedError as any).validationErrors = error.response.data.errors;
        throw enhancedError;
      }

      console.error('[API] Failed to delete content:', error.message);
      throw error;
    }
  }

  /**
   * Get all email templates from LeadCMS or mock data
   */
  async getAllEmailTemplates(): Promise<EmailTemplateItem[]> {
    this._initialize();

    if (this.useMock && this.mockData) {
      logger.verbose('[MOCK] Returning mock email templates');
      return [...this.mockData.emailTemplates];
    }

    if (!this.apiKey) {
      logger.verbose('[API] Email templates require authentication — no API key configured, skipping');
      return [];
    }

    try {
      logger.verbose('[API] Fetching email templates from LeadCMS...');

      if (!this.baseURL) {
        throw new Error('LeadCMS URL is not configured.');
      }

      const response: AxiosResponse<EmailTemplateItem[]> = await axios.get(
        `${this.baseURL}/api/email-templates`,
        { headers: this.getApiHeaders() }
      );

      return Array.isArray(response.data) ? response.data : [];
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw formatAuthenticationError(error);
      }

      console.error('[API] Failed to fetch email templates:', error.message);
      throw error;
    }
  }

  /**
   * Get all email groups from LeadCMS or mock data
   */
  async getAllEmailGroups(): Promise<EmailGroupItem[]> {
    this._initialize();

    if (this.useMock && this.mockData) {
      logger.verbose('[MOCK] Returning mock email groups');
      return [...this.mockData.emailGroups];
    }

    if (!this.apiKey) {
      logger.verbose('[API] Email groups require authentication — no API key configured, skipping');
      return [];
    }

    try {
      logger.verbose('[API] Fetching email groups from LeadCMS...');

      if (!this.baseURL) {
        throw new Error('LeadCMS URL is not configured.');
      }

      const response: AxiosResponse<EmailGroupItem[]> = await axios.get(
        `${this.baseURL}/api/email-groups`,
        { headers: this.getApiHeaders() }
      );

      return Array.isArray(response.data) ? response.data : [];
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw formatAuthenticationError(error);
      }

      console.error('[API] Failed to fetch email groups:', error.message);
      throw error;
    }
  }

  /**
   * Create a new email group in LeadCMS or mock
   */
  async createEmailGroup(group: { name: string; language: string; translationKey?: string | null }): Promise<EmailGroupItem> {
    this._initialize();

    if (this.useMock && this.mockData) {
      logger.verbose(`[MOCK] Creating email group: ${group.name}`);

      const newGroup: EmailGroupItem = {
        ...group,
        id: Math.floor(Math.random() * 1000) + 100,
        createdAt: new Date().toISOString(),
        updatedAt: null,
      };
      this.mockData.emailGroups.push(newGroup);
      return newGroup;
    }

    if (!this.apiKey) {
      throw new Error('Email group operations require authentication. Please configure LEADCMS_API_KEY.');
    }

    try {
      logger.verbose(`[API] Creating email group: ${group.name}`);

      if (!this.baseURL) {
        throw new Error('LeadCMS URL is not configured.');
      }

      const response: AxiosResponse<EmailGroupItem> = await axios.post(
        `${this.baseURL}/api/email-groups`,
        group,
        { headers: this.getApiHeaders() }
      );

      return response.data;
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw formatAuthenticationError(error);
      }

      console.error(`[API] Failed to create email group '${group.name}':`, error.message);
      throw error;
    }
  }

  /**
   * Create new comment in LeadCMS or mock.
   */
  async createComment(comment: CommentCreateItem): Promise<CommentItem> {
    this._initialize();

    if (this.useMock && this.mockData) {
      logger.verbose(`[MOCK] Creating comment for ${comment.commentableType}`);

      const newComment: CommentItem = {
        id: Math.floor(Math.random() * 1000) + 100,
        authorName: comment.authorName || '',
        authorEmail: comment.authorEmail,
        body: comment.body,
        status: comment.status,
        answerStatus: comment.answerStatus,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        commentableId: comment.commentableId || 0,
        commentableType: comment.commentableType,
        language: comment.language || 'en',
        parentId: comment.parentId,
        translationKey: comment.translationKey,
        contactId: comment.contactId,
        source: comment.source,
        tags: comment.tags,
      };

      this.mockData.comments.push(newComment);
      return newComment;
    }

    if (!this.apiKey) {
      throw new Error('Comment operations require authentication. Please configure LEADCMS_API_KEY.');
    }

    try {
      logger.verbose(`[API] Creating comment for ${comment.commentableType}`);
      const response: AxiosResponse<CommentItem> = await axios.post(
        `${this.baseURL}/api/comments`,
        comment,
        { headers: this.getApiHeaders() }
      );

      return response.data;
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw formatAuthenticationError(error);
      }

      if (error.response?.status === 422) {
        const hasValidationMap = Boolean(error.response?.data?.errors);
        const validationMessage = hasValidationMap
          ? formatApiValidationErrors(error.response)
          : formatApiErrorTitle(error.response);
        const enhancedError = hasValidationMap
          ? new Error(`Validation failed${validationMessage}`)
          : new Error(`Validation failed: ${validationMessage}`);
        (enhancedError as any).status = 422;
        if (hasValidationMap) {
          (enhancedError as any).validationErrors = error.response.data.errors;
        }
        throw enhancedError;
      }

      console.error('[API] Failed to create comment:', error.message);
      throw error;
    }
  }

  /**
   * Update existing comment in LeadCMS or mock.
   */
  async updateComment(id: number, comment: CommentUpdateItem): Promise<CommentItem> {
    this._initialize();

    if (this.useMock && this.mockData) {
      logger.verbose(`[MOCK] Updating comment ID ${id}`);

      const existingIndex = this.mockData.comments.findIndex(c => c.id === id);
      if (existingIndex === -1) {
        throw new Error(`Comment with id ${id} not found`);
      }

      const updatedComment: CommentItem = {
        ...this.mockData.comments[existingIndex],
        ...comment,
        updatedAt: new Date().toISOString(),
      };

      this.mockData.comments[existingIndex] = updatedComment;
      return updatedComment;
    }

    if (!this.apiKey) {
      throw new Error('Comment operations require authentication. Please configure LEADCMS_API_KEY.');
    }

    try {
      logger.verbose(`[API] Updating comment ID ${id}`);
      const response: AxiosResponse<CommentItem> = await axios.patch(
        `${this.baseURL}/api/comments/${id}`,
        comment,
        { headers: this.getApiHeaders() }
      );

      return response.data;
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw formatAuthenticationError(error);
      }

      if (error.response?.status === 422) {
        const hasValidationMap = Boolean(error.response?.data?.errors);
        const validationMessage = hasValidationMap
          ? formatApiValidationErrors(error.response)
          : formatApiErrorTitle(error.response);
        const enhancedError = hasValidationMap
          ? new Error(`Validation failed${validationMessage}`)
          : new Error(`Validation failed: ${validationMessage}`);
        (enhancedError as any).status = 422;
        if (hasValidationMap) {
          (enhancedError as any).validationErrors = error.response.data.errors;
        }
        throw enhancedError;
      }

      console.error('[API] Failed to update comment:', error.message);
      throw error;
    }
  }

  /**
   * Delete comment from LeadCMS.
   */
  async deleteComment(id: number): Promise<void> {
    this._initialize();

    if (this.useMock && this.mockData) {
      logger.verbose(`[MOCK] Deleting comment with ID: ${id}`);
      const index = this.mockData.comments.findIndex(c => c.id === id);
      if (index !== -1) {
        this.mockData.comments.splice(index, 1);
      }
      return;
    }

    if (!this.apiKey) {
      throw new Error('Comment operations require authentication. Please configure LEADCMS_API_KEY.');
    }

    try {
      logger.verbose(`[API] Deleting comment with ID: ${id}`);

      await axios.delete(`${this.baseURL}/api/comments/${id}`, {
        headers: this.getApiHeaders(),
      });
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw formatAuthenticationError(error);
      }

      if (error.response?.status === 422) {
        const enhancedError = new Error(
          `Comment validation failed: ${formatApiValidationErrors(error.response)}`
        );
        (enhancedError as any).status = 422;
        (enhancedError as any).validationErrors = error.response.data.errors;
        throw enhancedError;
      }

      console.error('[API] Failed to delete comment:', error.message);
      throw error;
    }
  }

  /**
   * Create new email template in LeadCMS or mock
   */
  async createEmailTemplate(template: Partial<EmailTemplateItem>): Promise<EmailTemplateItem> {
    this._initialize();

    if (this.useMock && this.mockData) {
      logger.verbose(`[MOCK] Creating email template: ${template.name}`);

      const newTemplate: EmailTemplateItem = {
        ...template,
        id: Math.floor(Math.random() * 1000) + 100,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as EmailTemplateItem;

      this.mockData.emailTemplates.push(newTemplate);
      return newTemplate;
    }

    if (!this.apiKey) {
      throw new Error('Email template operations require authentication. Please configure LEADCMS_API_KEY.');
    }

    try {
      logger.verbose(`[API] Creating email template: ${template.name}`);
      const response: AxiosResponse<EmailTemplateItem> = await axios.post(
        `${this.baseURL}/api/email-templates`,
        template,
        { headers: this.getApiHeaders() }
      );

      return response.data;
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw formatAuthenticationError(error);
      }

      if (error.response?.status === 422 && error.response?.data?.errors) {
        const validationMessage = formatApiValidationErrors(error.response);
        const enhancedError = new Error(`Validation failed${validationMessage}`);
        (enhancedError as any).status = 422;
        (enhancedError as any).validationErrors = error.response.data.errors;
        throw enhancedError;
      }

      console.error('[API] Failed to create email template:', error.message);
      throw error;
    }
  }

  /**
   * Update existing email template in LeadCMS or mock
   */
  async updateEmailTemplate(id: number, template: Partial<EmailTemplateItem>): Promise<EmailTemplateItem> {
    this._initialize();

    if (this.useMock && this.mockData) {
      logger.verbose(`[MOCK] Updating email template ID ${id}: ${template.name}`);

      const existingIndex = this.mockData.emailTemplates.findIndex(t => t.id === id);
      if (existingIndex === -1) {
        throw new Error(`Email template with id ${id} not found`);
      }

      const updatedTemplate: EmailTemplateItem = {
        ...this.mockData.emailTemplates[existingIndex],
        ...template,
        updatedAt: new Date().toISOString(),
      };

      this.mockData.emailTemplates[existingIndex] = updatedTemplate;
      return updatedTemplate;
    }

    if (!this.apiKey) {
      throw new Error('Email template operations require authentication. Please configure LEADCMS_API_KEY.');
    }

    try {
      logger.verbose(`[API] Updating email template ID ${id}: ${template.name}`);
      const response: AxiosResponse<EmailTemplateItem> = await axios.patch(
        `${this.baseURL}/api/email-templates/${id}`,
        template,
        { headers: this.getApiHeaders() }
      );

      return response.data;
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw formatAuthenticationError(error);
      }

      if (error.response?.status === 422 && error.response?.data?.errors) {
        const validationMessage = formatApiValidationErrors(error.response);
        const enhancedError = new Error(`Validation failed${validationMessage}`);
        (enhancedError as any).status = 422;
        (enhancedError as any).validationErrors = error.response.data.errors;
        throw enhancedError;
      }

      console.error('[API] Failed to update email template:', error.message);
      throw error;
    }
  }

  /**
   * Delete email template from LeadCMS
   */
  async deleteEmailTemplate(id: number): Promise<void> {
    this._initialize();

    if (this.useMock && this.mockData) {
      logger.verbose(`[MOCK] Deleting email template with ID: ${id}`);

      const index = this.mockData.emailTemplates.findIndex(t => t.id === id);
      if (index !== -1) {
        this.mockData.emailTemplates.splice(index, 1);
      }
      return;
    }

    if (!this.apiKey) {
      throw new Error('Email template operations require authentication. Please configure LEADCMS_API_KEY.');
    }

    try {
      logger.verbose(`[API] Deleting email template with ID: ${id}`);

      if (!this.baseURL) {
        throw new Error('LeadCMS URL is not configured.');
      }

      await axios.delete(`${this.baseURL}/api/email-templates/${id}`, {
        headers: this.getApiHeaders(),
      });

      logger.verbose('[API] Email template deleted successfully');
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw formatAuthenticationError(error);
      }

      if (error.response?.status === 422) {
        const enhancedError = new Error(
          `Email template validation failed: ${formatApiValidationErrors(error.response)}`
        );
        (enhancedError as any).status = 422;
        (enhancedError as any).validationErrors = error.response.data.errors;
        throw enhancedError;
      }

      console.error('[API] Failed to delete email template:', error.message);
      throw error;
    }
  }

  // ── Segment CRUD ──────────────────────────────────────────────────────

  /**
   * Get all segments from LeadCMS or mock data
   */
  async getAllSegments(): Promise<SegmentDetailsDto[]> {
    this._initialize();

    if (this.useMock && this.mockData) {
      logger.verbose('[MOCK] Returning mock segments');
      return [...this.mockData.segments];
    }

    if (!this.apiKey) {
      logger.verbose('[API] Segments require authentication — no API key configured, skipping');
      return [];
    }

    try {
      logger.verbose('[API] Fetching segments from LeadCMS...');

      if (!this.baseURL) {
        throw new Error('LeadCMS URL is not configured.');
      }

      const response: AxiosResponse<SegmentDetailsDto[]> = await axios.get(
        `${this.baseURL}/api/segments`,
        { headers: this.getApiHeaders() }
      );

      return Array.isArray(response.data) ? response.data : [];
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw formatAuthenticationError(error);
      }

      console.error('[API] Failed to fetch segments:', error.message);
      throw error;
    }
  }

  /**
   * Create a new segment in LeadCMS or mock
   */
  async createSegment(segment: SegmentCreateDto): Promise<SegmentDetailsDto> {
    this._initialize();

    if (this.useMock && this.mockData) {
      logger.verbose(`[MOCK] Creating segment: ${segment.name}`);

      const newSegment: SegmentDetailsDto = {
        ...segment,
        id: Math.floor(Math.random() * 1000) + 100,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      this.mockData.segments.push(newSegment);
      return newSegment;
    }

    if (!this.apiKey) {
      throw new Error('Segment operations require authentication. Please configure LEADCMS_API_KEY.');
    }

    try {
      logger.verbose(`[API] Creating segment: ${segment.name}`);
      const response: AxiosResponse<SegmentDetailsDto> = await axios.post(
        `${this.baseURL}/api/segments`,
        segment,
        { headers: this.getApiHeaders() }
      );

      return response.data;
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw formatAuthenticationError(error);
      }

      if (error.response?.status === 422 && error.response?.data?.errors) {
        const validationMessage = formatApiValidationErrors(error.response);
        const enhancedError = new Error(`Validation failed${validationMessage}`);
        (enhancedError as any).status = 422;
        (enhancedError as any).validationErrors = error.response.data.errors;
        throw enhancedError;
      }

      console.error('[API] Failed to create segment:', error.message);
      throw error;
    }
  }

  /**
   * Update existing segment in LeadCMS or mock
   */
  async updateSegment(id: number, segment: SegmentUpdateDto): Promise<SegmentDetailsDto> {
    this._initialize();

    if (this.useMock && this.mockData) {
      logger.verbose(`[MOCK] Updating segment ID ${id}: ${segment.name}`);

      const existingIndex = this.mockData.segments.findIndex(s => s.id === id);
      if (existingIndex === -1) {
        throw new Error(`Segment with id ${id} not found`);
      }

      const updatedSegment: SegmentDetailsDto = {
        ...this.mockData.segments[existingIndex],
        ...segment,
        name: segment.name ?? this.mockData.segments[existingIndex].name,
        updatedAt: new Date().toISOString(),
      };

      this.mockData.segments[existingIndex] = updatedSegment;
      return updatedSegment;
    }

    if (!this.apiKey) {
      throw new Error('Segment operations require authentication. Please configure LEADCMS_API_KEY.');
    }

    try {
      logger.verbose(`[API] Updating segment ID ${id}`);
      const response: AxiosResponse<SegmentDetailsDto> = await axios.patch(
        `${this.baseURL}/api/segments/${id}`,
        segment,
        { headers: this.getApiHeaders() }
      );

      return response.data;
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw formatAuthenticationError(error);
      }

      if (error.response?.status === 422 && error.response?.data?.errors) {
        const validationMessage = formatApiValidationErrors(error.response);
        const enhancedError = new Error(`Validation failed${validationMessage}`);
        (enhancedError as any).status = 422;
        (enhancedError as any).validationErrors = error.response.data.errors;
        throw enhancedError;
      }

      console.error('[API] Failed to update segment:', error.message);
      throw error;
    }
  }

  /**
   * Delete segment from LeadCMS
   */
  async deleteSegment(id: number): Promise<void> {
    this._initialize();

    if (this.useMock && this.mockData) {
      logger.verbose(`[MOCK] Deleting segment with ID: ${id}`);
      const index = this.mockData.segments.findIndex(s => s.id === id);
      if (index !== -1) {
        this.mockData.segments.splice(index, 1);
      }
      return;
    }

    if (!this.apiKey) {
      throw new Error('Segment operations require authentication. Please configure LEADCMS_API_KEY.');
    }

    try {
      logger.verbose(`[API] Deleting segment with ID: ${id}`);

      if (!this.baseURL) {
        throw new Error('LeadCMS URL is not configured.');
      }

      await axios.delete(`${this.baseURL}/api/segments/${id}`, {
        headers: this.getApiHeaders(),
      });
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw formatAuthenticationError(error);
      }

      console.error('[API] Failed to delete segment:', error.message);
      throw error;
    }
  }

  // ── Sequence CRUD ─────────────────────────────────────────────────────

  /**
   * Get all sequences from LeadCMS or mock data
   */
  async getAllSequences(): Promise<SequenceDetailsDto[]> {
    this._initialize();

    if (this.useMock && this.mockData) {
      logger.verbose('[MOCK] Returning mock sequences');
      return [...this.mockData.sequences];
    }

    if (!this.apiKey) {
      logger.verbose('[API] Sequences require authentication — no API key configured, skipping');
      return [];
    }

    try {
      logger.verbose('[API] Fetching sequences from LeadCMS...');

      if (!this.baseURL) {
        throw new Error('LeadCMS URL is not configured.');
      }

      const url = new URL(`${this.baseURL}/api/sequences`);
      url.searchParams.set('filter[include]', 'steps');

      const response: AxiosResponse<SequenceDetailsDto[]> = await axios.get(
        url.toString(),
        { headers: this.getApiHeaders() }
      );

      return Array.isArray(response.data) ? response.data : [];
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw formatAuthenticationError(error);
      }

      console.error('[API] Failed to fetch sequences:', error.message);
      throw error;
    }
  }

  /**
   * Create a new sequence in LeadCMS or mock
   */
  async createSequence(sequence: SequenceCreateDto): Promise<SequenceDetailsDto> {
    this._initialize();

    if (this.useMock && this.mockData) {
      logger.verbose(`[MOCK] Creating sequence: ${sequence.name}`);

      const newSequence: SequenceDetailsDto = {
        ...sequence,
        id: Math.floor(Math.random() * 1000) + 100,
        status: 'Draft',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        steps: (sequence.steps ?? []).map((s, i) => ({
          ...s,
          id: s.id ?? i + 1,
          sequenceId: 0,
          type: s.type ?? 'Email' as const,
        })),
      };

      this.mockData.sequences.push(newSequence);
      return newSequence;
    }

    if (!this.apiKey) {
      throw new Error('Sequence operations require authentication. Please configure LEADCMS_API_KEY.');
    }

    try {
      logger.verbose(`[API] Creating sequence: ${sequence.name}`);
      const response: AxiosResponse<SequenceDetailsDto> = await axios.post(
        `${this.baseURL}/api/sequences`,
        sequence,
        { headers: this.getApiHeaders() }
      );

      return response.data;
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw formatAuthenticationError(error);
      }

      if (error.response?.status === 422 && error.response?.data?.errors) {
        const validationMessage = formatApiValidationErrors(error.response);
        const enhancedError = new Error(`Validation failed${validationMessage}`);
        (enhancedError as any).status = 422;
        (enhancedError as any).validationErrors = error.response.data.errors;
        throw enhancedError;
      }

      console.error('[API] Failed to create sequence:', error.message);
      throw error;
    }
  }

  /**
   * Update existing sequence in LeadCMS or mock (full replace via PUT)
   */
  async updateSequence(id: number, sequence: SequenceCreateDto): Promise<SequenceDetailsDto> {
    this._initialize();

    if (this.useMock && this.mockData) {
      logger.verbose(`[MOCK] Updating sequence ID ${id}: ${sequence.name}`);

      const existingIndex = this.mockData.sequences.findIndex(s => s.id === id);
      if (existingIndex === -1) {
        throw new Error(`Sequence with id ${id} not found`);
      }

      const updatedSequence: SequenceDetailsDto = {
        ...this.mockData.sequences[existingIndex],
        ...sequence,
        updatedAt: new Date().toISOString(),
        steps: (sequence.steps ?? this.mockData.sequences[existingIndex].steps ?? []).map((s, i) => ({
          ...s,
          id: s.id ?? ('id' in s ? (s as any).id : i + 1),
          sequenceId: id,
          type: s.type ?? 'Email' as const,
        })),
      };

      this.mockData.sequences[existingIndex] = updatedSequence;
      return updatedSequence;
    }

    if (!this.apiKey) {
      throw new Error('Sequence operations require authentication. Please configure LEADCMS_API_KEY.');
    }

    try {
      logger.verbose(`[API] Updating sequence ID ${id}`);
      const response: AxiosResponse<SequenceDetailsDto> = await axios.put(
        `${this.baseURL}/api/sequences/${id}`,
        sequence,
        { headers: this.getApiHeaders() }
      );

      return response.data;
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw formatAuthenticationError(error);
      }

      if (error.response?.status === 422 && error.response?.data?.errors) {
        const validationMessage = formatApiValidationErrors(error.response);
        const enhancedError = new Error(`Validation failed${validationMessage}`);
        (enhancedError as any).status = 422;
        (enhancedError as any).validationErrors = error.response.data.errors;
        throw enhancedError;
      }

      console.error('[API] Failed to update sequence:', error.message);
      throw error;
    }
  }

  /**
   * Delete sequence from LeadCMS
   */
  async deleteSequence(id: number): Promise<void> {
    this._initialize();

    if (this.useMock && this.mockData) {
      logger.verbose(`[MOCK] Deleting sequence with ID: ${id}`);
      const index = this.mockData.sequences.findIndex(s => s.id === id);
      if (index !== -1) {
        this.mockData.sequences.splice(index, 1);
      }
      return;
    }

    if (!this.apiKey) {
      throw new Error('Sequence operations require authentication. Please configure LEADCMS_API_KEY.');
    }

    try {
      logger.verbose(`[API] Deleting sequence with ID: ${id}`);

      if (!this.baseURL) {
        throw new Error('LeadCMS URL is not configured.');
      }

      await axios.delete(`${this.baseURL}/api/sequences/${id}`, {
        headers: this.getApiHeaders(),
      });
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw formatAuthenticationError(error);
      }

      console.error('[API] Failed to delete sequence:', error.message);
      throw error;
    }
  }

  /**
   * Create content type in LeadCMS or mock
   */
  async createContentType(contentType: Partial<ContentType>): Promise<ContentType> {
    this._initialize();

    if (this.useMock && this.mockData && contentType.uid && contentType.format) {
      logger.verbose(`[MOCK] Creating content type: ${contentType.uid}`);

      this.mockData.contentTypes[contentType.uid] = contentType.format;
      return {
        uid: contentType.uid,
        format: contentType.format,
        name: contentType.name || contentType.uid.charAt(0).toUpperCase() + contentType.uid.slice(1)
      };
    }

    try {
      logger.verbose(`[API] Creating content type: ${contentType.uid}`);
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
   * Get all media from LeadCMS using sync API (without token for full fetch)
   */
  async getAllMedia(scopeUid?: string): Promise<MediaItem[]> {
    this._initialize();

    if (this.useMock && this.mockData) {
      logger.verbose('[MOCK] Returning mock media data');

      let media = [...this.mockData.remoteMedia];
      if (scopeUid) {
        media = media.filter(m => m.scopeUid === scopeUid);
      }
      return media;
    }

    try {
      logger.verbose('[API] Fetching media from LeadCMS using sync API...');

      if (!this.baseURL) {
        throw new Error('LeadCMS URL is not configured.');
      }

      const allMedia: MediaItem[] = [];
      let syncToken = '';
      let page = 0;

      // Paginate through all media using sync API
      while (true) {
        const url = new URL('/api/media/sync', this.baseURL);
        url.searchParams.set('filter[limit]', '100');
        url.searchParams.set('syncToken', syncToken);
        if (scopeUid) {
          url.searchParams.set('query', `scopeUid=${scopeUid}`);
        }

        const response = await axios.get(url.toString());

        if (response.status === 204) {
          break; // No more data
        }

        const data = response.data;
        if (data.items && Array.isArray(data.items)) {
          allMedia.push(...data.items);
        }

        const nextToken = response.headers['x-next-sync-token'] || syncToken;
        if (!nextToken || nextToken === syncToken) {
          break; // No more pages
        }

        syncToken = nextToken;
        page++;
      }

      logger.verbose(`[API] Fetched ${allMedia.length} media items`);
      return allMedia;
    } catch (error: any) {
      console.error('[API] Failed to fetch media:', error.message);
      throw error;
    }
  }

  /**
   * Upload media file to LeadCMS
   */
  async uploadMedia(formData: any): Promise<MediaItem> {
    this._initialize();

    if (this.useMock && this.mockData) {
      logger.verbose('[MOCK] Uploading media file');

      // Extract data from FormData for mock
      const scopeUid = formData.get('ScopeUid') as string;
      const fileName = (formData.get('File') as any)?.name || 'mock-file.jpg';
      const description = formData.get('Description') as string | null;

      const newMedia: MediaItem = {
        id: this.mockData.remoteMedia.length + 1,
        location: `/api/media/${scopeUid}/${fileName}`,
        scopeUid,
        name: fileName,
        description,
        size: 100000, // Mock size
        extension: fileName.substring(fileName.lastIndexOf('.')),
        mimeType: 'image/jpeg',
        createdAt: new Date().toISOString(),
        updatedAt: null
      };

      this.mockData.remoteMedia.push(newMedia);
      return newMedia;
    }

    try {
      logger.verbose('[API] Uploading media file...');

      if (!this.baseURL) {
        throw new Error('LeadCMS URL is not configured.');
      }

      const response: AxiosResponse<MediaItem> = await axios.post(
        `${this.baseURL}/api/media`,
        formData,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            // Don't set Content-Type, let axios set it with boundary for multipart
          }
        }
      );

      logger.verbose('[API] Media uploaded successfully');
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw formatAuthenticationError(error);
      }

      if (error.response?.status === 422) {
        const validationMessage = formatApiValidationErrors(error.response);
        const enhancedError = new Error(`Media validation failed${validationMessage}`);
        (enhancedError as any).status = 422;
        throw enhancedError;
      }

      console.error('[API] Failed to upload media:', error.message);
      throw error;
    }
  }

  /**
   * Update existing media file in LeadCMS
   */
  async updateMedia(formData: any): Promise<MediaItem> {
    this._initialize();

    if (this.useMock && this.mockData) {
      logger.verbose('[MOCK] Updating media file');

      const scopeUid = formData.get('ScopeUid') as string;
      const fileName = formData.get('FileName') as string;

      const existingIndex = this.mockData.remoteMedia.findIndex(
        m => m.scopeUid === scopeUid && m.name === fileName
      );

      if (existingIndex === -1) {
        throw new Error(`Media file ${scopeUid}/${fileName} not found`);
      }

      const updatedMedia = {
        ...this.mockData.remoteMedia[existingIndex],
        updatedAt: new Date().toISOString()
      };

      this.mockData.remoteMedia[existingIndex] = updatedMedia;
      return updatedMedia;
    }

    try {
      logger.verbose('[API] Updating media file...');

      if (!this.baseURL) {
        throw new Error('LeadCMS URL is not configured.');
      }

      const response: AxiosResponse<MediaItem> = await axios.patch(
        `${this.baseURL}/api/media`,
        formData,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
          }
        }
      );

      logger.verbose('[API] Media updated successfully');
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw formatAuthenticationError(error);
      }

      if (error.response?.status === 422) {
        const validationMessage = formatApiValidationErrors(error.response);
        const enhancedError = new Error(`Media validation failed${validationMessage}`);
        (enhancedError as any).status = 422;
        throw enhancedError;
      }

      console.error('[API] Failed to update media:', error.message);
      throw error;
    }
  }

  /**
   * Delete media file from LeadCMS
   */
  async deleteMedia(pathToFile: string): Promise<void> {
    this._initialize();

    if (this.useMock && this.mockData) {
      logger.verbose(`[MOCK] Deleting media file: ${pathToFile}`);

      // Parse path to extract scopeUid and name
      // Path format: /api/media/scopeUid/filename or scopeUid/filename
      const cleanPath = pathToFile.replace('/api/media/', '');
      const lastSlash = cleanPath.lastIndexOf('/');
      const scopeUid = cleanPath.substring(0, lastSlash);
      const name = cleanPath.substring(lastSlash + 1);

      const index = this.mockData.remoteMedia.findIndex(
        m => m.scopeUid === scopeUid && m.name === name
      );

      if (index !== -1) {
        this.mockData.remoteMedia.splice(index, 1);
      }
      return;
    }

    try {
      logger.verbose(`[API] Deleting media file: ${pathToFile}`);

      if (!this.baseURL) {
        throw new Error('LeadCMS URL is not configured.');
      }

      await axios.delete(
        `${this.baseURL}/api/media/${pathToFile}`,
        {
          headers: this.getApiHeaders()
        }
      );

      logger.verbose('[API] Media deleted successfully');
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw formatAuthenticationError(error);
      }

      console.error('[API] Failed to delete media:', error.message);
      throw error;
    }
  }

  /**
   * Fetch the authenticated user's identity from /api/users/me.
   * Returns user details if the API key is valid.
   * Throws on 401 (invalid/expired key) or if no API key is configured.
   */
  async getUserMe(): Promise<UserIdentity> {
    this._initialize();

    if (this.useMock) {
      logger.verbose('[MOCK] Returning mock user identity');
      return {
        displayName: 'Test User',
        email: 'test@example.com',
        userName: 'testuser',
      };
    }

    if (!this.apiKey) {
      throw new Error('No API key configured');
    }

    if (!this.baseURL) {
      throw new Error('LeadCMS URL is not configured.');
    }

    try {
      logger.verbose('[API] Fetching user identity from /api/users/me...');
      const response: AxiosResponse<UserIdentity> = await axios.get(
        `${this.baseURL}/api/users/me`,
        { headers: this.getApiHeaders() }
      );
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 401) {
        throw formatAuthenticationError(error);
      }
      throw error;
    }
  }

  /**
   * Check if an API key is configured.
   * Email templates and other authenticated-only features require an API key.
   */
  isApiKeyConfigured(): boolean {
    this._initialize();
    return !!this.apiKey;
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
      remoteMedia: JSON.parse(JSON.stringify(scenario.remoteMedia)),
      emailTemplates: JSON.parse(JSON.stringify(scenario.emailTemplates || [])),
      emailGroups: JSON.parse(JSON.stringify(scenario.emailGroups || [])),
      comments: JSON.parse(JSON.stringify(scenario.comments || [])),
      segments: JSON.parse(JSON.stringify(scenario.segments || [])),
      sequences: JSON.parse(JSON.stringify(scenario.sequences || [])),
      scenario: scenario.name
    };

    logger.verbose(`[MOCK] Switched to scenario: ${scenario.name}`);
    if (!this.mockData) {
      throw new Error('Mock data not initialized');
    }
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
      remoteMedia: [...this.mockData.remoteMedia],
      emailTemplates: [...this.mockData.emailTemplates],
      emailGroups: [...this.mockData.emailGroups],
      comments: [...this.mockData.comments],
      segments: [...this.mockData.segments],
      sequences: [...this.mockData.sequences],
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
export type { ContentItem, ContentType, MockScenario, MockData, CommentCreateItem, CommentUpdateItem, EmailTemplateItem, EmailGroupItem };
