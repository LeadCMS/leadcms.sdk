import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import axios, { AxiosResponse } from "axios";
import {
  leadCMSUrl,
  leadCMSApiKey,
  defaultLanguage,
  CONTENT_DIR,
  fetchContentTypes,
  ContentItem,
} from "./leadcms-helpers.js";
import { saveContentFile, transformRemoteToLocalFormat, type ContentTypeMap } from "../lib/content-transformation.js";
import { threeWayMerge, threeWayMergeJson, isLocallyModified } from "../lib/content-merge.js";
import { getConfig } from "../lib/config.js";
import { logger } from "../lib/logger.js";
import type { RemoteContext } from "../lib/remote-context.js";
import { syncTokenPath } from "../lib/remote-context.js";

/**
 * Options for pullLeadCMSContent.
 */
export interface PullContentOptions {
  /**
   * When true, skip three-way merge logic and always overwrite local files
   * with remote content. This is used in watch mode (SSE watcher) to prevent
   * merge conflicts caused by rapid sequential/concurrent syncs.
   */
  forceOverwrite?: boolean;
  /**
   * Remote context for multi-remote support. When provided, sync tokens and
   * API calls use this remote's URL and per-remote state directory.
   * When omitted, falls back to single-remote behavior (backward compat).
   */
  remoteContext?: RemoteContext;
}

// Type definitions
interface SyncResponse {
  items?: ContentItem[];
  deleted?: number[];
  baseItems?: Record<string, ContentItem>;
  nextSyncToken?: string;
}

interface ContentSyncResult {
  items: ContentItem[];
  deleted: number[];
  baseItems: Record<string, ContentItem>;
  nextSyncToken: string;
}

const CONTENT_PROGRESS_LOG_INTERVAL = 25;

// ── Sync token paths ───────────────────────────────────────────────────
// New location: tokens live *inside* the corresponding data directory.
const SYNC_TOKEN_PATH = path.join(CONTENT_DIR, ".sync-token");

// Legacy location (SDK ≤ 3.2): tokens lived in the parent of contentDir.
// We check these once for migration and then delete them after a successful pull.
const LEGACY_SYNC_TOKEN_PATH = path.join(path.dirname(CONTENT_DIR), "sync-token.txt");

/**
 * Read a file and return its trimmed contents, or undefined if it doesn't exist.
 */
