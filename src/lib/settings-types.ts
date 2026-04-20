/**
 * Type definitions for CMS settings management
 */

/**
 * A setting as returned by the CMS API (export/sync endpoints)
 */
export interface SettingDetailsDto {
  id: number;
  key: string;
  value?: string | null;
  userId?: string | null;
  language?: string | null;
  required?: boolean;
  type?: string | null;
  description?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  createdById?: string | null;
  updatedById?: string | null;
}

/**
 * A setting for the import endpoint
 */
export interface SettingImportDto {
  id?: number | null;
  source?: string | null;
  key: string;
  value?: string | null;
  userId?: string | null;
  language?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

/**
 * Import result from the CMS
 */
export interface SettingImportResult {
  added: number;
  updated: number;
  failed: number;
  skipped: number;
  errors?: Array<{ key?: string; message?: string }> | null;
}

/**
 * The list of setting keys the SDK tracks.
 * Only these keys are pulled/saved/pushed.
 */
export const TRACKED_SETTING_KEYS: readonly string[] = [
  'AI.SiteProfile.Audience',
  'AI.SiteProfile.AvoidTerms',
  'AI.SiteProfile.BlogCover.Instructions',
  'AI.SiteProfile.BrandVoice',
  'AI.SiteProfile.EmailTemplate.Instructions',
  'AI.SiteProfile.PreferredTerms',
  'AI.SiteProfile.StyleExamples',
  'AI.SiteProfile.Topic',
  'LeadCapture.Telegram.MessageTemplate',
  'Content.MaxDescriptionLength',
  'Content.MaxTitleLength',
  'Content.MinDescriptionLength',
  'Content.MinTitleLength',
  'General.PrivacyUrl',
  'General.SiteUrl',
  'General.UnsubscribeUrl',
  'Media.Cover.Dimensions',
  'Media.EnableCoverResize',
  'Media.EnableOptimisation',
  'Media.Max.Dimensions',
  'Media.Max.FileSize',
  'Media.PreferredFormat',
  'Media.Quality',
] as const;

/**
 * Keys that are stored as individual files under ai/site-profile/
 */
export const AI_SITEPROFILE_PREFIX = 'AI.SiteProfile.';

/**
 * Keys that are stored as individual files under lead-capture/telegram/
 */
export const LEADCAPTURE_TELEGRAM_PREFIX = 'LeadCapture.Telegram.';

/**
 * Keys that are grouped into general.json
 */
export const GENERAL_SETTING_PREFIX = 'General.';

/**
 * Keys that are grouped into content.json
 */
export const CONTENT_SETTING_PREFIX = 'Content.';

/**
 * Keys that are grouped into media.json
 */
export const MEDIA_SETTING_PREFIX = 'Media.';

/**
 * File extension overrides for specific setting keys.
 * Keys not in this map default to '.md'.
 */
export const SETTING_FILE_EXTENSIONS: Record<string, string> = {
  'LeadCapture.Telegram.MessageTemplate': '.txt',
};

/**
 * Default file extension for file-based settings.
 */
const DEFAULT_SETTING_EXTENSION = '.md';

/**
 * Get the file extension for a setting key.
 */
export function getSettingFileExtension(key: string): string {
  return SETTING_FILE_EXTENSIONS[key] || DEFAULT_SETTING_EXTENSION;
}

/**
 * Convert a PascalCase segment to kebab-case.
 */
function pascalToKebab(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase();
}

/**
 * Convert a setting key to a relative file path.
 * Only applicable to file-based settings (AI.SiteProfile, LeadCapture.Telegram).
 *
 * Example: 'AI.SiteProfile.Topic' → 'ai/site-profile/topic.md'
 * Example: 'LeadCapture.Telegram.MessageTemplate' → 'lead-capture/telegram/message-template.txt'
 */
export function settingKeyToRelativePath(key: string): string {
  const segments = key.split('.');
  const kebabSegments = segments.map(pascalToKebab);
  const ext = getSettingFileExtension(key);
  return kebabSegments.join('/') + ext;
}

/**
 * Reverse mapping: relative file path back to a tracked setting key.
 * Returns undefined if no tracked key matches.
 */
export function relativePathToSettingKey(relativePath: string): string | undefined {
  for (const key of TRACKED_SETTING_KEYS) {
    if (!isFileSettingKey(key)) continue;
    if (settingKeyToRelativePath(key) === relativePath) {
      return key;
    }
  }
  return undefined;
}

/**
 * Get the set of top-level directory names used by file-based settings.
 * Used to distinguish setting directories from locale directories.
 */
export function getFileSettingTopLevelDirs(): Set<string> {
  const dirs = new Set<string>();
  for (const key of TRACKED_SETTING_KEYS) {
    if (!isFileSettingKey(key)) continue;
    const relPath = settingKeyToRelativePath(key);
    const topDir = relPath.split('/')[0];
    dirs.add(topDir);
  }
  return dirs;
}

/**
 * Mapping from AI.SiteProfile keys to file names (without extension)
 */
export function aiSiteProfileKeyToFileName(key: string): string {
  // e.g. 'AI.SiteProfile.BlogCover.Instructions' → 'blogcover-instructions'
  const suffix = key.slice(AI_SITEPROFILE_PREFIX.length);
  return suffix
    .replace(/\./g, '-')
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase();
}

/**
 * Reverse mapping: file name back to setting key
 */
export function fileNameToAiSiteProfileKey(fileName: string): string | undefined {
  // try matching against known keys
  for (const key of TRACKED_SETTING_KEYS) {
    if (key.startsWith(AI_SITEPROFILE_PREFIX)) {
      if (aiSiteProfileKeyToFileName(key) === fileName) {
        return key;
      }
    }
  }
  return undefined;
}

/**
 * Check if a setting key is a tracked AI.SiteProfile setting
 */
export function isAiSiteProfileKey(key: string): boolean {
  return key.startsWith(AI_SITEPROFILE_PREFIX) && TRACKED_SETTING_KEYS.includes(key);
}

/**
 * Mapping from LeadCapture.Telegram keys to file names (without extension)
 */
export function leadCaptureTelegramKeyToFileName(key: string): string {
  const suffix = key.slice(LEADCAPTURE_TELEGRAM_PREFIX.length);
  return suffix
    .replace(/\./g, '-')
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase();
}

/**
 * Reverse mapping: file name back to LeadCapture.Telegram setting key
 */
export function fileNameToLeadCaptureTelegramKey(fileName: string): string | undefined {
  for (const key of TRACKED_SETTING_KEYS) {
    if (key.startsWith(LEADCAPTURE_TELEGRAM_PREFIX)) {
      if (leadCaptureTelegramKeyToFileName(key) === fileName) {
        return key;
      }
    }
  }
  return undefined;
}

/**
 * Check if a setting key is a tracked LeadCapture.Telegram setting
 */
export function isLeadCaptureTelegramKey(key: string): boolean {
  return key.startsWith(LEADCAPTURE_TELEGRAM_PREFIX) && TRACKED_SETTING_KEYS.includes(key);
}

/**
 * Check if a setting key is stored as an individual file
 * (AI.SiteProfile and LeadCapture.Telegram categories)
 */
export function isFileSettingKey(key: string): boolean {
  return isAiSiteProfileKey(key) || isLeadCaptureTelegramKey(key);
}

/**
 * @deprecated Use isFileSettingKey instead. Kept for backward compatibility.
 */
export function isMarkdownSettingKey(key: string): boolean {
  return isFileSettingKey(key);
}

/**
 * Check if a setting key is a tracked General setting
 */
export function isGeneralSettingKey(key: string): boolean {
  return key.startsWith(GENERAL_SETTING_PREFIX) && TRACKED_SETTING_KEYS.includes(key);
}

/**
 * Check if a setting key is a tracked Content setting
 */
export function isContentSettingKey(key: string): boolean {
  return key.startsWith(CONTENT_SETTING_PREFIX) && TRACKED_SETTING_KEYS.includes(key);
}

/**
 * Check if a setting key is a tracked Media setting
 */
export function isMediaSettingKey(key: string): boolean {
  return key.startsWith(MEDIA_SETTING_PREFIX) && TRACKED_SETTING_KEYS.includes(key);
}

/**
 * Represents a local setting value
 */
export interface LocalSettingValue {
  key: string;
  value: string;
  language?: string | null;
}

/**
 * Comparison entry for status display
 */
export interface SettingComparisonEntry {
  key: string;
  language: string | null;
  localValue: string | null;
  remoteValue: string | null;
  status: 'in-sync' | 'local-only' | 'remote-only' | 'modified';
}

/**
 * Result of building settings status
 */
export interface SettingsStatusResult {
  comparisons: SettingComparisonEntry[];
  totalTracked: number;
}

/**
 * Operation type for push
 */
export interface SettingPushOperation {
  type: 'create' | 'update' | 'unchanged' | 'delete';
  key: string;
  language: string | null;
  localValue: string;
  remoteValue?: string | null;
  remoteId?: number;
}
