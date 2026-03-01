/**
 * Tests for CMS settings types and utilities
 */

import {
  TRACKED_SETTING_KEYS,
  AI_SITEPROFILE_PREFIX,
  aiSiteProfileKeyToFileName,
  fileNameToAiSiteProfileKey,
  isAiSiteProfileKey,
  isContentSettingKey,
  isMediaSettingKey,
} from '../src/lib/settings-types';

import {
  fetchRemoteSettings,
  filterTrackedSettings,
  saveSettingsLocally,
  readLocalSettings,
  buildSettingsStatus,
  buildSettingsPushOperations,
} from '../src/scripts/settings-manager';

import {
  formatSettingValue,
  formatSettingDiff,
  renderSettingDiffPreview,
  selectOperationsForPush,
} from '../src/scripts/push-settings';

import axios from 'axios';
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// ── Settings types tests ────────────────────────────────────────────────────

describe('settings-types', () => {
  describe('TRACKED_SETTING_KEYS', () => {
    it('contains all expected AI.SiteProfile keys', () => {
      expect(TRACKED_SETTING_KEYS).toContain('AI.SiteProfile.Audience');
      expect(TRACKED_SETTING_KEYS).toContain('AI.SiteProfile.AvoidTerms');
      expect(TRACKED_SETTING_KEYS).toContain('AI.SiteProfile.BlogCover.Instructions');
      expect(TRACKED_SETTING_KEYS).toContain('AI.SiteProfile.BrandVoice');
      expect(TRACKED_SETTING_KEYS).toContain('AI.SiteProfile.EmailTemplate.Instructions');
      expect(TRACKED_SETTING_KEYS).toContain('AI.SiteProfile.PreferredTerms');
      expect(TRACKED_SETTING_KEYS).toContain('AI.SiteProfile.StyleExamples');
      expect(TRACKED_SETTING_KEYS).toContain('AI.SiteProfile.Topic');
    });

    it('contains all expected Content keys', () => {
      expect(TRACKED_SETTING_KEYS).toContain('Content.MaxDescriptionLength');
      expect(TRACKED_SETTING_KEYS).toContain('Content.MaxTitleLength');
      expect(TRACKED_SETTING_KEYS).toContain('Content.MinDescriptionLength');
      expect(TRACKED_SETTING_KEYS).toContain('Content.MinTitleLength');
    });

    it('contains all expected Media keys', () => {
      expect(TRACKED_SETTING_KEYS).toContain('Media.Cover.Dimensions');
      expect(TRACKED_SETTING_KEYS).toContain('Media.EnableCoverResize');
      expect(TRACKED_SETTING_KEYS).toContain('Media.EnableOptimisation');
      expect(TRACKED_SETTING_KEYS).toContain('Media.Max.Dimensions');
      expect(TRACKED_SETTING_KEYS).toContain('Media.Max.FileSize');
      expect(TRACKED_SETTING_KEYS).toContain('Media.PreferredFormat');
      expect(TRACKED_SETTING_KEYS).toContain('Media.Quality');
    });

    it('has exactly 19 tracked keys', () => {
      expect(TRACKED_SETTING_KEYS).toHaveLength(19);
    });
  });

  describe('aiSiteProfileKeyToFileName', () => {
    it('converts simple key to lowercase', () => {
      expect(aiSiteProfileKeyToFileName('AI.SiteProfile.Audience')).toBe('audience');
    });

    it('converts camelCase to kebab-case', () => {
      expect(aiSiteProfileKeyToFileName('AI.SiteProfile.BrandVoice')).toBe('brand-voice');
    });

    it('converts dotted subkeys to dashes', () => {
      expect(aiSiteProfileKeyToFileName('AI.SiteProfile.BlogCover.Instructions')).toBe('blog-cover-instructions');
    });

    it('converts compound dotted keys correctly', () => {
      expect(aiSiteProfileKeyToFileName('AI.SiteProfile.EmailTemplate.Instructions')).toBe('email-template-instructions');
    });

    it('converts AvoidTerms correctly', () => {
      expect(aiSiteProfileKeyToFileName('AI.SiteProfile.AvoidTerms')).toBe('avoid-terms');
    });

    it('converts PreferredTerms correctly', () => {
      expect(aiSiteProfileKeyToFileName('AI.SiteProfile.PreferredTerms')).toBe('preferred-terms');
    });

    it('converts StyleExamples correctly', () => {
      expect(aiSiteProfileKeyToFileName('AI.SiteProfile.StyleExamples')).toBe('style-examples');
    });

    it('converts Topic correctly', () => {
      expect(aiSiteProfileKeyToFileName('AI.SiteProfile.Topic')).toBe('topic');
    });
  });

  describe('fileNameToAiSiteProfileKey', () => {
    it('maps audience back to key', () => {
      expect(fileNameToAiSiteProfileKey('audience')).toBe('AI.SiteProfile.Audience');
    });

    it('maps brand-voice back to key', () => {
      expect(fileNameToAiSiteProfileKey('brand-voice')).toBe('AI.SiteProfile.BrandVoice');
    });

    it('maps blog-cover-instructions back to key', () => {
      expect(fileNameToAiSiteProfileKey('blog-cover-instructions')).toBe('AI.SiteProfile.BlogCover.Instructions');
    });

    it('maps email-template-instructions back to key', () => {
      expect(fileNameToAiSiteProfileKey('email-template-instructions')).toBe('AI.SiteProfile.EmailTemplate.Instructions');
    });

    it('returns undefined for unknown file name', () => {
      expect(fileNameToAiSiteProfileKey('unknown-file')).toBeUndefined();
    });

    it('round-trips all AI.SiteProfile keys', () => {
      for (const key of TRACKED_SETTING_KEYS) {
        if (key.startsWith(AI_SITEPROFILE_PREFIX)) {
          const fileName = aiSiteProfileKeyToFileName(key);
          const roundTripped = fileNameToAiSiteProfileKey(fileName);
          expect(roundTripped).toBe(key);
        }
      }
    });
  });

  describe('isAiSiteProfileKey', () => {
    it('returns true for tracked AI.SiteProfile keys', () => {
      expect(isAiSiteProfileKey('AI.SiteProfile.Audience')).toBe(true);
      expect(isAiSiteProfileKey('AI.SiteProfile.Topic')).toBe(true);
    });

    it('returns false for untracked AI.SiteProfile keys', () => {
      expect(isAiSiteProfileKey('AI.SiteProfile.Unknown')).toBe(false);
    });

    it('returns false for non-AI keys', () => {
      expect(isAiSiteProfileKey('Content.MinTitleLength')).toBe(false);
    });
  });

  describe('isContentSettingKey', () => {
    it('returns true for tracked Content keys', () => {
      expect(isContentSettingKey('Content.MinTitleLength')).toBe(true);
      expect(isContentSettingKey('Content.MaxDescriptionLength')).toBe(true);
    });

    it('returns false for untracked Content keys', () => {
      expect(isContentSettingKey('Content.EnableRealtimeSyntaxValidation')).toBe(false);
    });

    it('returns false for non-Content keys', () => {
      expect(isContentSettingKey('Media.Quality')).toBe(false);
    });
  });

  describe('isMediaSettingKey', () => {
    it('returns true for tracked Media keys', () => {
      expect(isMediaSettingKey('Media.Quality')).toBe(true);
      expect(isMediaSettingKey('Media.Max.FileSize')).toBe(true);
    });

    it('returns false for untracked Media keys', () => {
      expect(isMediaSettingKey('Media.SomeUnknown')).toBe(false);
    });

    it('returns false for non-Media keys', () => {
      expect(isMediaSettingKey('Content.MinTitleLength')).toBe(false);
    });
  });
});

