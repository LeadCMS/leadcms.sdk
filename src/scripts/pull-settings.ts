/**
 * Pull settings from LeadCMS and save them locally.
 */

import "dotenv/config";
import fs from "fs/promises";
import { leadCMSUrl, leadCMSApiKey, defaultLanguage, SETTINGS_DIR } from "./leadcms-helpers.js";
import {
  fetchRemoteSettings,
  filterTrackedSettings,
  saveSettingsLocally,
} from "./settings-manager.js";
import { logger } from "../lib/logger.js";

interface ScriptError extends Error {
  code?: string;
  response?: {
    status?: number;
    data?: { detail?: string; title?: string; message?: string; [key: string]: unknown } | null;
  };
  status?: number;
}

export interface PullSettingsOptions {
  /** Only pull a specific setting by key name */
  targetName?: string;
  /** Reset local settings directory before pulling */
  reset?: boolean;
}

/**
 * Reset the local settings directory.
 */
export async function resetSettingsState(): Promise<void> {
  try {
    await fs.rm(SETTINGS_DIR, { recursive: true, force: true });
    logger.verbose(`   ✓ Cleared settings directory: ${SETTINGS_DIR}`);
  } catch {
    /* directory may not exist */
  }
}

/**
 * Pull settings from LeadCMS and save locally.
 */
export async function pullSettings(options: PullSettingsOptions = {}): Promise<void> {
  const { targetName, reset } = options;

  if (reset) {
    console.log(`🗑️  Resetting local settings...`);
    await resetSettingsState();
  }

  if (!leadCMSApiKey) {
    console.log("⏭️  Skipping settings pull (no API key configured)");
    return;
  }

  console.log(`⚙️  Pulling settings from LeadCMS...`);

  try {
    const allSettings = await fetchRemoteSettings(leadCMSUrl, leadCMSApiKey);
    const tracked = filterTrackedSettings(allSettings);

    if (tracked.length === 0) {
      await saveSettingsLocally([], SETTINGS_DIR, defaultLanguage);
      console.log(`   ✅ No tracked settings found on remote (local tracked settings reconciled)`);
      return;
    }

    if (targetName) {
      const matching = tracked.filter((s) => s.key === targetName);
      if (matching.length === 0) {
        console.log(`   ℹ️  Setting "${targetName}" not found or has no value on remote`);
        return;
      }
      await saveSettingsLocally(matching, SETTINGS_DIR, defaultLanguage, targetName);
      console.log(
        `   ✅ Pulled setting: ${targetName} (${matching.length} language variant${matching.length !== 1 ? "s" : ""})`
      );
    } else {
      await saveSettingsLocally(tracked, SETTINGS_DIR, defaultLanguage);

      // Count unique keys
      const uniqueKeys = new Set(tracked.map((s) => s.key));
      const languages = new Set(tracked.filter((s) => s.language).map((s) => s.language));
      console.log(
        `   ✅ Pulled ${uniqueKeys.size} settings${languages.size > 0 ? ` across ${languages.size + 1} language(s)` : ""}`
      );
    }
  } catch (_error: unknown) {
    const error = _error as ScriptError;
    if (error.response?.status === 401) {
      console.error("   ❌ Authentication failed while pulling settings");
      throw error;
    }
    console.error(`   ❌ Failed to pull settings: ${error.message}`);
    throw error;
  }
}
