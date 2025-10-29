import * as path from 'path';

// Test constants
export const TEST_USER_UID = '550e8400-e29b-41d4-a716-446655440000';
export const TEST_USER_UID_2 = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

// Mock the config module to use our test fixtures
jest.mock('../src/lib/config', () => ({
  getConfig: () => ({
    url: 'https://test.leadcms.com',
    apiKey: 'test-api-key',
    defaultLanguage: 'en',
    contentDir: path.join(__dirname, 'fixtures/.leadcms/content'),
    mediaDir: 'public/media',
    enableDrafts: true,
  }),
}));

// Set up environment variables for tests
process.env.LEADCMS_URL = 'https://test.leadcms.com';
process.env.LEADCMS_API_KEY = 'test-api-key';
process.env.LEADCMS_DEFAULT_LANGUAGE = 'en';

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