// ── Settings manager tests ──────────────────────────────────────────────────

describe('settings-manager', () => {
  describe('fetchRemoteSettings', () => {
    afterEach(() => {
      jest.resetAllMocks();
    });

    it('returns settings array from API response', async () => {
      const mockSettings = [
        { id: 1, key: 'Content.MinTitleLength', value: '9', createdAt: '2024-01-01T00:00:00Z' },
        { id: 2, key: 'Media.Quality', value: '99', createdAt: '2024-01-01T00:00:00Z' },
      ];
      mockedAxios.get.mockResolvedValue({ data: mockSettings });

      const result = await fetchRemoteSettings('https://test.leadcms.com', 'test-key');
      expect(result).toHaveLength(2);
      expect(result[0].key).toBe('Content.MinTitleLength');
      expect(result[1].key).toBe('Media.Quality');
    });

    it('sends Accept: text/json header', async () => {
      mockedAxios.get.mockResolvedValue({ data: [] });

      await fetchRemoteSettings('https://test.leadcms.com', 'test-key');
      expect(mockedAxios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Accept: 'text/json',
          }),
        }),
      );
    });

    it('returns empty array when API returns null', async () => {
      mockedAxios.get.mockResolvedValue({ data: null });

      const result = await fetchRemoteSettings('https://test.leadcms.com', 'test-key');
      expect(result).toHaveLength(0);
    });

    it('throws when URL is not configured', async () => {
      await expect(fetchRemoteSettings('', 'test-key')).rejects.toThrow('LeadCMS URL is not configured');
    });

    it('throws when API key is missing', async () => {
      await expect(fetchRemoteSettings('https://test.leadcms.com', '')).rejects.toThrow('LeadCMS API key is required');
    });
  });

  describe('filterTrackedSettings', () => {
    it('filters to only tracked keys', () => {
      const settings = [
        { id: 1, key: 'LivePreviewUrlTemplate', value: '', createdAt: '2024-01-01T00:00:00Z' },
        { id: 2, key: 'Content.MinTitleLength', value: '9', createdAt: '2024-01-01T00:00:00Z' },
        { id: 3, key: 'Media.Quality', value: '99', createdAt: '2024-01-01T00:00:00Z' },
        { id: 4, key: 'Identity.RequireDigit', value: 'true', createdAt: '2024-01-01T00:00:00Z' },
        { id: 5, key: 'AI.SiteProfile.Topic', value: 'Technology', createdAt: '2024-01-01T00:00:00Z' },
      ];

      const filtered = filterTrackedSettings(settings);
      expect(filtered).toHaveLength(3);
      expect(filtered.map(s => s.key)).toEqual([
        'Content.MinTitleLength',
        'Media.Quality',
        'AI.SiteProfile.Topic',
      ]);
    });

    it('excludes settings with null or empty values', () => {
      const settings = [
        { id: 1, key: 'Content.MinTitleLength', value: null, createdAt: '2024-01-01T00:00:00Z' },
        { id: 2, key: 'Content.MaxTitleLength', value: '', createdAt: '2024-01-01T00:00:00Z' },
        { id: 3, key: 'Media.Quality', value: '99', createdAt: '2024-01-01T00:00:00Z' },
      ];

      const filtered = filterTrackedSettings(settings);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].key).toBe('Media.Quality');
    });

    it('returns empty array when no tracked settings exist', () => {
      const settings = [
        { id: 1, key: 'Identity.RequireDigit', value: 'true', createdAt: '2024-01-01T00:00:00Z' },
      ];

      const filtered = filterTrackedSettings(settings);
      expect(filtered).toHaveLength(0);
    });
  });

  describe('saveSettingsLocally + readLocalSettings', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'leadcms-settings-test-'));
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('saves and reads AI.SiteProfile settings as .md files', async () => {
      const settings = [
        { id: 1, key: 'AI.SiteProfile.Topic', value: 'Technology Blog', language: null, createdAt: '2024-01-01T00:00:00Z' },
        { id: 2, key: 'AI.SiteProfile.Audience', value: 'Developers and engineers', language: null, createdAt: '2024-01-01T00:00:00Z' },
      ];

      await saveSettingsLocally(settings, tmpDir, 'en');
      const localSettings = await readLocalSettings(tmpDir, 'en');

      expect(localSettings).toHaveLength(2);
      const topic = localSettings.find(s => s.key === 'AI.SiteProfile.Topic');
      expect(topic).toBeDefined();
      expect(topic!.value).toBe('Technology Blog');
      expect(topic!.language).toBeNull();

      const audience = localSettings.find(s => s.key === 'AI.SiteProfile.Audience');
      expect(audience).toBeDefined();
      expect(audience!.value).toBe('Developers and engineers');
    });

    it('saves and reads Content settings as content.json', async () => {
      const settings = [
        { id: 1, key: 'Content.MinTitleLength', value: '9', language: null, createdAt: '2024-01-01T00:00:00Z' },
        { id: 2, key: 'Content.MaxTitleLength', value: '66', language: null, createdAt: '2024-01-01T00:00:00Z' },
      ];

      await saveSettingsLocally(settings, tmpDir, 'en');

      // Verify file content
      const contentJson = JSON.parse(await fs.readFile(path.join(tmpDir, 'content.json'), 'utf8'));
      expect(contentJson).toEqual({
        MinTitleLength: '9',
        MaxTitleLength: '66',
      });

      // Verify round-trip
      const localSettings = await readLocalSettings(tmpDir, 'en');
      expect(localSettings).toHaveLength(2);
      expect(localSettings.find(s => s.key === 'Content.MinTitleLength')!.value).toBe('9');
      expect(localSettings.find(s => s.key === 'Content.MaxTitleLength')!.value).toBe('66');
    });

    it('saves and reads Media settings as media.json', async () => {
      const settings = [
        { id: 1, key: 'Media.Quality', value: '99', language: null, createdAt: '2024-01-01T00:00:00Z' },
        { id: 2, key: 'Media.PreferredFormat', value: 'jpeg', language: null, createdAt: '2024-01-01T00:00:00Z' },
        { id: 3, key: 'Media.Max.FileSize', value: '1020', language: null, createdAt: '2024-01-01T00:00:00Z' },
      ];

      await saveSettingsLocally(settings, tmpDir, 'en');

      const mediaJson = JSON.parse(await fs.readFile(path.join(tmpDir, 'media.json'), 'utf8'));
      expect(mediaJson).toEqual({
        Quality: '99',
        PreferredFormat: 'jpeg',
        'Max.FileSize': '1020',
      });

      const localSettings = await readLocalSettings(tmpDir, 'en');
      expect(localSettings).toHaveLength(3);
      expect(localSettings.find(s => s.key === 'Media.Quality')!.value).toBe('99');
      expect(localSettings.find(s => s.key === 'Media.Max.FileSize')!.value).toBe('1020');
    });

    it('handles language-specific settings in locale subdirectories', async () => {
      const settings = [
        { id: 1, key: 'AI.SiteProfile.Topic', value: 'Topic - Generic', language: null, createdAt: '2024-01-01T00:00:00Z' },
        { id: 2, key: 'AI.SiteProfile.Topic', value: 'Topic - RU', language: 'ru-RU', createdAt: '2024-01-01T00:00:00Z' },
        { id: 3, key: 'Media.Max.FileSize', value: '1020', language: null, createdAt: '2024-01-01T00:00:00Z' },
        { id: 4, key: 'Media.Max.FileSize', value: '2048', language: 'ru-RU', createdAt: '2024-01-01T00:00:00Z' },
      ];

      await saveSettingsLocally(settings, tmpDir, 'en');

      // Default language files
      const defaultTopic = await fs.readFile(path.join(tmpDir, 'ai-siteprofile', 'topic.md'), 'utf8');
      expect(defaultTopic).toBe('Topic - Generic');

      // Russian language files
      const ruTopic = await fs.readFile(path.join(tmpDir, 'ru-RU', 'ai-siteprofile', 'topic.md'), 'utf8');
      expect(ruTopic).toBe('Topic - RU');

      const ruMedia = JSON.parse(await fs.readFile(path.join(tmpDir, 'ru-RU', 'media.json'), 'utf8'));
      expect(ruMedia['Max.FileSize']).toBe('2048');

      // Read all back
      const localSettings = await readLocalSettings(tmpDir, 'en');
      expect(localSettings).toHaveLength(4);

      const ruTopicLocal = localSettings.find(s => s.key === 'AI.SiteProfile.Topic' && s.language === 'ru-RU');
      expect(ruTopicLocal).toBeDefined();
      expect(ruTopicLocal!.value).toBe('Topic - RU');

      const defaultTopicLocal = localSettings.find(s => s.key === 'AI.SiteProfile.Topic' && s.language === null);
      expect(defaultTopicLocal).toBeDefined();
      expect(defaultTopicLocal!.value).toBe('Topic - Generic');
    });

    it('filters by targetName when saving', async () => {
      const settings = [
        { id: 1, key: 'AI.SiteProfile.Topic', value: 'Technology', language: null, createdAt: '2024-01-01T00:00:00Z' },
        { id: 2, key: 'AI.SiteProfile.Audience', value: 'Developers', language: null, createdAt: '2024-01-01T00:00:00Z' },
      ];

      await saveSettingsLocally(settings, tmpDir, 'en', 'AI.SiteProfile.Topic');

      const localSettings = await readLocalSettings(tmpDir, 'en');
      expect(localSettings).toHaveLength(1);
      expect(localSettings[0].key).toBe('AI.SiteProfile.Topic');
    });

    it('returns empty array when settings directory does not exist', async () => {
      const nonExistent = path.join(tmpDir, 'does-not-exist');
      const localSettings = await readLocalSettings(nonExistent, 'en');
      expect(localSettings).toHaveLength(0);
    });

    it('skips unknown .md files in ai-siteprofile folder', async () => {
      const aiDir = path.join(tmpDir, 'ai-siteprofile');
      await fs.mkdir(aiDir, { recursive: true });
      await fs.writeFile(path.join(aiDir, 'unknown-file.md'), 'content', 'utf8');

      const localSettings = await readLocalSettings(tmpDir, 'en');
      expect(localSettings).toHaveLength(0);
    });

    it('does not create md files for null/empty values', async () => {
      // filterTrackedSettings already handles this, but let's confirm empty arrays
      const settings: any[] = [];
      await saveSettingsLocally(settings, tmpDir, 'en');

      // The directory should still not exist
      try {
        await fs.access(path.join(tmpDir, 'ai-siteprofile'));
        fail('Should not have created ai-siteprofile directory');
      } catch {
        // Expected
      }
    });

    it('reconciles removed AI.SiteProfile files and deletes empty ai-siteprofile folder', async () => {
      const initial = [
        { id: 1, key: 'AI.SiteProfile.Topic', value: 'Initial topic', language: null, createdAt: '2024-01-01T00:00:00Z' },
      ];

      await saveSettingsLocally(initial, tmpDir, 'en');
      await fs.access(path.join(tmpDir, 'ai-siteprofile', 'topic.md'));

      const next = [
        { id: 2, key: 'Content.MinTitleLength', value: '9', language: null, createdAt: '2024-01-01T00:00:00Z' },
      ];

      await saveSettingsLocally(next, tmpDir, 'en');

      await expect(fs.access(path.join(tmpDir, 'ai-siteprofile', 'topic.md'))).rejects.toThrow();
      await expect(fs.access(path.join(tmpDir, 'ai-siteprofile'))).rejects.toThrow();
    });

    it('reconciles removed JSON setting categories by deleting empty content/media json files', async () => {
      const initial = [
        { id: 1, key: 'Content.MinTitleLength', value: '9', language: null, createdAt: '2024-01-01T00:00:00Z' },
        { id: 2, key: 'Media.Quality', value: '99', language: null, createdAt: '2024-01-01T00:00:00Z' },
      ];

      await saveSettingsLocally(initial, tmpDir, 'en');
      await fs.access(path.join(tmpDir, 'content.json'));
      await fs.access(path.join(tmpDir, 'media.json'));

      const next = [
        { id: 3, key: 'AI.SiteProfile.Topic', value: 'Kept AI setting', language: null, createdAt: '2024-01-01T00:00:00Z' },
      ];

      await saveSettingsLocally(next, tmpDir, 'en');

      await expect(fs.access(path.join(tmpDir, 'content.json'))).rejects.toThrow();
      await expect(fs.access(path.join(tmpDir, 'media.json'))).rejects.toThrow();
      await fs.access(path.join(tmpDir, 'ai-siteprofile', 'topic.md'));
    });

    it('reconciles to empty local state when remote tracked settings become empty', async () => {
      const initial = [
        { id: 1, key: 'AI.SiteProfile.Topic', value: 'Initial topic', language: null, createdAt: '2024-01-01T00:00:00Z' },
        { id: 2, key: 'Content.MinTitleLength', value: '9', language: null, createdAt: '2024-01-01T00:00:00Z' },
        { id: 3, key: 'Media.Quality', value: '99', language: null, createdAt: '2024-01-01T00:00:00Z' },
      ];

      await saveSettingsLocally(initial, tmpDir, 'en');
      let localSettings = await readLocalSettings(tmpDir, 'en');
      expect(localSettings.length).toBeGreaterThan(0);

      await saveSettingsLocally([], tmpDir, 'en');

      localSettings = await readLocalSettings(tmpDir, 'en');
      expect(localSettings).toHaveLength(0);
    });
  });

  describe('buildSettingsStatus', () => {
    it('detects settings in sync', () => {
      const local = [
        { key: 'Content.MinTitleLength', value: '9', language: null },
      ];
      const remote = [
        { id: 1, key: 'Content.MinTitleLength', value: '9', language: null, createdAt: '2024-01-01T00:00:00Z' },
      ];

      const result = buildSettingsStatus(local, remote);
      expect(result.comparisons).toHaveLength(1);
      expect(result.comparisons[0].status).toBe('in-sync');
    });

    it('detects modified settings', () => {
      const local = [
        { key: 'Content.MinTitleLength', value: '10', language: null },
      ];
      const remote = [
        { id: 1, key: 'Content.MinTitleLength', value: '9', language: null, createdAt: '2024-01-01T00:00:00Z' },
      ];

      const result = buildSettingsStatus(local, remote);
      expect(result.comparisons).toHaveLength(1);
      expect(result.comparisons[0].status).toBe('modified');
      expect(result.comparisons[0].localValue).toBe('10');
      expect(result.comparisons[0].remoteValue).toBe('9');
    });

    it('detects local-only settings', () => {
      const local = [
        { key: 'Content.MinTitleLength', value: '9', language: null },
      ];
      const remote: any[] = [];

      const result = buildSettingsStatus(local, remote);
      expect(result.comparisons).toHaveLength(1);
      expect(result.comparisons[0].status).toBe('local-only');
    });

    it('detects remote-only settings', () => {
      const local: any[] = [];
      const remote = [
        { id: 1, key: 'Content.MinTitleLength', value: '9', language: null, createdAt: '2024-01-01T00:00:00Z' },
      ];

      const result = buildSettingsStatus(local, remote);
      expect(result.comparisons).toHaveLength(1);
      expect(result.comparisons[0].status).toBe('remote-only');
    });

    it('filters out remote settings with null/empty values from remote-only status', () => {
      const local: any[] = [];
      const remote = [
        { id: 1, key: 'Content.MinTitleLength', value: null, language: null, createdAt: '2024-01-01T00:00:00Z' },
        { id: 2, key: 'Content.MaxTitleLength', value: '', language: null, createdAt: '2024-01-01T00:00:00Z' },
        { id: 3, key: 'AI.SiteProfile.Topic', value: null, language: null, createdAt: '2024-01-01T00:00:00Z' },
        { id: 4, key: 'Media.Quality', value: '99', language: null, createdAt: '2024-01-01T00:00:00Z' },
      ];

      const result = buildSettingsStatus(local, remote);
      expect(result.comparisons).toHaveLength(1);
      expect(result.comparisons[0].status).toBe('remote-only');
      expect(result.comparisons[0].key).toBe('Media.Quality');
      expect(result.comparisons[0].remoteValue).toBe('99');
    });

    it('handles language-specific settings separately', () => {
      const local = [
        { key: 'AI.SiteProfile.Topic', value: 'Tech', language: null },
        { key: 'AI.SiteProfile.Topic', value: 'Технологии', language: 'ru-RU' },
      ];
      const remote = [
        { id: 1, key: 'AI.SiteProfile.Topic', value: 'Tech', language: null, createdAt: '2024-01-01T00:00:00Z' },
        { id: 2, key: 'AI.SiteProfile.Topic', value: 'Технологии - обновлено', language: 'ru-RU', createdAt: '2024-01-01T00:00:00Z' },
      ];

      const result = buildSettingsStatus(local, remote);
      expect(result.comparisons).toHaveLength(2);

      const defaultLang = result.comparisons.find(c => c.language === null);
      expect(defaultLang!.status).toBe('in-sync');

      const ruLang = result.comparisons.find(c => c.language === 'ru-RU');
      expect(ruLang!.status).toBe('modified');
    });

    it('only includes tracked keys in comparison', () => {
      const local = [
        { key: 'Content.MinTitleLength', value: '9', language: null },
      ];
      const remote = [
        { id: 1, key: 'Content.MinTitleLength', value: '9', language: null, createdAt: '2024-01-01T00:00:00Z' },
        { id: 2, key: 'Identity.RequireDigit', value: 'true', language: null, createdAt: '2024-01-01T00:00:00Z' },
      ];

      const result = buildSettingsStatus(local, remote);
      expect(result.comparisons).toHaveLength(1);
      expect(result.comparisons[0].key).toBe('Content.MinTitleLength');
    });

    it('sorts comparisons by key then language', () => {
      const local = [
        { key: 'Media.Quality', value: '99', language: null },
        { key: 'Content.MinTitleLength', value: '9', language: null },
        { key: 'AI.SiteProfile.Topic', value: 'Tech', language: 'ru-RU' },
        { key: 'AI.SiteProfile.Topic', value: 'Tech', language: null },
      ];
      const remote: any[] = [];

      const result = buildSettingsStatus(local, remote);
      expect(result.comparisons.map(c => c.key)).toEqual([
        'AI.SiteProfile.Topic',
        'AI.SiteProfile.Topic',
        'Content.MinTitleLength',
        'Media.Quality',
      ]);
      // Within same key, null language comes before 'ru-RU'
      expect(result.comparisons[0].language).toBeNull();
      expect(result.comparisons[1].language).toBe('ru-RU');
    });
  });

  describe('buildSettingsPushOperations', () => {
    it('returns create operations for new settings', () => {
      const local = [
        { key: 'Content.MinTitleLength', value: '9', language: null },
      ];
      const remote: any[] = [];

      const operations = buildSettingsPushOperations(local, remote);
      expect(operations).toHaveLength(1);
      expect(operations[0].type).toBe('create');
      expect(operations[0].key).toBe('Content.MinTitleLength');
      expect(operations[0].localValue).toBe('9');
    });

    it('returns update operations for modified settings', () => {
      const local = [
        { key: 'Content.MinTitleLength', value: '10', language: null },
      ];
      const remote = [
        { id: 1, key: 'Content.MinTitleLength', value: '9', language: null, createdAt: '2024-01-01T00:00:00Z' },
      ];

      const operations = buildSettingsPushOperations(local, remote);
      expect(operations).toHaveLength(1);
      expect(operations[0].type).toBe('update');
      expect(operations[0].localValue).toBe('10');
      expect(operations[0].remoteValue).toBe('9');
      expect(operations[0].remoteId).toBe(1);
    });

    it('returns unchanged operations for in-sync settings', () => {
      const local = [
        { key: 'Content.MinTitleLength', value: '9', language: null },
      ];
      const remote = [
        { id: 1, key: 'Content.MinTitleLength', value: '9', language: null, createdAt: '2024-01-01T00:00:00Z' },
      ];

      const operations = buildSettingsPushOperations(local, remote);
      expect(operations).toHaveLength(1);
      expect(operations[0].type).toBe('unchanged');
    });

    it('handles language-specific operations', () => {
      const local = [
        { key: 'Media.Max.FileSize', value: '1020', language: null },
        { key: 'Media.Max.FileSize', value: '2048', language: 'ru-RU' },
      ];
      const remote = [
        { id: 1, key: 'Media.Max.FileSize', value: '1020', language: null, createdAt: '2024-01-01T00:00:00Z' },
      ];

      const operations = buildSettingsPushOperations(local, remote);
      expect(operations).toHaveLength(2);

      const defaultOp = operations.find(op => op.language === null);
      expect(defaultOp!.type).toBe('unchanged');

      const ruOp = operations.find(op => op.language === 'ru-RU');
      expect(ruOp!.type).toBe('create');
      expect(ruOp!.localValue).toBe('2048');
    });

    it('skips non-tracked keys from local settings', () => {
      const local = [
        { key: 'Identity.RequireDigit', value: 'true', language: null },
        { key: 'Content.MinTitleLength', value: '9', language: null },
      ];
      const remote: any[] = [];

      const operations = buildSettingsPushOperations(local, remote);
      expect(operations).toHaveLength(1);
      expect(operations[0].key).toBe('Content.MinTitleLength');
    });
  });

  describe('full round-trip test', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'leadcms-settings-roundtrip-'));
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('saves remote settings, reads them back, and compares correctly', async () => {
      const remoteSettings = [
        { id: 1, key: 'AI.SiteProfile.Topic', value: 'Technology', language: null, createdAt: '2024-01-01T00:00:00Z' },
        { id: 2, key: 'AI.SiteProfile.Audience', value: 'Developers', language: null, createdAt: '2024-01-01T00:00:00Z' },
        { id: 3, key: 'Content.MinTitleLength', value: '9', language: null, createdAt: '2024-01-01T00:00:00Z' },
        { id: 4, key: 'Content.MaxTitleLength', value: '66', language: null, createdAt: '2024-01-01T00:00:00Z' },
        { id: 5, key: 'Media.Quality', value: '99', language: null, createdAt: '2024-01-01T00:00:00Z' },
        { id: 6, key: 'Media.PreferredFormat', value: 'jpeg', language: null, createdAt: '2024-01-01T00:00:00Z' },
        { id: 7, key: 'AI.SiteProfile.Topic', value: 'Технологии', language: 'ru-RU', createdAt: '2024-01-01T00:00:00Z' },
      ];

      // Save
      await saveSettingsLocally(remoteSettings, tmpDir, 'en');

      // Read back
      const localSettings = await readLocalSettings(tmpDir, 'en');
      expect(localSettings).toHaveLength(7);

      // Compare — should all be in sync
      const status = buildSettingsStatus(localSettings, remoteSettings);
      const inSync = status.comparisons.filter(c => c.status === 'in-sync');
      expect(inSync).toHaveLength(7);
      expect(status.comparisons.filter(c => c.status !== 'in-sync')).toHaveLength(0);
    });

    it('detects changes after modifying local files', async () => {
      const remoteSettings = [
        { id: 1, key: 'Content.MinTitleLength', value: '9', language: null, createdAt: '2024-01-01T00:00:00Z' },
        { id: 2, key: 'Media.Quality', value: '99', language: null, createdAt: '2024-01-01T00:00:00Z' },
      ];

      await saveSettingsLocally(remoteSettings, tmpDir, 'en');

      // Modify content.json locally
      const contentPath = path.join(tmpDir, 'content.json');
      const contentJson = JSON.parse(await fs.readFile(contentPath, 'utf8'));
      contentJson.MinTitleLength = '15';
      await fs.writeFile(contentPath, JSON.stringify(contentJson, null, 2) + '\n', 'utf8');

      // Read back and compare
      const localSettings = await readLocalSettings(tmpDir, 'en');
      const status = buildSettingsStatus(localSettings, remoteSettings);

      const modified = status.comparisons.find(c => c.status === 'modified');
      expect(modified).toBeDefined();
      expect(modified!.key).toBe('Content.MinTitleLength');
      expect(modified!.localValue).toBe('15');
      expect(modified!.remoteValue).toBe('9');

      // Build push operations
      const ops = buildSettingsPushOperations(localSettings, remoteSettings);
      const updateOp = ops.find(op => op.type === 'update');
      expect(updateOp).toBeDefined();
      expect(updateOp!.key).toBe('Content.MinTitleLength');
      expect(updateOp!.localValue).toBe('15');
    });
  });

  describe('real API response', () => {
    const realApiResponse = [
      { "id": 22, "key": "AI.SiteProfile.Topic", "value": "Topic - Generic", "userId": null, "language": null, "required": false, "type": "textarea", "description": "Main site topic", "createdAt": "2026-03-01T08:36:39.040411Z", "updatedAt": "2026-03-01T08:36:39.179649Z", "createdById": "45420d35", "updatedById": "45420d35" },
      { "id": 23, "key": "AI.SiteProfile.Audience", "value": "Audience - Generic", "userId": null, "language": null, "required": false, "type": "textarea", "description": "Target audience", "createdAt": "2026-03-01T08:36:39.040413Z", "updatedAt": "2026-03-01T08:36:39.179651Z", "createdById": "45420d35", "updatedById": "45420d35" },
      { "id": 24, "key": "AI.SiteProfile.BrandVoice", "value": "Brand Voice - Generic", "userId": null, "language": null, "required": false, "type": "textarea", "description": "Brand voice", "createdAt": "2026-03-01T08:36:39.040415Z", "updatedAt": "2026-03-01T08:36:39.179652Z", "createdById": "45420d35", "updatedById": "45420d35" },
      { "id": 3, "key": "Content.MinTitleLength", "value": "9", "userId": null, "language": null, "required": false, "type": "int", "description": "Min title length", "createdAt": "2026-03-01T08:36:39.040369Z", "updatedAt": "2026-03-01T08:36:39.179611Z", "createdById": "45420d35", "updatedById": "45420d35" },
      { "id": 20, "key": "Media.Quality", "value": "99", "userId": null, "language": null, "required": false, "type": "int", "description": "Output quality", "createdAt": "2026-03-01T08:36:39.040407Z", "updatedAt": "2026-03-01T08:36:39.179641Z", "createdById": "45420d35", "updatedById": "45420d35" },
      { "id": 58, "key": "AI.SiteProfile.Topic", "value": "Topic - RU", "userId": null, "language": "ru-RU", "required": false, "type": "textarea", "description": "Main site topic", "createdAt": "2026-03-01T08:38:10.004784Z", "updatedAt": "2026-03-01T08:38:10.257592Z", "createdById": "45420d35", "updatedById": "45420d35" },
      { "id": 90, "key": "Media.Max.FileSize", "value": "2048", "userId": null, "language": "ru-RU", "required": false, "type": "int", "description": "Max file size", "createdAt": "2026-03-01T08:38:28.54967Z", "updatedAt": "2026-03-01T08:38:28.970678Z", "createdById": "45420d35", "updatedById": "45420d35" },
      { "id": 1, "key": "LivePreviewUrlTemplate", "value": "", "userId": null, "language": null, "required": false, "type": "text", "description": "Live preview URL", "createdAt": "2026-03-01T08:36:39.04012Z", "updatedAt": "2026-03-01T08:36:39.179463Z", "createdById": "45420d35", "updatedById": "45420d35" },
    ] as any[];

    it('filterTrackedSettings includes AI.SiteProfile settings', () => {
      const tracked = filterTrackedSettings(realApiResponse);
      const aiKeys = tracked.filter(s => s.key.startsWith('AI.SiteProfile.'));
      expect(aiKeys.length).toBeGreaterThan(0);
      expect(aiKeys.map(s => s.key)).toContain('AI.SiteProfile.Topic');
      expect(aiKeys.map(s => s.key)).toContain('AI.SiteProfile.Audience');
      expect(aiKeys.map(s => s.key)).toContain('AI.SiteProfile.BrandVoice');
    });

    it('filterTrackedSettings includes language-specific settings', () => {
      const tracked = filterTrackedSettings(realApiResponse);
      const langSpecific = tracked.filter(s => s.language === 'ru-RU');
      expect(langSpecific.length).toBeGreaterThan(0);
      expect(langSpecific.map(s => s.key)).toContain('AI.SiteProfile.Topic');
      expect(langSpecific.map(s => s.key)).toContain('Media.Max.FileSize');
    });

    it('buildSettingsStatus shows AI.SiteProfile as remote-only when no local', () => {
      const status = buildSettingsStatus([], realApiResponse);
      const aiComparisons = status.comparisons.filter(c => c.key.startsWith('AI.SiteProfile.'));
      expect(aiComparisons.length).toBeGreaterThan(0);
      expect(aiComparisons.every(c => c.status === 'remote-only')).toBe(true);
    });

    it('buildSettingsStatus shows language-specific remote settings', () => {
      const status = buildSettingsStatus([], realApiResponse);
      const ruComparisons = status.comparisons.filter(c => c.language === 'ru-RU');
      expect(ruComparisons.length).toBeGreaterThan(0);
    });

    it('full flow: pull and status round-trip with real data', async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'leadcms-real-api-test-'));

      try {
        const tracked = filterTrackedSettings(realApiResponse);

        // Save
        await saveSettingsLocally(tracked, tmpDir, 'en');

        // Read back
        const localSettings = await readLocalSettings(tmpDir, 'en');

        // Verify AI.SiteProfile .md files were created
        const aiSettings = localSettings.filter(s => s.key.startsWith('AI.SiteProfile.'));
        expect(aiSettings.length).toBeGreaterThanOrEqual(3);

        // Verify language-specific files were created
        const ruSettings = localSettings.filter(s => s.language === 'ru-RU');
        expect(ruSettings.length).toBeGreaterThan(0);

        // Status should show all in sync
        const status = buildSettingsStatus(localSettings, realApiResponse);
        const inSync = status.comparisons.filter(c => c.status === 'in-sync');
        expect(inSync.length).toBe(tracked.length);
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });
  });
});

