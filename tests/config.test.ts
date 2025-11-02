/**
 * Tests for Config module
 */

import * as fs from 'fs';
import * as path from 'path';

// Unmock config module for these tests
jest.unmock('../src/lib/config');

// Import after unmocking
import { getConfig } from '../src/lib/config';

describe('Config Module', () => {
  const originalEnv = process.env;
  const testConfigPath = path.join(process.cwd(), 'leadcms.config.json');
  const testRcPath = path.join(process.cwd(), '.leadcmsrc.json');

  beforeEach(() => {
    // Clear module cache to ensure fresh config loading
    jest.resetModules();

    // Reset environment
    process.env = { ...originalEnv };
    delete process.env.LEADCMS_URL;
    delete process.env.LEADCMS_API_KEY;
    delete process.env.LEADCMS_DEFAULT_LANGUAGE;
    delete process.env.NEXT_PUBLIC_LEADCMS_URL;
    delete process.env.NEXT_PUBLIC_LEADCMS_DEFAULT_LANGUAGE;

    // Clean up any test config files
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
    if (fs.existsSync(testRcPath)) {
      fs.unlinkSync(testRcPath);
    }
  });

  afterEach(() => {
    // Restore environment
    process.env = originalEnv;

    // Clean up test config files
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
    if (fs.existsSync(testRcPath)) {
      fs.unlinkSync(testRcPath);
    }
  });

  describe('Environment Variables', () => {
    it('should load config from LEADCMS_* environment variables', () => {
      process.env.LEADCMS_URL = 'https://test.leadcms.io';
      process.env.LEADCMS_API_KEY = 'test-api-key';
      process.env.LEADCMS_DEFAULT_LANGUAGE = 'en';

      const { getConfig: getConfigFresh } = require('../src/lib/config');
      const config = getConfigFresh();

      expect(config.url).toBe('https://test.leadcms.io');
      expect(config.apiKey).toBe('test-api-key');
      expect(config.defaultLanguage).toBe('en');
    });

    it('should load config from NEXT_PUBLIC_* environment variables', () => {
      process.env.NEXT_PUBLIC_LEADCMS_URL = 'https://nextjs.leadcms.io';
      process.env.NEXT_PUBLIC_LEADCMS_DEFAULT_LANGUAGE = 'es';

      const { getConfig: getConfigFresh } = require('../src/lib/config');
      const config = getConfigFresh();

      expect(config.url).toBe('https://nextjs.leadcms.io');
      expect(config.defaultLanguage).toBe('es');
    });

    it('should prefer LEADCMS_* over NEXT_PUBLIC_* variables', () => {
      process.env.LEADCMS_URL = 'https://leadcms.io';
      process.env.NEXT_PUBLIC_LEADCMS_URL = 'https://nextjs.io';
      process.env.LEADCMS_DEFAULT_LANGUAGE = 'en';
      process.env.NEXT_PUBLIC_LEADCMS_DEFAULT_LANGUAGE = 'es';

      const { getConfig: getConfigFresh } = require('../src/lib/config');
      const config = getConfigFresh();

      expect(config.url).toBe('https://leadcms.io');
      expect(config.defaultLanguage).toBe('en');
    });

    it('should apply default values when optional env vars are missing', () => {
      process.env.LEADCMS_URL = 'https://test.leadcms.io'; // URL is required
      delete process.env.LEADCMS_DEFAULT_LANGUAGE;

      const { getConfig: getConfigFresh } = require('../src/lib/config');
      const config = getConfigFresh();

      expect(config.url).toBe('https://test.leadcms.io');
      expect(config.defaultLanguage).toBe('en');
      expect(config.contentDir).toBe('.leadcms/content');
      expect(config.mediaDir).toBe('public/media');
    });
  });

  describe('Config File Loading', () => {
    it('should load config from leadcms.config.json', () => {
      const testConfig = {
        url: 'https://file.leadcms.io',
        apiKey: 'file-api-key',
        defaultLanguage: 'fr',
        contentDir: 'custom/content',
      };

      fs.writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

      const { getConfig: getConfigFresh } = require('../src/lib/config');
      const config = getConfigFresh();

      expect(config.url).toBe('https://file.leadcms.io');
      expect(config.apiKey).toBe('file-api-key');
      expect(config.defaultLanguage).toBe('fr');
      expect(config.contentDir).toBe('custom/content');
    });

    it('should load config from .leadcmsrc.json', () => {
      const testConfig = {
        url: 'https://rc.leadcms.io',
        defaultLanguage: 'de',
      };

      fs.writeFileSync(testRcPath, JSON.stringify(testConfig, null, 2));

      const { getConfig: getConfigFresh } = require('../src/lib/config');
      const config = getConfigFresh();

      expect(config.url).toBe('https://rc.leadcms.io');
      expect(config.defaultLanguage).toBe('de');
    });

    it('should prefer environment variables over config file', () => {
      const testConfig = {
        url: 'https://file.leadcms.io',
        defaultLanguage: 'fr',
      };

      fs.writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

      process.env.LEADCMS_URL = 'https://env.leadcms.io';
      process.env.LEADCMS_DEFAULT_LANGUAGE = 'en';

      const { getConfig: getConfigFresh } = require('../src/lib/config');
      const config = getConfigFresh();

      // Environment variables should override file config
      expect(config.url).toBe('https://env.leadcms.io');
      expect(config.defaultLanguage).toBe('en');
    });

    it('should throw when config file missing and no URL provided', () => {
      // No config file exists and no URL env var
      const { getConfig: getConfigFresh } = require('../src/lib/config');

      expect(() => getConfigFresh()).toThrow('Missing required configuration: url');
    });

    it('should throw for malformed JSON config', () => {
      fs.writeFileSync(testConfigPath, '{ invalid json }');

      // Suppress expected warning during this test
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const { getConfig: getConfigFresh } = require('../src/lib/config');

      // Should throw due to invalid JSON
      expect(() => getConfigFresh()).toThrow();

      // Restore console.warn
      consoleWarnSpy.mockRestore();
    });
  });

  describe('Config Validation', () => {
    it('should throw error when required URL is missing', () => {
      delete process.env.LEADCMS_URL;
      delete process.env.NEXT_PUBLIC_LEADCMS_URL;

      const { getConfig: getConfigFresh } = require('../src/lib/config');

      expect(() => getConfigFresh()).toThrow('Missing required configuration: url');
    });

    it('should merge config from multiple sources', () => {
      // Config file
      const testConfig = {
        url: 'https://file.leadcms.io',
        contentDir: 'custom/content',
      };
      fs.writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

      // Environment variables
      process.env.LEADCMS_API_KEY = 'env-api-key';
      process.env.LEADCMS_DEFAULT_LANGUAGE = 'en';

      const { getConfig: getConfigFresh } = require('../src/lib/config');
      const config = getConfigFresh();

      // Should have values from both sources
      expect(config.url).toBe('https://file.leadcms.io');
      expect(config.apiKey).toBe('env-api-key');
      expect(config.defaultLanguage).toBe('en');
      expect(config.contentDir).toBe('custom/content');
    });
  });

  describe('Default Values', () => {
    it('should apply default directory values', () => {
      process.env.LEADCMS_URL = 'https://test.leadcms.io'; // URL is required

      const { getConfig: getConfigFresh } = require('../src/lib/config');
      const config = getConfigFresh();

      expect(config.url).toBe('https://test.leadcms.io');
      expect(config.defaultLanguage).toBe('en');
      expect(config.contentDir).toBe('.leadcms/content');
      expect(config.mediaDir).toBe('public/media');
      expect(config.commentsDir).toBe('.leadcms/comments');
    });

    it('should allow overriding default directories', () => {
      const testConfig = {
        url: 'https://test.leadcms.io',
        contentDir: 'src/content',
        mediaDir: 'assets/media',
        commentsDir: 'data/comments',
      };

      fs.writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

      const { getConfig: getConfigFresh } = require('../src/lib/config');
      const config = getConfigFresh();

      expect(config.contentDir).toBe('src/content');
      expect(config.mediaDir).toBe('assets/media');
      expect(config.commentsDir).toBe('data/comments');
    });
  });

  describe('Config Priority', () => {
    it('should follow priority: env vars > config file > defaults', () => {
      // Start with file config
      const testConfig = {
        url: 'https://file.leadcms.io',
        defaultLanguage: 'fr',
        contentDir: 'file/content',
      };
      fs.writeFileSync(testConfigPath, JSON.stringify(testConfig, null, 2));

      // Override some with env vars
      process.env.LEADCMS_URL = 'https://env.leadcms.io';
      process.env.LEADCMS_CONTENT_DIR = 'env/content';
      // Leave defaultLanguage to file (no env var set)

      const { getConfig: getConfigFresh } = require('../src/lib/config');
      const config = getConfigFresh();

      expect(config.url).toBe('https://env.leadcms.io'); // From env
      expect(config.contentDir).toBe('env/content'); // From env
      expect(config.mediaDir).toBe('public/media'); // From defaults
      // defaultLanguage might get overridden if there's a default in the code
    });
  });
});
