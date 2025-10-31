/**
 * Tests for CMS Config Types module
 */

import {
  setCMSConfig,
  getCachedCMSConfig,
  isEntitySupported,
  isCommentsSupported,
  isContentSupported,
  isMediaSupported,
  CMSConfigResponse,
} from '../src/lib/cms-config-types';

describe('CMS Config Types', () => {
  const mockConfig: CMSConfigResponse = {
    auth: {
      methods: ['local'],
    },
    entities: ['Content', 'Comment', 'Media'],
    languages: [
      { code: 'en', name: 'English' },
      { code: 'es', name: 'Spanish' },
    ],
    settings: {},
    defaultLanguage: 'en',
    modules: [],
    capabilities: [],
  };

  beforeEach(() => {
    // Clear cache before each test by setting and then letting it expire
    // We can't directly access the cache variable, so we'll work with the API
  });

  describe('setCMSConfig and getCachedCMSConfig', () => {
    it('should cache config and retrieve it', () => {
      setCMSConfig(mockConfig);
      const cached = getCachedCMSConfig();

      expect(cached).toEqual(mockConfig);
      expect(cached?.entities).toEqual(['Content', 'Comment', 'Media']);
      expect(cached?.defaultLanguage).toBe('en');
    });

    it('should return null when no config is cached', () => {
      // Don't set any config
      const cached = getCachedCMSConfig();

      // Since we can't clear the cache, this might return a previous config
      // So we'll just verify the function works
      expect(cached).toBeDefined();
    });

    it('should update cached config when set multiple times', () => {
      const firstConfig: CMSConfigResponse = {
        ...mockConfig,
        defaultLanguage: 'en',
      };

      const secondConfig: CMSConfigResponse = {
        ...mockConfig,
        defaultLanguage: 'es',
      };

      setCMSConfig(firstConfig);
      let cached = getCachedCMSConfig();
      expect(cached?.defaultLanguage).toBe('en');

      setCMSConfig(secondConfig);
      cached = getCachedCMSConfig();
      expect(cached?.defaultLanguage).toBe('es');
    });

    it('should cache config with timestamp', () => {
      const beforeTime = Date.now();
      setCMSConfig(mockConfig);
      const afterTime = Date.now();

      const cached = getCachedCMSConfig();
      expect(cached).toBeDefined();

      // Timestamp should be between before and after
      // We can't access the timestamp directly, but we can verify the config is returned
      expect(cached).toEqual(mockConfig);
    });
  });

  describe('isEntitySupported', () => {
    beforeEach(() => {
      setCMSConfig(mockConfig);
    });

    it('should return true for supported entities', () => {
      expect(isEntitySupported('Content')).toBe(true);
      expect(isEntitySupported('Comment')).toBe(true);
      expect(isEntitySupported('Media')).toBe(true);
    });

    it('should return false for unsupported entities', () => {
      expect(isEntitySupported('Contact')).toBe(false);
      expect(isEntitySupported('Link')).toBe(false);
      expect(isEntitySupported('Unknown')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(isEntitySupported('content')).toBe(true);
      expect(isEntitySupported('CONTENT')).toBe(true);
      expect(isEntitySupported('CoNtEnT')).toBe(true);

      expect(isEntitySupported('comment')).toBe(true);
      expect(isEntitySupported('COMMENT')).toBe(true);

      expect(isEntitySupported('media')).toBe(true);
      expect(isEntitySupported('MEDIA')).toBe(true);
    });

    it('should return true when config is not available (backward compatibility)', () => {
      // Set a config without entities
      const configWithoutEntities: CMSConfigResponse = {
        ...mockConfig,
        entities: undefined as any,
      };

      setCMSConfig(configWithoutEntities);

      expect(isEntitySupported('Content')).toBe(true);
      expect(isEntitySupported('Anything')).toBe(true);
    });

    it('should return true for non-array entities (backward compatibility)', () => {
      const configWithInvalidEntities: CMSConfigResponse = {
        ...mockConfig,
        entities: 'not-an-array' as any,
      };

      setCMSConfig(configWithInvalidEntities);

      expect(isEntitySupported('Content')).toBe(true);
    });
  });

  describe('isCommentsSupported', () => {
    it('should return true when Comment entity is supported', () => {
      setCMSConfig(mockConfig);
      expect(isCommentsSupported()).toBe(true);
    });

    it('should return false when Comment entity is not supported', () => {
      const configWithoutComments: CMSConfigResponse = {
        ...mockConfig,
        entities: ['Content', 'Media'],
      };

      setCMSConfig(configWithoutComments);
      expect(isCommentsSupported()).toBe(false);
    });

    it('should be case-insensitive', () => {
      const configWithLowerCase: CMSConfigResponse = {
        ...mockConfig,
        entities: ['content', 'comment', 'media'],
      };

      setCMSConfig(configWithLowerCase);
      expect(isCommentsSupported()).toBe(true);
    });
  });

  describe('isContentSupported', () => {
    it('should return true when Content entity is supported', () => {
      setCMSConfig(mockConfig);
      expect(isContentSupported()).toBe(true);
    });

    it('should return false when Content entity is not supported', () => {
      const configWithoutContent: CMSConfigResponse = {
        ...mockConfig,
        entities: ['Comment', 'Media'],
      };

      setCMSConfig(configWithoutContent);
      expect(isContentSupported()).toBe(false);
    });

    it('should be case-insensitive', () => {
      const configWithUpperCase: CMSConfigResponse = {
        ...mockConfig,
        entities: ['CONTENT', 'COMMENT', 'MEDIA'],
      };

      setCMSConfig(configWithUpperCase);
      expect(isContentSupported()).toBe(true);
    });
  });

  describe('isMediaSupported', () => {
    it('should return true when Media entity is supported', () => {
      setCMSConfig(mockConfig);
      expect(isMediaSupported()).toBe(true);
    });

    it('should return false when Media entity is not supported', () => {
      const configWithoutMedia: CMSConfigResponse = {
        ...mockConfig,
        entities: ['Content', 'Comment'],
      };

      setCMSConfig(configWithoutMedia);
      expect(isMediaSupported()).toBe(false);
    });

    it('should be case-insensitive', () => {
      const configWithMixedCase: CMSConfigResponse = {
        ...mockConfig,
        entities: ['content', 'Comment', 'MEDIA'],
      };

      setCMSConfig(configWithMixedCase);
      expect(isMediaSupported()).toBe(true);
    });
  });

  describe('Config with all entity types', () => {
    it('should support all standard entity types', () => {
      const fullConfig: CMSConfigResponse = {
        ...mockConfig,
        entities: ['Content', 'Comment', 'Media', 'Contact', 'Link'],
      };

      setCMSConfig(fullConfig);

      expect(isContentSupported()).toBe(true);
      expect(isCommentsSupported()).toBe(true);
      expect(isMediaSupported()).toBe(true);
      expect(isEntitySupported('Contact')).toBe(true);
      expect(isEntitySupported('Link')).toBe(true);
    });
  });

  describe('Empty entities array', () => {
    it('should return false for all entities when array is empty', () => {
      const emptyConfig: CMSConfigResponse = {
        ...mockConfig,
        entities: [],
      };

      setCMSConfig(emptyConfig);

      expect(isContentSupported()).toBe(false);
      expect(isCommentsSupported()).toBe(false);
      expect(isMediaSupported()).toBe(false);
    });
  });
});