async function readFileOrUndefined(filePath: string): Promise<string | undefined> {
  try {
    return (await fs.readFile(filePath, "utf8")).trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Silently delete a file (no-op if missing).
 */
async function unlinkSafe(filePath: string): Promise<void> {
  try {
    await fs.unlink(filePath);
  } catch { /* not found — ok */ }
}

/**
 * Read content sync token. Checks new location first, then falls back to legacy.
 * When remoteCtx is provided, reads from the remote-specific state directory.
 */
async function readSyncToken(remoteCtx?: RemoteContext): Promise<{ token: string | undefined; migrated: boolean }> {
  if (remoteCtx) {
    const tokenPath = syncTokenPath(remoteCtx, "content");
    const token = await readFileOrUndefined(tokenPath);
    if (token) return { token, migrated: false };

    // Migration: check old single-remote path and move to per-remote path
    const legacyToken = await readFileOrUndefined(SYNC_TOKEN_PATH);
    if (legacyToken) {
      logger.verbose(`[SYNC] Migrating content sync token to remote "${remoteCtx.name}"`);
      return { token: legacyToken, migrated: true };
    }
    return { token: undefined, migrated: false };
  }

  const token = await readFileOrUndefined(SYNC_TOKEN_PATH);
  if (token) return { token, migrated: false };

  const legacy = await readFileOrUndefined(LEGACY_SYNC_TOKEN_PATH);
  if (legacy) {
    logger.verbose(`[SYNC] Migrating content sync token from legacy location`);
    return { token: legacy, migrated: true };
  }
  return { token: undefined, migrated: false };
}

async function writeSyncToken(token: string, remoteCtx?: RemoteContext): Promise<void> {
  if (remoteCtx) {
    const tokenPath = syncTokenPath(remoteCtx, "content");
    await fs.mkdir(path.dirname(tokenPath), { recursive: true });
    await fs.writeFile(tokenPath, token, "utf8");
    return;
  }
  await fs.mkdir(path.dirname(SYNC_TOKEN_PATH), { recursive: true });
  await fs.writeFile(SYNC_TOKEN_PATH, token, "utf8");
}

/**
 * Clean up legacy content sync token after successful migration.
 */
async function cleanupLegacySyncToken(): Promise<void> {
  await unlinkSafe(LEGACY_SYNC_TOKEN_PATH);
}

async function pullContentSync(syncToken?: string, baseUrl?: string): Promise<ContentSyncResult> {
  const effectiveUrl = baseUrl || leadCMSUrl;
  logger.verbose(`[PULL_CONTENT_SYNC] Starting with syncToken: ${syncToken || "NONE"}`);
  logger.verbose(`[PULL_CONTENT_SYNC] Pulling public content (no authentication)`);
  let allItems: ContentItem[] = [];
  let allDeleted: number[] = [];
  let allBaseItems: Record<string, ContentItem> = {};
  let token = syncToken || "";
  let nextSyncToken: string | undefined = undefined;
  let page = 0;

  while (true) {
    const url = new URL("/api/content/sync", effectiveUrl);
    url.searchParams.set("filter[limit]", "100");
    url.searchParams.set("syncToken", token);

    // Request base versions for three-way merge when doing incremental sync
    if (syncToken) {
      url.searchParams.set("includeBase", "true");
    }

    logger.verbose(`[PULL_CONTENT_SYNC] Page ${page}, URL: ${url.toString()}`);

    try {
      // SECURITY: Never send API key for read operations
      // Content sync should only return public data
      const res: AxiosResponse<SyncResponse> = await axios.get(url.toString());

      if (res.status === 204) {
        logger.verbose(`[PULL_CONTENT_SYNC] Got 204 No Content - ending sync`);
        break;
      }

      const data = res.data;
      logger.verbose(
        `[PULL_CONTENT_SYNC] Page ${page} - Got ${data.items?.length || 0} items, ${data.deleted?.length || 0} deleted`
      );

      if (data.items && Array.isArray(data.items)) allItems.push(...data.items);

      if (data.deleted && Array.isArray(data.deleted)) {
        allDeleted.push(...data.deleted);
      }

      // Collect base items for three-way merge support
      if (data.baseItems && typeof data.baseItems === 'object') {
        Object.assign(allBaseItems, data.baseItems);
        logger.verbose(`[PULL_CONTENT_SYNC] Page ${page} - Got ${Object.keys(data.baseItems).length} base items for merge`);
      }

      const newSyncToken = res.headers["x-next-sync-token"] || token;
      logger.verbose(`[PULL_CONTENT_SYNC] Next sync token: ${newSyncToken}`);

      if (!newSyncToken || newSyncToken === token) {
        nextSyncToken = newSyncToken || token;
        logger.verbose(`[PULL_CONTENT_SYNC] No new sync token - ending sync`);
        break;
      }

      nextSyncToken = newSyncToken;
      token = newSyncToken;
      page++;
    } catch (error: any) {
      console.error(`[PULL_CONTENT_SYNC] Failed on page ${page}:`, error.message);
      throw error;
    }
  }

  logger.verbose(
    `[PULL_CONTENT_SYNC] Completed - Total items: ${allItems.length}, deleted: ${allDeleted.length}, base items: ${Object.keys(allBaseItems).length}`
  );
  return {
    items: allItems,
    deleted: allDeleted,
    baseItems: allBaseItems,
    nextSyncToken: nextSyncToken || token,
  };
}

/**
 * A map from content ID (as string) to an array of file paths containing that ID.
 */
export type ContentIdIndex = Map<string, string[]>;

/**
 * Build an index mapping content IDs to their local file paths.
 * Walks the directory tree once and parses every content file to extract its ID,
 * so that subsequent lookups are O(1) instead of scanning the filesystem again.
 */
async function buildContentIdIndex(dir: string): Promise<ContentIdIndex> {
  const index: ContentIdIndex = new Map();

  async function walk(currentDir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        console.warn(`Warning: Could not read directory ${currentDir}:`, err.message);
      }
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        try {
          const content = await fs.readFile(fullPath, "utf8");
          const id = extractContentId(content);
          if (id !== undefined) {
            const existing = index.get(id);
            if (existing) {
              existing.push(fullPath);
            } else {
              index.set(id, [fullPath]);
            }
          }
        } catch { /* skip unreadable files */ }
      }
    }
  }

  await walk(dir);
  return index;
}

/**
 * Extract the content ID from a file's text content.
 * Supports both YAML frontmatter (`id: 42`) and JSON (`"id": 42`) formats.
 * Returns the ID as a string, or undefined if not found.
 */