// ── formatSettingValue / formatSettingDiff tests ─────────────────────────────

describe('formatSettingValue', () => {
  it('returns "(not set)" for null/undefined', () => {
    expect(formatSettingValue('Content.MaxTitleLength', null)).toBe('(not set)');
    expect(formatSettingValue('Content.MaxTitleLength', undefined)).toBe('(not set)');
  });

  it('returns "(empty)" for empty string', () => {
    expect(formatSettingValue('Content.MaxTitleLength', '')).toBe('(empty)');
  });

  it('truncates non-AI setting values normally', () => {
    expect(formatSettingValue('Content.MaxTitleLength', '100')).toBe('100');
    expect(formatSettingValue('Media.Quality', '85')).toBe('85');
  });

  it('truncates long non-AI values with ellipsis', () => {
    const longValue = 'a'.repeat(60);
    const result = formatSettingValue('Content.MaxTitleLength', longValue);
    expect(result.length).toBeLessThanOrEqual(40);
    expect(result).toContain('...');
  });

  it('summarises single-line AI.SiteProfile value', () => {
    const result = formatSettingValue('AI.SiteProfile.Topic', 'Tech & Development');
    expect(result).toBe('Tech & Development');
  });

  it('summarises multi-line AI.SiteProfile value with line count', () => {
    const multiLine = 'First line\nSecond line\nThird line';
    const result = formatSettingValue('AI.SiteProfile.Audience', multiLine);
    expect(result).toContain('(3 lines)');
    expect(result).toContain('First line');
  });

  it('shows first non-heading line for markdown AI.SiteProfile values', () => {
    const markdown = '# Heading\nActual content here\nMore content';
    const result = formatSettingValue('AI.SiteProfile.BrandVoice', markdown);
    expect(result).toContain('Actual content here');
    expect(result).toContain('(3 lines)');
  });

  it('handles large AI.SiteProfile values without flooding output', () => {
    const bigValue = Array.from({ length: 100 }, (_, i) => `Line ${i + 1}`).join('\n');
    const result = formatSettingValue('AI.SiteProfile.StyleExamples', bigValue);
    expect(result).toContain('(100 lines)');
    expect(result.length).toBeLessThan(80);
  });

  it('truncates long first-line preview in AI.SiteProfile values', () => {
    const longFirstLine = 'A'.repeat(60) + '\nSecond line';
    const result = formatSettingValue('AI.SiteProfile.Topic', longFirstLine);
    expect(result).toContain('...');
    expect(result).toContain('(2 lines)');
  });
});

