/**
 * LeadCMS Settings Management
 *
 * Handles fetching, saving, reading, comparing, and pushing CMS settings.
 * File-based settings are stored as nested folders derived from the key:
 * - ai/site-profile/topic.md     (AI.SiteProfile.Topic)
 * - lead-capture/telegram/message-template.txt  (LeadCapture.Telegram.MessageTemplate)
 * - content.json                 (all Content.* keys grouped)
 * - media.json                   (all Media.* keys grouped)
 *
 * Language-specific settings go into locale subdirectories.
 */

import fs from "fs/promises";
import path from "path";
import axios, { AxiosResponse } from "axios";
import { logger } from "../lib/logger.js";
import {
  type SettingDetailsDto,
  type SettingImportDto,
  type SettingImportResult,
  type LocalSettingValue,
  type SettingComparisonEntry,
  type SettingsStatusResult,
  type SettingPushOperation,
  TRACKED_SETTING_KEYS,
  CONTENT_SETTING_PREFIX,
  GENERAL_SETTING_PREFIX,
  MEDIA_SETTING_PREFIX,
  isFileSettingKey,
  isContentSettingKey,
  isGeneralSettingKey,
  isMediaSettingKey,
  settingKeyToRelativePath,
  getFileSettingTopLevelDirs,
} from "../lib/settings-types.js";

// ── Export remote settings ───────────────────────────────────────────────────

/**
 * Fetch all settings from the CMS via /api/settings/export
 */
export async function fetchRemoteSettings(
  leadCMSUrl: string,
  leadCMSApiKey: string,
): Promise<SettingDetailsDto[]> {
  if (!leadCMSUrl) throw new Error("LeadCMS URL is not configured.");
  if (!leadCMSApiKey) throw new Error("LeadCMS API key is required to fetch settings.");

  const url = new URL("/api/settings/export", leadCMSUrl);

  logger.verbose(`[LeadCMS] Fetching settings from ${url.toString()}`);

  const res: AxiosResponse<SettingDetailsDto[]> = await axios.get(url.toString(), {
    headers: {
      Authorization: `Bearer ${leadCMSApiKey}`,
      Accept: "text/json",
    },
  });

  const allSettings = res.data || [];
  logger.verbose(`[LeadCMS] Received ${allSettings.length} settings from CMS`);

  return allSettings;
}

/**
 * Filter remote settings to only tracked keys.
 * Also filters out settings with null/empty values.
 */
export function filterTrackedSettings(settings: SettingDetailsDto[]): SettingDetailsDto[] {
  return settings.filter((s) => {
    if (!TRACKED_SETTING_KEYS.includes(s.key)) return false;
    if (s.value === null || s.value === undefined || s.value === "") return false;
    return true;
  });
}

// ── Save settings locally ────────────────────────────────────────────────────

/**
 * Save fetched settings to the local settings directory.
 *
 * @param settings - Tracked settings from the CMS
 * @param settingsDir - Resolved path to the settings directory
 * @param defaultLanguage - The project's default language
 * @param targetName - Optional: only save settings matching this key name
 */
export async function saveSettingsLocally(
  settings: SettingDetailsDto[],
  settingsDir: string,
  defaultLanguage: string,
  targetName?: string,
): Promise<void> {
  const reconcile = !targetName;

  // Group settings by language
  const byLanguage = new Map<string, SettingDetailsDto[]>();

  for (const setting of settings) {
    if (targetName && setting.key !== targetName) continue;

    const lang = setting.language || null;
    const langKey = lang || "__default__";
    if (!byLanguage.has(langKey)) byLanguage.set(langKey, []);
    byLanguage.get(langKey)!.push(setting);
  }

  for (const [langKey, langSettings] of byLanguage) {
    const isDefault = langKey === "__default__";
    const baseDir = isDefault ? settingsDir : path.join(settingsDir, langKey);

    await saveSettingsForLanguage(langSettings, baseDir, reconcile);
  }

  if (reconcile) {
    await reconcileMissingLanguages(settingsDir, byLanguage);
  }
}

/**
 * Save settings for a single language to a directory.
 */
