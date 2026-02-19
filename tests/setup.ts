import * as path from 'path';

// Test constants
export const TEST_USER_UID = '550e8400-e29b-41d4-a716-446655440000';
export const TEST_USER_UID_2 = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

// Path constants for fixtures
export const FIXTURES_DIR = path.join(__dirname, 'fixtures');
export const FIXTURES_CONTENT_DIR = path.join(FIXTURES_DIR, '.leadcms/content');
export const FIXTURES_MEDIA_DIR = path.join(FIXTURES_DIR, 'public/media');

// Global config state for testing
let mockGlobalConfig: any = {};

// Helper to get the current test config
const getTestConfig = () => ({
  url: 'https://test.leadcms.com',
  apiKey: 'test-api-key',
  defaultLanguage: 'en',
  contentDir: FIXTURES_CONTENT_DIR,
  mediaDir: FIXTURES_MEDIA_DIR,
  commentsDir: path.join(FIXTURES_DIR, '.leadcms/comments'),
  emailTemplatesDir: path.join(FIXTURES_DIR, '.leadcms/email-templates'),
  enableDrafts: true,
  preview: mockGlobalConfig.preview,
});

// Mock the config module to use our test fixtures
jest.mock('../src/lib/config', () => ({
  getConfig: () => getTestConfig(),
  loadConfig: () => getTestConfig(),
  configure: (config: any) => {
    mockGlobalConfig = config || {};
  },
  isPreviewMode: () => {
    // Check global configuration override first
    if (mockGlobalConfig?.preview !== undefined) {
      return mockGlobalConfig.preview;
    }

    // Check LEADCMS_PREVIEW environment variable for explicit override
    if (process.env.LEADCMS_PREVIEW === 'false') {
      return false;
    }
    if (process.env.LEADCMS_PREVIEW === 'true') {
      return true;
    }

    // Default to development mode behavior
    return process.env.NODE_ENV === 'development';
  },
}));

// Set up environment variables for tests
process.env.LEADCMS_URL = 'https://test.leadcms.com';
process.env.LEADCMS_API_KEY = 'test-api-key';
process.env.LEADCMS_DEFAULT_LANGUAGE = 'en';
// Explicitly set NODE_ENV to test to ensure consistent behavior
process.env.NODE_ENV = 'test';

// Test constants for consistent time testing
export const MOCK_CURRENT_TIME = '2024-10-29T12:00:00Z';
export const MOCK_CURRENT_TIME_MS = new Date(MOCK_CURRENT_TIME).getTime();

// Mock Date.now for consistent testing
const originalDateNow = Date.now;

export const mockDate = (date: Date | string) => {
  const mockTime = new Date(date).getTime();
  Date.now = jest.fn(() => mockTime);
};

export const restoreDate = () => {
  Date.now = originalDateNow;
};

beforeEach(() => {
  // Set a consistent "current" time for all tests: October 29, 2024, 12:00 PM UTC
  mockDate(MOCK_CURRENT_TIME);
});

afterEach(() => {
  restoreDate();
});