describe('formatSettingDiff', () => {
  it('shows normal quoted diff for non-AI settings', () => {
    const result = formatSettingDiff('Content.MaxTitleLength', '60', '80');
    expect(result).toBe('"60" → "80"');
  });

  it('shows line count change for AI.SiteProfile settings', () => {
    const remote = 'Line 1\nLine 2\nLine 3';
    const local = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5';
    const result = formatSettingDiff('AI.SiteProfile.Audience', remote, local);
    expect(result).toBe('3 lines → 5 lines');
  });

  it('shows "content changed" when AI.SiteProfile line count is the same', () => {
    const remote = 'Old content\nOld line 2';
    const local = 'New content\nNew line 2';
    const result = formatSettingDiff('AI.SiteProfile.Topic', remote, local);
    expect(result).toBe('content changed (2 lines)');
  });

  it('handles single line AI.SiteProfile diff', () => {
    const result = formatSettingDiff('AI.SiteProfile.Topic', 'Old topic', 'New topic');
    expect(result).toBe('content changed (1 line)');
  });
});

describe('renderSettingDiffPreview', () => {
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('returns false for non-AI settings (no diff rendered)', () => {
    const result = renderSettingDiffPreview('Content.MaxTitleLength', '60', '80');
    expect(result).toBe(false);
  });

  it('returns true for AI.SiteProfile settings', () => {
    const result = renderSettingDiffPreview(
      'AI.SiteProfile.Audience',
      'Old audience text',
      'New audience text',
    );
    expect(result).toBe(true);
  });

  it('returns true for multi-line AI.SiteProfile diffs', () => {
    const remote = 'Line 1\nLine 2\nLine 3';
    const local = 'Line 1\nModified Line 2\nLine 3\nLine 4';
    const result = renderSettingDiffPreview('AI.SiteProfile.BrandVoice', remote, local);
    expect(result).toBe(true);
  });

  it('handles null remote value (new AI.SiteProfile setting)', () => {
    const result = renderSettingDiffPreview(
      'AI.SiteProfile.Topic',
      null,
      '# My Topic\nSome content here',
    );
    expect(result).toBe(true);
  });

  it('handles null local value (deleted AI.SiteProfile setting)', () => {
    const result = renderSettingDiffPreview(
      'AI.SiteProfile.Topic',
      '# My Topic\nSome content here',
      null,
    );
    expect(result).toBe(true);
  });
});