function extractContentId(content: string): string | undefined {
  // YAML frontmatter: id: 42 or id: '42'
  const yamlMatch = content.match(/(?:^|\n)id:\s*['"]?(\d+)['"]?(?:\n|$)/);
  if (yamlMatch) return yamlMatch[1];

  // JSON: "id": 42 or "id": "42"
  const jsonMatch = content.match(/"id"\s*:\s*['"]?(\d+)['"]?/);
  if (jsonMatch) return jsonMatch[1];

  return undefined;
}

/**
 * Delete all files associated with a given content ID using a pre-built index.
 * Also removes the entry from the index so subsequent calls stay consistent.
 */
async function deleteContentFilesById(index: ContentIdIndex, idStr: string): Promise<void> {
  const paths = index.get(idStr);
  if (!paths || paths.length === 0) return;

  for (const filePath of paths) {
    try {
      await fs.unlink(filePath);
      logger.verbose(`Deleted: ${filePath}`);
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        console.warn(`Warning: Could not delete ${filePath}:`, err.message);
      }
    }
  }
  index.delete(idStr);
}

/**
 * Recursively search for content files with a given ID and delete them.
 * Used during sync to remove locally-cached content that was deleted remotely.
 *
 * Note: For batch operations prefer buildContentIdIndex() + deleteContentFilesById()
 * to avoid repeated filesystem walks.
 */
async function findAndDeleteContentFile(dir: string, idStr: string): Promise<void> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await findAndDeleteContentFile(fullPath, idStr);
      } else if (entry.isFile()) {
        try {
          const content = await fs.readFile(fullPath, "utf8");
          // Exact-match YAML frontmatter: lines like `id: 10` or `id: '10'`
          const yamlRegex = new RegExp(`(^|\\n)id:\\s*['\"]?${idStr}['\"]?(\\n|$)`);
          // Exact-match JSON: "id": 10 or "id": "10"
          const jsonRegex = new RegExp(`\\"id\\"\\s*:\\s*['\"]?${idStr}['\"]?\\s*(,|\\}|\\n|$)`);
          if (yamlRegex.test(content) || jsonRegex.test(content)) {
            await fs.unlink(fullPath);
            logger.verbose(`Deleted: ${fullPath}`);
          }
        } catch { }
      }
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      console.warn(`Warning: Could not read directory ${dir}:`, err.message);
    }
  }
}

