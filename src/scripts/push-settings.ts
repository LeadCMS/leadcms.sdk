/**
 * Push local settings to LeadCMS.
 */

import "dotenv/config";
import { leadCMSUrl, leadCMSApiKey, defaultLanguage, SETTINGS_DIR } from "./leadcms-helpers.js";
import {
  fetchRemoteSettings,
  readLocalSettings,
  buildSettingsPushOperations,
  pushSettingsToRemote,
  buildSettingsStatus,
} from "./settings-manager.js";
import { colorConsole, statusColors, diffColors } from "../lib/console-colors.js";
import type { SettingsStatusResult } from "../lib/settings-types.js";
import { isMarkdownSettingKey } from "../lib/settings-types.js";
import * as Diff from "diff";

export interface PushSettingsOptions {
  /** Only push a specific setting by key name */
  targetName?: string;
  /** Show what would be pushed without actually pushing */
  dryRun?: boolean;
  /** Force push even if unchanged */
  force?: boolean;
}

export function selectOperationsForPush(
  operations: ReturnType<typeof buildSettingsPushOperations>,
  force: boolean,
): ReturnType<typeof buildSettingsPushOperations> {
  if (!force) {
    return operations.filter((op) => op.type !== "unchanged");
  }

  return operations.map((op) => {
    if (op.type !== "unchanged") return op;
    return {
      ...op,
      type: "update" as const,
    };
  });
}

/**
 * Push local settings to LeadCMS.
 */
export async function pushSettings(options: PushSettingsOptions = {}): Promise<void> {
  const { targetName, dryRun, force } = options;

  if (!leadCMSApiKey) {
    console.log("⏭️  Skipping settings push (no API key configured)");
    return;
  }

  console.log(`⚙️  Pushing settings to LeadCMS...`);

  try {
    // Read local settings
    let localSettings = await readLocalSettings(SETTINGS_DIR, defaultLanguage);

    if (targetName) {
      localSettings = localSettings.filter((s) => s.key === targetName);
    }

    // Fetch remote settings for comparison
    const allRemote = await fetchRemoteSettings(leadCMSUrl, leadCMSApiKey);

    // Build operations (includes delete for remote-only settings)
    const operations = buildSettingsPushOperations(localSettings, allRemote);
    const changes = operations.filter((op) => op.type !== "unchanged");

    if (changes.length === 0 && !force) {
      console.log(`   ✅ All settings are in sync, nothing to push`);
      return;
    }

    const toPush = selectOperationsForPush(operations, Boolean(force));

    if (toPush.length === 0) {
      console.log(`   ✅ All settings are in sync, nothing to push`);
      return;
    }

    if (dryRun) {
      console.log(`   🔍 Dry run - would push ${toPush.length} setting(s):`);
      for (const op of toPush) {
        const lang = op.language ? ` [${op.language}]` : "";
        if (op.type === "delete") {
          console.log(`     ${op.type}: ${op.key}${lang} (remove from remote)`);
        } else {
          console.log(`     ${op.type}: ${op.key}${lang} = "${op.localValue}"`);
        }
      }
      return;
    }

    // Push via import API and delete remote-only settings
    const result = await pushSettingsToRemote(toPush, leadCMSUrl, leadCMSApiKey, dryRun || false);

    if (result) {
      const deleted = toPush.filter(op => op.type === "delete").length;
      const parts = [`${result.added} added`, `${result.updated} updated`];
      if (deleted > 0) parts.push(`${deleted} deleted`);
      parts.push(`${result.failed} failed`, `${result.skipped} skipped`);
      console.log(`   ✅ Settings push complete: ${parts.join(", ")}`);
      if (result.errors && result.errors.length > 0) {
        for (const err of result.errors) {
          console.error(`   ❌ ${err.key || "unknown"}: ${err.message || "Unknown error"}`);
        }
      }
    }
  } catch (error: any) {
    if (error.response?.status === 401) {
      console.error("   ❌ Authentication failed while pushing settings");
      throw error;
    }
    console.error(`   ❌ Failed to push settings: ${error.message}`);
    throw error;
  }
}