async function saveSettingsForLanguage(
  settings: SettingDetailsDto[],
  baseDir: string,
  reconcile: boolean,
): Promise<void> {
  // Group by category
  const fileSettings = settings.filter((s) => isFileSettingKey(s.key));
  const contentSettings = settings.filter((s) => isContentSettingKey(s.key));
  const generalSettings = settings.filter((s) => isGeneralSettingKey(s.key));
  const mediaSettings = settings.filter((s) => isMediaSettingKey(s.key));

  // Save file-based settings as individual files in nested folders
  if (fileSettings.length > 0 || reconcile) {
    const savedKeys = new Set<string>();

    for (const setting of fileSettings) {
      const relPath = settingKeyToRelativePath(setting.key);
      const filePath = path.join(baseDir, relPath);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, setting.value || "", "utf8");
      logger.verbose(`[LeadCMS] Saved ${setting.key} → ${filePath}`);
      savedKeys.add(setting.key);
    }

    if (reconcile) {
      for (const key of TRACKED_SETTING_KEYS) {
        if (!isFileSettingKey(key)) continue;
        if (savedKeys.has(key)) continue;
        const relPath = settingKeyToRelativePath(key);
        const filePath = path.join(baseDir, relPath);
        try {
          await fs.rm(filePath, { force: true });
        } catch {
          // ignore missing files
        }
        await removeEmptyParentDirs(path.dirname(filePath), baseDir);
      }
    }
  }

  // Save Content settings as content.json
  if (contentSettings.length > 0 || reconcile) {
    await fs.mkdir(baseDir, { recursive: true });
    const contentObj: Record<string, string> = {};
    for (const s of contentSettings) {
      // Strip the prefix for cleaner JSON keys
      const shortKey = s.key.slice(CONTENT_SETTING_PREFIX.length);
      contentObj[shortKey] = s.value || "";
    }
    const filePath = path.join(baseDir, "content.json");
    if (Object.keys(contentObj).length > 0) {
      await fs.writeFile(filePath, JSON.stringify(contentObj, null, 2) + "\n", "utf8");
      logger.verbose(`[LeadCMS] Saved content settings → ${filePath}`);
    } else if (reconcile) {
      try {
        await fs.rm(filePath, { force: true });
      } catch {
        // ignore missing files
      }
    }
  }

  // Save General settings as general.json
  if (generalSettings.length > 0 || reconcile) {
    await fs.mkdir(baseDir, { recursive: true });
    const generalObj: Record<string, string> = {};
    for (const s of generalSettings) {
      const shortKey = s.key.slice(GENERAL_SETTING_PREFIX.length);
      generalObj[shortKey] = s.value || "";
    }
    const filePath = path.join(baseDir, "general.json");
    if (Object.keys(generalObj).length > 0) {
      await fs.writeFile(filePath, JSON.stringify(generalObj, null, 2) + "\n", "utf8");
      logger.verbose(`[LeadCMS] Saved general settings → ${filePath}`);
    } else if (reconcile) {
      try {
        await fs.rm(filePath, { force: true });
      } catch {
        // ignore missing files
      }
    }
  }

  // Save Media settings as media.json
  if (mediaSettings.length > 0 || reconcile) {
    await fs.mkdir(baseDir, { recursive: true });
    const mediaObj: Record<string, string> = {};
    for (const s of mediaSettings) {
      const shortKey = s.key.slice(MEDIA_SETTING_PREFIX.length);
      mediaObj[shortKey] = s.value || "";
    }
    const filePath = path.join(baseDir, "media.json");
    if (Object.keys(mediaObj).length > 0) {
      await fs.writeFile(filePath, JSON.stringify(mediaObj, null, 2) + "\n", "utf8");
      logger.verbose(`[LeadCMS] Saved media settings → ${filePath}`);
    } else if (reconcile) {
      try {
        await fs.rm(filePath, { force: true });
      } catch {
        // ignore missing files
      }
    }
  }

  if (reconcile) {
    try {
      const remaining = await fs.readdir(baseDir);
      if (remaining.length === 0) {
        await fs.rm(baseDir, { recursive: true, force: true });
      }
    } catch {
      // ignore when directory does not exist
    }
  }
}

