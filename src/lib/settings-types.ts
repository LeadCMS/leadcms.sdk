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
  'Content.MaxDescriptionLength',
  'Content.MaxTitleLength',
  'Content.MinDescriptionLength',
  'Content.MinTitleLength',
  'Media.Cover.Dimensions',
  'Media.EnableCoverResize',
  'Media.EnableOptimisation',
  'Media.Max.Dimensions',
  'Media.Max.FileSize',
  'Media.PreferredFormat',
  'Media.Quality',
] as const;

/**
 * Keys that are stored as individual .md files under ai-siteprofile/
 */
export const AI_SITEPROFILE_PREFIX = 'AI.SiteProfile.';

/**
 * Keys that are grouped into content.json
 */
export const CONTENT_SETTING_PREFIX = 'Content.';

/**
 * Keys that are grouped into media.json
 */
export const MEDIA_SETTING_PREFIX = 'Media.';

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
  type: 'create' | 'update' | 'unchanged';
  key: string;
  language: string | null;
  localValue: string;
  remoteValue?: string | null;
  remoteId?: number;
}