/**
 * Show settings status (local vs remote comparison).
 */
export async function statusSettings(options: { targetName?: string } = {}): Promise<void> {
  const { targetName } = options;

  if (!leadCMSApiKey) {
    console.log("⏭️  Skipping settings status (no API key configured)");
    return;
  }

  try {
    const statusResult = await getSettingsStatusData(options);

    if (!statusResult) return;

    renderSettingsStatus(statusResult, targetName);
  } catch (error: any) {
    console.error(`   ❌ Failed to check settings status: ${error.message}`);
    throw error;
  }
}

/**
 * Get settings status data without rendering (for unified status view).
 */
export async function getSettingsStatusData(
  options: { targetName?: string } = {},
): Promise<SettingsStatusResult | null> {
  const { targetName } = options;

  if (!leadCMSApiKey) {
    return null;
  }

  // Read local settings
  let localSettings = await readLocalSettings(SETTINGS_DIR, defaultLanguage);

  // Fetch remote settings
  const allRemote = await fetchRemoteSettings(leadCMSUrl, leadCMSApiKey);

  // Build comparison
  const statusResult = buildSettingsStatus(localSettings, allRemote);

  if (targetName) {
    statusResult.comparisons = statusResult.comparisons.filter((c) => c.key === targetName);
  }

  return statusResult;
}

/**
 * Render settings status to console.
 */
export function renderSettingsStatus(
  statusResult: SettingsStatusResult,
  targetName?: string,
): void {
  const { comparisons } = statusResult;

  if (comparisons.length === 0) {
    if (targetName) {
      console.log(`   ℹ️  Setting "${targetName}" not found locally or remotely`);
    } else {
      console.log(`   ✅ No tracked settings found`);
    }
    return;
  }

  colorConsole.important("\n⚙️  Settings Status");
  console.log("─".repeat(80));

  const modified = comparisons.filter((c) => c.status === "modified");
  const localOnly = comparisons.filter((c) => c.status === "local-only");
  const remoteOnly = comparisons.filter((c) => c.status === "remote-only");
  const inSync = comparisons.filter((c) => c.status === "in-sync");

  const changeCount = modified.length + localOnly.length + remoteOnly.length;

  if (changeCount === 0) {
    colorConsole.success(`\n✅ All ${inSync.length} tracked setting(s) are in sync!\n`);
    return;
  }

  console.log("");

  for (const entry of comparisons) {
    const lang = entry.language ? ` [${entry.language}]` : "";
    const label = `${entry.key}${lang}`;

    switch (entry.status) {
      case "in-sync":
        console.log(`  ${colorConsole.gray("✓")} ${label.padEnd(50)} ${colorConsole.gray(formatSettingValue(entry.key, entry.localValue))}`);
        break;
      case "modified":
        console.log(`  ${statusColors.modified("M")} ${label.padEnd(50)} ${colorConsole.gray(formatSettingDiff(entry.key, entry.remoteValue, entry.localValue))}`);
        renderSettingDiffPreview(entry.key, entry.remoteValue, entry.localValue, "      ");
        break;
      case "local-only":
        console.log(`  ${statusColors.created("+")} ${label.padEnd(50)} ${colorConsole.highlight(formatSettingValue(entry.key, entry.localValue))} ${colorConsole.gray("(local only)")}`);
        break;
      case "remote-only":
        console.log(`  ${statusColors.conflict("-")} ${label.padEnd(50)} ${colorConsole.gray(formatSettingValue(entry.key, entry.remoteValue))} ${colorConsole.gray("(remote only)")}`);
        break;
    }
  }

  console.log("");
  console.log("─".repeat(80));
  console.log(`  ${inSync.length} in sync, ${modified.length} modified, ${localOnly.length} local only, ${remoteOnly.length} remote only`);
  console.log("");
}

function truncateValue(value: string, maxLen: number = 40): string {
  const singleLine = value.replace(/\n/g, "\\n");
  if (singleLine.length <= maxLen) return singleLine;
  return singleLine.slice(0, maxLen - 3) + "...";
}