/**
 * Remove empty parent directories up to (but not including) stopAt.
 */
async function removeEmptyParentDirs(dir: string, stopAt: string): Promise<void> {
  let current = dir;
  while (current !== stopAt && current.startsWith(stopAt + path.sep)) {
    try {
      const entries = await fs.readdir(current);
      if (entries.length === 0) {
        await fs.rm(current, { recursive: true, force: true });
        current = path.dirname(current);
      } else {
        break;
      }
    } catch {
      break;
    }
  }
}

async function reconcileMissingLanguages(
  settingsDir: string,
  byLanguage: Map<string, SettingDetailsDto[]>,
): Promise<void> {
  const hasDefault = byLanguage.has("__default__");
  if (!hasDefault) {
    await saveSettingsForLanguage([], settingsDir, true);
  }

  const settingDirs = getFileSettingTopLevelDirs();

  try {
    const entries = await fs.readdir(settingsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (settingDirs.has(entry.name)) continue;
      if (!/^[a-z]{2}(-[a-zA-Z]{2,})?$/.test(entry.name)) continue;
      if (byLanguage.has(entry.name)) continue;

      const langDir = path.join(settingsDir, entry.name);
      await saveSettingsForLanguage([], langDir, true);
    }
  } catch {
    return;
  }
}

// ── Read local settings ──────────────────────────────────────────────────────

/**
 * Read all locally stored settings from the settings directory.
 *
 * @param settingsDir - Resolved path to the settings directory
 * @param defaultLanguage - The project's default language
 * @returns Array of local setting values with their keys and languages
 */
export async function readLocalSettings(
  settingsDir: string,
  defaultLanguage: string,
): Promise<LocalSettingValue[]> {
  const results: LocalSettingValue[] = [];

  try {
    await fs.access(settingsDir);
  } catch {
    // Settings directory doesn't exist yet
    return results;
  }

  // Read default language settings
  const defaultSettings = await readLocalSettingsForDir(settingsDir, null);
  results.push(...defaultSettings);

  // Scan for locale subdirectories
  const settingDirs = getFileSettingTopLevelDirs();
  const entries = await fs.readdir(settingsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // Skip directories used by file-based settings
    if (settingDirs.has(entry.name)) continue;
    // Check if it looks like a locale directory
    if (/^[a-z]{2}(-[a-zA-Z]{2,})?$/.test(entry.name)) {
      const langDir = path.join(settingsDir, entry.name);
      const langSettings = await readLocalSettingsForDir(langDir, entry.name);
      results.push(...langSettings);
    }
  }

  return results;
}

/**
 * Read settings from a single directory (for one language).
 */
async function readLocalSettingsForDir(
  dir: string,
  language: string | null,
): Promise<LocalSettingValue[]> {
  const results: LocalSettingValue[] = [];

  // Read file-based settings by checking expected paths
  for (const key of TRACKED_SETTING_KEYS) {
    if (!isFileSettingKey(key)) continue;
    const relPath = settingKeyToRelativePath(key);
    const filePath = path.join(dir, relPath);
    try {
      const content = await fs.readFile(filePath, "utf8");
      results.push({ key, value: content, language });
    } catch {
      // File doesn't exist
    }
  }

  // Read content.json
  try {
    const contentPath = path.join(dir, "content.json");
    const contentRaw = await fs.readFile(contentPath, "utf8");
    const contentObj = JSON.parse(contentRaw) as Record<string, string>;
    for (const [shortKey, value] of Object.entries(contentObj)) {
      const fullKey = CONTENT_SETTING_PREFIX + shortKey;
      if (TRACKED_SETTING_KEYS.includes(fullKey)) {
        results.push({ key: fullKey, value, language });
      }
    }
  } catch {
    // content.json doesn't exist
  }

  // Read general.json
  try {
    const generalPath = path.join(dir, "general.json");
    const generalRaw = await fs.readFile(generalPath, "utf8");
    const generalObj = JSON.parse(generalRaw) as Record<string, string>;
    for (const [shortKey, value] of Object.entries(generalObj)) {
      const fullKey = GENERAL_SETTING_PREFIX + shortKey;
      if (TRACKED_SETTING_KEYS.includes(fullKey)) {
        results.push({ key: fullKey, value, language });
      }
    }
  } catch {
    // general.json doesn't exist
  }

  // Read media.json
  try {
    const mediaPath = path.join(dir, "media.json");
    const mediaRaw = await fs.readFile(mediaPath, "utf8");
    const mediaObj = JSON.parse(mediaRaw) as Record<string, string>;
    for (const [shortKey, value] of Object.entries(mediaObj)) {
      const fullKey = MEDIA_SETTING_PREFIX + shortKey;
      if (TRACKED_SETTING_KEYS.includes(fullKey)) {
        results.push({ key: fullKey, value, language });
      }
    }
  } catch {
    // media.json doesn't exist
  }

  return results;
}