describe('selectOperationsForPush', () => {
  it('filters out unchanged operations when force=false', () => {
    const ops = [
      { type: 'unchanged' as const, key: 'Content.MinTitleLength', language: null, localValue: '9', remoteValue: '9', remoteId: 1 },
      { type: 'update' as const, key: 'Media.Quality', language: null, localValue: '90', remoteValue: '80', remoteId: 2 },
      { type: 'create' as const, key: 'AI.SiteProfile.Topic', language: null, localValue: 'Tech' },
    ];

    const selected = selectOperationsForPush(ops, false);
    expect(selected).toHaveLength(2);
    expect(selected.map(op => op.type)).toEqual(['update', 'create']);
  });

  it('converts unchanged operations to update when force=true', () => {
    const ops = [
      { type: 'unchanged' as const, key: 'Content.MinTitleLength', language: null, localValue: '9', remoteValue: '9', remoteId: 1 },
      { type: 'create' as const, key: 'AI.SiteProfile.Topic', language: null, localValue: 'Tech' },
    ];

    const selected = selectOperationsForPush(ops, true);
    expect(selected).toHaveLength(2);
    expect(selected[0].type).toBe('update');
    expect(selected[0].key).toBe('Content.MinTitleLength');
    expect(selected[1].type).toBe('create');
  });
});