/**
 * Format a setting value for display.
 * AI.SiteProfile values (which are stored as .md files) get a content-style
 * summary: first meaningful line + line count.  All other keys use the normal
 * short truncation.
 */
export function formatSettingValue(key: string, value: string | null | undefined): string {
  if (!value && value !== "") return "(not set)";
  if (value === "") return "(empty)";

  if (!isMarkdownSettingKey(key)) {
    return truncateValue(value);
  }

  // Markdown setting: summarise like a text file
  const lines = value.split(/\r?\n/);
  const lineCount = lines.length;
  // Pick the first non-empty, non-heading line as a preview
  const preview =
    lines.find((l) => l.trim() !== "" && !l.startsWith("#"))?.trim() ||
    lines.find((l) => l.trim() !== "")?.trim() ||
    "";
  const shortPreview = preview.length > 40 ? preview.slice(0, 37) + "..." : preview;

  if (lineCount <= 1) return shortPreview;
  return `${shortPreview} (${lineCount} lines)`;
}

/**
 * Format a diff description for a modified markdown setting.
 * Returns e.g. "3 lines → 47 lines" or the normal "old" → "new" for short values.
 */
export function formatSettingDiff(
  key: string,
  remoteValue: string | null | undefined,
  localValue: string | null | undefined,
): string {
  if (!isMarkdownSettingKey(key)) {
    return `"${truncateValue(remoteValue || '')}" → "${truncateValue(localValue || '')}"`;
  }

  const remoteLines = (remoteValue || "").split(/\r?\n/).length;
  const localLines = (localValue || "").split(/\r?\n/).length;

  if (remoteLines === localLines) {
    return `content changed (${localLines} line${localLines !== 1 ? "s" : ""})`;
  }
  return `${remoteLines} line${remoteLines !== 1 ? "s" : ""} → ${localLines} line${localLines !== 1 ? "s" : ""}`;
}

/**
 * Render a colored line-by-line diff for a markdown setting.
 * For non-markdown settings this is a no-op (returns false).
 *
 * @param indent  Leading whitespace for each printed line
 * @returns true if a diff was rendered, false if skipped
 */
export function renderSettingDiffPreview(
  key: string,
  remoteValue: string | null | undefined,
  localValue: string | null | undefined,
  indent: string = "        ",
): boolean {
  if (!isMarkdownSettingKey(key)) return false;

  const oldText = remoteValue || "";
  const newText = localValue || "";
  const diff = Diff.diffLines(oldText, newText);

  let addedLines = 0;
  let removedLines = 0;
  let unchangedLines = 0;
  let previewLines = 0;
  const maxPreviewLines = 8;

  for (const part of diff) {
    const lines = part.value.split("\n").filter((l: string) => l.trim() !== "");

    if (part.added) {
      addedLines += lines.length;
      if (previewLines < maxPreviewLines) {
        for (const line of lines.slice(0, maxPreviewLines - previewLines)) {
          colorConsole.log(`${indent}${diffColors.added(`+ ${line}`)}`);
          previewLines++;
        }
      }
    } else if (part.removed) {
      removedLines += lines.length;
      if (previewLines < maxPreviewLines) {
        for (const line of lines.slice(0, maxPreviewLines - previewLines)) {
          colorConsole.log(`${indent}${diffColors.removed(`- ${line}`)}`);
          previewLines++;
        }
      }
    } else {
      unchangedLines += lines.length;
    }

    if (previewLines >= maxPreviewLines) break;
  }

  const remaining = addedLines + removedLines - previewLines;
  if (remaining > 0) {
    colorConsole.log(`${indent}${colorConsole.gray(`... (${remaining} more change${remaining !== 1 ? "s" : ""})`)}`);
  }

  colorConsole.log(
    `${indent}${colorConsole.green(`+${addedLines}`)} added, ${colorConsole.red(`-${removedLines}`)} removed, ${unchangedLines} unchanged`,
  );

  return true;
}