// ── Compare local vs remote ─────────────────────────────────────────────────

/**
 * Build a comparison between local and remote settings.
 * Only includes tracked settings.
 */
export function buildSettingsStatus(
  localSettings: LocalSettingValue[],
  remoteSettings: SettingDetailsDto[],
): SettingsStatusResult {
  const comparisons: SettingComparisonEntry[] = [];
  const seen = new Set<string>();

  // Build lookup for remote settings: "key|language" → SettingDetailsDto
  const remoteMap = new Map<string, SettingDetailsDto>();
  for (const rs of remoteSettings) {
    if (!TRACKED_SETTING_KEYS.includes(rs.key)) continue;
    const mapKey = `${rs.key}|${rs.language || ""}`;
    remoteMap.set(mapKey, rs);
  }

  // Build lookup for local settings: "key|language" → LocalSettingValue
  const localMap = new Map<string, LocalSettingValue>();
  for (const ls of localSettings) {
    const mapKey = `${ls.key}|${ls.language || ""}`;
    localMap.set(mapKey, ls);
  }

  // Compare all local settings against remote
  for (const [mapKey, local] of localMap) {
    seen.add(mapKey);
    const remote = remoteMap.get(mapKey);

    if (!remote) {
      comparisons.push({
        key: local.key,
        language: local.language || null,
        localValue: local.value,
        remoteValue: null,
        status: "local-only",
      });
    } else if (local.value === (remote.value || "")) {
      comparisons.push({
        key: local.key,
        language: local.language || null,
        localValue: local.value,
        remoteValue: remote.value || null,
        status: "in-sync",
      });
    } else {
      comparisons.push({
        key: local.key,
        language: local.language || null,
        localValue: local.value,
        remoteValue: remote.value || null,
        status: "modified",
      });
    }
  }

  // Check for remote-only settings
  for (const [mapKey, remote] of remoteMap) {
    if (seen.has(mapKey)) continue;
    if (remote.value === null || remote.value === undefined || remote.value === "") continue;

    comparisons.push({
      key: remote.key,
      language: remote.language || null,
      localValue: null,
      remoteValue: remote.value || null,
      status: "remote-only",
    });
  }

  // Sort by key then language
  comparisons.sort((a, b) => {
    const keyCompare = a.key.localeCompare(b.key);
    if (keyCompare !== 0) return keyCompare;
    return (a.language || "").localeCompare(b.language || "");
  });

  return {
    comparisons,
    totalTracked: TRACKED_SETTING_KEYS.length,
  };
}

// ── Push settings ────────────────────────────────────────────────────────────

/**
 * Determine what push operations are needed.
 */