async function main(options: PullContentOptions = {}): Promise<void> {
  const { forceOverwrite = false, remoteContext: remoteCtx } = options;
  const effectiveUrl = remoteCtx?.url || leadCMSUrl;

  // Log environment configuration for debugging
  logger.verbose(`[ENV] LeadCMS URL: ${effectiveUrl}`);
  if (remoteCtx) {
    logger.verbose(`[ENV] Remote: ${remoteCtx.name}`);
  }
  logger.verbose(`[ENV] Default Language: ${defaultLanguage}`);
  logger.verbose(`[ENV] Content Dir: ${CONTENT_DIR}`);

  await fs.mkdir(CONTENT_DIR, { recursive: true });

  const typeMap = await fetchContentTypes(effectiveUrl);

  const { token: lastSyncToken, migrated: contentTokenMigrated } = await readSyncToken(remoteCtx);

  let items: ContentItem[] = [],
    deleted: number[] = [],
    baseItems: Record<string, ContentItem> = {},
    nextSyncToken: string = "";

  try {
    if (lastSyncToken) {
      logger.verbose(`Syncing content from LeadCMS using sync token: ${lastSyncToken}`);
      ({ items, deleted, baseItems, nextSyncToken } = await pullContentSync(lastSyncToken, effectiveUrl));
    } else {
      logger.verbose("No content sync token found. Doing full pull from LeadCMS...");
      ({ items, deleted, baseItems, nextSyncToken } = await pullContentSync(undefined, effectiveUrl));
    }
  } catch (error: any) {
    console.error(`[MAIN] Failed to pull content:`, error.message);
    if (error.response?.status === 401) {
      console.error(`[MAIN] Authentication failed - check your LEADCMS_API_KEY`);
    }
    throw error;
  }

  logger.verbose(`Pulled ${items.length} content items, ${deleted.length} deleted.\x1b[0m`);

  // Build an ID→filepath index once instead of walking the tree per item.
  // This turns O(items × files) disk reads into O(files + items).
  const contentIdIndex = (items.length > 0 || deleted.length > 0)
    ? await buildContentIdIndex(CONTENT_DIR)
    : new Map<string, string[]>();

  // Save content files (with three-way merge support)
  const hasBaseItems = Object.keys(baseItems).length > 0;
  let mergedCount = 0;
  let conflictCount = 0;
  let overwrittenCount = 0;
  let newCount = 0;

  // Build a ContentTypeMap for transformation
  const contentTypeMap: ContentTypeMap = {};
  for (const [key, value] of Object.entries(typeMap)) {
    contentTypeMap[key] = value === 'JSON' ? 'JSON' : 'MDX';
  }

  console.log(`📄 Processing content sync (${items.length} updates, ${deleted.length} deletions)...`);

  // Load per-remote metadata for multi-remote support
  let metadataMap: import('../lib/remote-context.js').MetadataMap | undefined;
  const rcModule = remoteCtx ? await import('../lib/remote-context.js') : undefined;
  if (remoteCtx && rcModule) {
    metadataMap = await rcModule.readMetadataMap(remoteCtx);
  }

  // Load defaultRemote's maps so frontmatter always reflects the default
  // remote's ids and timestamps, even when pulling from another remote.
  let defaultMetadataMap: import('../lib/remote-context.js').MetadataMap | undefined;
  if (remoteCtx && !remoteCtx.isDefault && rcModule) {
    const cfg = getConfig();
    if (cfg.defaultRemote) {
      const defaultCtx = rcModule.resolveRemote(cfg.defaultRemote, cfg);
      defaultMetadataMap = await rcModule.readMetadataMap(defaultCtx);
    }
  }

  let processedContent = 0;

  for (const content of items) {
    if (content && typeof content === "object") {
      const idStr = content.id != null ? String(content.id) : undefined;

      // Update per-remote metadata with this content item's data
      if (remoteCtx && rcModule && metadataMap && content.slug && content.language) {
        if (content.id != null) {
          rcModule.setRemoteId(metadataMap, content.language || defaultLanguage, content.slug, content.id);
        }
        rcModule.setMetadataForContent(metadataMap, content.language || defaultLanguage, content.slug, {
          createdAt: content.createdAt,
          updatedAt: content.updatedAt,
        });
      }

      // For non-default remotes, replace server-generated fields with the
      // defaultRemote's values so frontmatter always reflects prod ids/dates.
      // The current remote's values are already stored in its per-remote maps.
      let contentToSave = content;
      if (remoteCtx && !remoteCtx.isDefault) {
        const { id, createdAt, updatedAt, ...rest } = content;
        const lang = content.language || defaultLanguage;
        const defaultId = defaultMetadataMap?.content[lang]?.[content.slug]?.id;
        const defaultMeta = defaultMetadataMap?.content[lang]?.[content.slug];
        contentToSave = {
          ...(defaultId != null ? { id: defaultId } : {}),
          ...(defaultMeta?.createdAt ? { createdAt: defaultMeta.createdAt } : {}),
          ...(defaultMeta?.updatedAt ? { updatedAt: defaultMeta.updatedAt } : {}),
          ...rest,
        } as ContentItem;
      }

      // Determine the file path where this content would be saved
      const contentConfig = getConfig();
      const contentLanguage = content.language || contentConfig.defaultLanguage;
      let targetContentDir = CONTENT_DIR;
      if (contentLanguage !== contentConfig.defaultLanguage) {
        targetContentDir = path.join(CONTENT_DIR, contentLanguage);
      }
      const contentType = contentTypeMap[content.type] || 'MDX';
      const extension = contentType === 'MDX' ? '.mdx' : '.json';
      const expectedPath = path.join(targetContentDir, `${content.slug}${extension}`);

      // Check if local file exists before deleting old paths
      let localContent: string | null = null;
      try {
        localContent = await fs.readFile(expectedPath, 'utf8');
      } catch {
        // File does not exist — this is new content
      }

      // Before saving, remove any existing file with the same id.
      // This handles slug renames, type changes (MDX↔JSON), and language
      // changes — the old file at the previous path is cleaned up before the
      // new version is written at the (potentially different) new path.
      if (idStr != null) {
        await deleteContentFilesById(contentIdIndex, idStr);
      }

      // Try three-way merge if we have a base version and local file exists
      // In forceOverwrite mode (watch/SSE), skip merge entirely to avoid conflicts
      const baseContent = idStr ? baseItems[idStr] : undefined;

      if (!forceOverwrite && localContent && baseContent && hasBaseItems) {
        // Transform both base and remote to local file format for comparison.
        // Use contentToSave (which may have id/timestamps stripped for non-default remotes)
        // so the merge result matches what will actually be written.
        const baseTransformed = await transformRemoteToLocalFormat(baseContent, contentTypeMap);
        const remoteTransformed = await transformRemoteToLocalFormat(contentToSave, contentTypeMap);

        if (!isLocallyModified(baseTransformed, localContent)) {
          // Local file is unchanged from base — safe to overwrite with remote
          await saveContentFile({ content: contentToSave, typeMap, contentDir: CONTENT_DIR });
          overwrittenCount++;
        } else {
          // Local file was modified — perform three-way merge
          // Use structural merge for JSON (avoids false conflicts from adjacent lines)
          // and line-based merge for MDX
          const mergeResult = contentType === 'JSON'
            ? threeWayMergeJson(baseTransformed, localContent, remoteTransformed)
            : threeWayMerge(baseTransformed, localContent, remoteTransformed);

          if (mergeResult.success) {
            // Clean merge — write the merged result
            await fs.mkdir(path.dirname(expectedPath), { recursive: true });
            await fs.writeFile(expectedPath, mergeResult.merged, 'utf8');
            console.log(`🔀 Auto-merged: ${content.slug} (local + remote changes combined)`);
            mergedCount++;
          } else {
            // Conflicts — write merged content with conflict markers
            await fs.mkdir(path.dirname(expectedPath), { recursive: true });
            await fs.writeFile(expectedPath, mergeResult.merged, 'utf8');
            console.warn(`⚠️  Conflict in: ${content.slug} (${mergeResult.conflictCount} conflict(s) — manual resolution needed)`);
            conflictCount++;
          }
        }
      } else {
        // No base available, file is new, or forceOverwrite — overwrite with remote
        await saveContentFile({ content: contentToSave, typeMap, contentDir: CONTENT_DIR });
        if (localContent) {
          overwrittenCount++;
        } else {
          newCount++;
        }
      }

      processedContent++;
      if (
        items.length > CONTENT_PROGRESS_LOG_INTERVAL
        && (processedContent % CONTENT_PROGRESS_LOG_INTERVAL === 0 || processedContent === items.length)
      ) {
        console.log(`   📄 Content processed: ${processedContent}/${items.length}`);
      }
    }
  }

  // Print merge summary
  if (hasBaseItems && items.length > 0) {
    console.log(`\n📊 Content sync summary:`);
    if (newCount > 0) console.log(`   ✨ New: ${newCount}`);
    if (overwrittenCount > 0) console.log(`   📝 Updated (no local changes): ${overwrittenCount}`);
    if (mergedCount > 0) console.log(`   🔀 Auto-merged: ${mergedCount}`);
    if (conflictCount > 0) console.log(`   ⚠️  Conflicts (need manual resolution): ${conflictCount}`);
  }

  // Persist per-remote metadata after processing all content items
  if (remoteCtx && rcModule && metadataMap && items.length > 0) {
    await rcModule.writeMetadataMap(remoteCtx, metadataMap);
    logger.verbose(`[PULL] Updated metadata-map for remote "${remoteCtx.name}"`);
  }

  // Remove deleted content files from all language directories
  if (deleted.length > 0) {
    console.log(`🗑️  Removing deleted content files (${deleted.length})...`);
  }
  for (const id of deleted) {
    await deleteContentFilesById(contentIdIndex, String(id));
  }

  if (items.length === 0 && deleted.length === 0) {
    console.log(`No content changes detected.`);
  }

  // Save new sync token
  if (nextSyncToken) {
    await writeSyncToken(nextSyncToken, remoteCtx);
    logger.verbose(`Content sync token updated: ${nextSyncToken}`);
  }

  // Clean up legacy sync token after a successful pull
  if (contentTokenMigrated) {
    await cleanupLegacySyncToken();
    logger.verbose(`[SYNC] Removed legacy content sync token`);
    // Also clean up old single-remote path when migrating to multi-remote
    if (remoteCtx) {
      await unlinkSafe(SYNC_TOKEN_PATH);
    }
  }
}

// Export the main function so it can be imported by other modules
export { main as pullLeadCMSContent };

// Export internal functions for testing
export { findAndDeleteContentFile };
export { buildContentIdIndex, deleteContentFilesById, extractContentId };

// Note: CLI execution moved to CLI entry points
// This file now only exports the function for programmatic use

// Export types
export type { ContentSyncResult };