export function buildSettingsPushOperations(
  localSettings: LocalSettingValue[],
  remoteSettings: SettingDetailsDto[],
): SettingPushOperation[] {
  const operations: SettingPushOperation[] = [];

  // Build remote lookup
  const remoteMap = new Map<string, SettingDetailsDto>();
  for (const rs of remoteSettings) {
    if (!TRACKED_SETTING_KEYS.includes(rs.key)) continue;
    const mapKey = `${rs.key}|${rs.language || ""}`;
    remoteMap.set(mapKey, rs);
  }

  for (const local of localSettings) {
    if (!TRACKED_SETTING_KEYS.includes(local.key)) continue;

    const mapKey = `${local.key}|${local.language || ""}`;
    const remote = remoteMap.get(mapKey);

    if (!remote) {
      operations.push({
        type: "create",
        key: local.key,
        language: local.language || null,
        localValue: local.value,
      });
    } else if (local.value !== (remote.value || "")) {
      operations.push({
        type: "update",
        key: local.key,
        language: local.language || null,
        localValue: local.value,
        remoteValue: remote.value,
        remoteId: remote.id,
      });
    } else {
      operations.push({
        type: "unchanged",
        key: local.key,
        language: local.language || null,
        localValue: local.value,
        remoteValue: remote.value,
        remoteId: remote.id,
      });
    }
  }

  // Detect remote-only settings that should be deleted
  const localMap = new Map<string, LocalSettingValue>();
  for (const ls of localSettings) {
    const mapKey = `${ls.key}|${ls.language || ""}`;
    localMap.set(mapKey, ls);
  }

  for (const rs of remoteSettings) {
    if (!TRACKED_SETTING_KEYS.includes(rs.key)) continue;
    const mapKey = `${rs.key}|${rs.language || ""}`;
    if (localMap.has(mapKey)) continue;
    if (rs.value === null || rs.value === undefined || rs.value === "") continue;

    operations.push({
      type: "delete",
      key: rs.key,
      language: rs.language || null,
      localValue: "",
      remoteValue: rs.value,
      remoteId: rs.id,
    });
  }

  return operations;
}

/**
 * Push local settings to the CMS via /api/settings/import
 * and delete remote-only settings via DELETE /api/settings/system/{key}
 */
export async function pushSettingsToRemote(
  operations: SettingPushOperation[],
  leadCMSUrl: string,
  leadCMSApiKey: string,
  dryRun: boolean = false,
): Promise<SettingImportResult | null> {
  const toImport = operations.filter((op) => op.type === "create" || op.type === "update");
  const toDelete = operations.filter((op) => op.type === "delete");

  if (toImport.length === 0 && toDelete.length === 0) {
    logger.info("[LeadCMS] No settings changes to push.");
    return null;
  }

  if (dryRun) {
    logger.info("[LeadCMS] Dry run - would import the following settings:");
    for (const op of toImport) {
      const lang = op.language ? ` [${op.language}]` : "";
      logger.info(`  ${op.type}: ${op.key}${lang} = "${op.localValue}"`);
    }
    for (const op of toDelete) {
      const lang = op.language ? ` [${op.language}]` : "";
      logger.info(`  delete: ${op.key}${lang}`);
    }
    return null;
  }

  let result: SettingImportResult = { added: 0, updated: 0, failed: 0, skipped: 0, errors: [] };

  // Import create/update operations
  if (toImport.length > 0) {
    const importPayload: SettingImportDto[] = toImport.map((op) => ({
      key: op.key,
      value: op.localValue,
      language: op.language,
      source: "leadcms-sdk",
    }));

    const url = new URL("/api/settings/import", leadCMSUrl);

    logger.verbose(`[LeadCMS] Pushing ${importPayload.length} settings to ${url.toString()}`);

    const res: AxiosResponse<SettingImportResult> = await axios.post(
      url.toString(),
      importPayload,
      {
        headers: {
          Authorization: `Bearer ${leadCMSApiKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    result = res.data;
  }

  // Delete remote-only settings
  for (const op of toDelete) {
    try {
      const deleteUrl = new URL(`/api/settings/system/${encodeURIComponent(op.key)}`, leadCMSUrl);
      if (op.language) {
        deleteUrl.searchParams.set("language", op.language);
      }

      logger.verbose(`[LeadCMS] Deleting setting ${op.key}${op.language ? ` [${op.language}]` : ""}`);

      await axios.delete(deleteUrl.toString(), {
        headers: {
          Authorization: `Bearer ${leadCMSApiKey}`,
        },
      });

      result.updated++;
    } catch (err: any) {
      result.failed++;
      const lang = op.language ? ` [${op.language}]` : "";
      const errMsg = err.response?.data?.detail || err.message || "Unknown error";
      result.errors = result.errors || [];
      result.errors.push({ key: `${op.key}${lang}`, message: errMsg });
    }
  }

  return result;
}
