import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import axios, { AxiosResponse } from "axios";
import {
  downloadMediaFileDirect,
  leadCMSUrl,
  leadCMSApiKey,
  defaultLanguage,
  CONTENT_DIR,
  MEDIA_DIR,
  fetchContentTypes,
  ContentItem,
} from "./leadcms-helpers.js";
import { saveContentFile, transformRemoteToLocalFormat, type ContentTypeMap } from "../lib/content-transformation.js";
import { threeWayMerge, threeWayMergeJson, isLocallyModified } from "../lib/content-merge.js";
import { getConfig } from "../lib/config.js";
import { logger } from "../lib/logger.js";

/**
 * Options for fetchLeadCMSContent.
 */
export interface FetchContentOptions {
  /**
   * When true, skip three-way merge logic and always overwrite local files
   * with remote content. This is used in watch mode (SSE watcher) to prevent
   * merge conflicts caused by rapid sequential/concurrent syncs.
   */
  forceOverwrite?: boolean;
}

// Type definitions
interface SyncResponse {
  items?: ContentItem[];
  deleted?: number[];
  baseItems?: Record<string, ContentItem>;
  nextSyncToken?: string;
}

interface MediaItem {
  location?: string;
  [key: string]: any;
}

interface MediaDeletedItem {
  scopeUid: string;
  name: string;
}

interface MediaSyncResponse {
  items?: MediaItem[];
  deleted?: MediaDeletedItem[];
  nextSyncToken?: string;
}

interface ContentSyncResult {
  items: ContentItem[];
  deleted: number[];
  baseItems: Record<string, ContentItem>;
  nextSyncToken: string;
}

interface MediaSyncResult {
  items: MediaItem[];
  deleted: MediaDeletedItem[];
  nextSyncToken: string;
}

// Add axios request/response interceptors for debugging
axios.interceptors.request.use(
  (config) => {
    logger.verbose(`[AXIOS REQUEST] ${config.method?.toUpperCase()} ${config.url}`);

    // Mask the Authorization header for security
    const maskedHeaders = { ...config.headers };
    if (maskedHeaders.Authorization && typeof maskedHeaders.Authorization === "string") {
      const authParts = maskedHeaders.Authorization.split(" ");
      if (authParts.length === 2 && authParts[0] === "Bearer") {
        maskedHeaders.Authorization = `Bearer ${authParts[1].substring(0, 8)}...`;
      }
    }

    return config;
  },
  (error) => {
    console.error(`[AXIOS REQUEST ERROR]`, error);
    return Promise.reject(error);
  }
);

axios.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    console.error(
      `[AXIOS RESPONSE ERROR] ${error.response?.status || "NO_STATUS"} ${error.response?.statusText || "NO_STATUS_TEXT"} for ${error.config?.url || "NO_URL"}`
    );
    if (error.response) {
      console.error(`[AXIOS RESPONSE ERROR] Response data:`, error.response.data);
      console.error(
        `[AXIOS RESPONSE ERROR] Response headers:`,
        JSON.stringify(error.response.headers, null, 2)
      );
    }
    console.error(`[AXIOS RESPONSE ERROR] Full error:`, error.message);
    return Promise.reject(error);
  }
);

// ── Sync token paths ───────────────────────────────────────────────────
// New location: tokens live *inside* the corresponding data directory.
const SYNC_TOKEN_PATH = path.join(CONTENT_DIR, ".sync-token");
const MEDIA_SYNC_TOKEN_PATH = path.join(MEDIA_DIR, ".sync-token");

// Legacy location (SDK ≤ 3.2): tokens lived in the parent of contentDir.
// We check these once for migration and then delete them after a successful pull.
const LEGACY_SYNC_TOKEN_PATH = path.join(path.dirname(CONTENT_DIR), "sync-token.txt");
const LEGACY_MEDIA_SYNC_TOKEN_PATH = path.join(path.dirname(CONTENT_DIR), "media-sync-token.txt");

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
 */
async function readSyncToken(): Promise<{ token: string | undefined; migrated: boolean }> {
  const token = await readFileOrUndefined(SYNC_TOKEN_PATH);
  if (token) return { token, migrated: false };

  const legacy = await readFileOrUndefined(LEGACY_SYNC_TOKEN_PATH);
  if (legacy) {
    logger.verbose(`[SYNC] Migrating content sync token from legacy location`);
    return { token: legacy, migrated: true };
  }
  return { token: undefined, migrated: false };
}

async function writeSyncToken(token: string): Promise<void> {
  await fs.mkdir(path.dirname(SYNC_TOKEN_PATH), { recursive: true });
  await fs.writeFile(SYNC_TOKEN_PATH, token, "utf8");
}

/**
 * Clean up legacy content sync token after successful migration.
 */
async function cleanupLegacySyncToken(): Promise<void> {
  await unlinkSafe(LEGACY_SYNC_TOKEN_PATH);
}

/**
 * Read media sync token. Checks new location first, then falls back to legacy.
 */
async function readMediaSyncToken(): Promise<{ token: string | undefined; migrated: boolean }> {
  const token = await readFileOrUndefined(MEDIA_SYNC_TOKEN_PATH);
  if (token) return { token, migrated: false };

  const legacy = await readFileOrUndefined(LEGACY_MEDIA_SYNC_TOKEN_PATH);
  if (legacy) {
    logger.verbose(`[SYNC] Migrating media sync token from legacy location`);
    return { token: legacy, migrated: true };
  }
  return { token: undefined, migrated: false };
}

async function writeMediaSyncToken(token: string): Promise<void> {
  await fs.mkdir(path.dirname(MEDIA_SYNC_TOKEN_PATH), { recursive: true });
  await fs.writeFile(MEDIA_SYNC_TOKEN_PATH, token, "utf8");
}

/**
 * Clean up legacy media sync token after successful migration.
 */
async function cleanupLegacyMediaSyncToken(): Promise<void> {
  await unlinkSafe(LEGACY_MEDIA_SYNC_TOKEN_PATH);
}

async function fetchContentSync(syncToken?: string): Promise<ContentSyncResult> {
  logger.verbose(`[FETCH_CONTENT_SYNC] Starting with syncToken: ${syncToken || "NONE"}`);
  logger.verbose(`[FETCH_CONTENT_SYNC] Fetching public content (no authentication)`);
  let allItems: ContentItem[] = [];
  let allDeleted: number[] = [];
  let allBaseItems: Record<string, ContentItem> = {};
  let token = syncToken || "";
  let nextSyncToken: string | undefined = undefined;
  let page = 0;

  while (true) {
    const url = new URL("/api/content/sync", leadCMSUrl);
    url.searchParams.set("filter[limit]", "100");
    url.searchParams.set("syncToken", token);

    // Request base versions for three-way merge when doing incremental sync
    if (syncToken) {
      url.searchParams.set("includeBase", "true");
    }

    logger.verbose(`[FETCH_CONTENT_SYNC] Page ${page}, URL: ${url.toString()}`);

    try {
      // SECURITY: Never send API key for read operations
      // Content sync should only return public data
      const res: AxiosResponse<SyncResponse> = await axios.get(url.toString());

      if (res.status === 204) {
        logger.verbose(`[FETCH_CONTENT_SYNC] Got 204 No Content - ending sync`);
        break;
      }

      const data = res.data;
      logger.verbose(
        `[FETCH_CONTENT_SYNC] Page ${page} - Got ${data.items?.length || 0} items, ${data.deleted?.length || 0} deleted`
      );

      if (data.items && Array.isArray(data.items)) allItems.push(...data.items);

      if (data.deleted && Array.isArray(data.deleted)) {
        allDeleted.push(...data.deleted);
      }

      // Collect base items for three-way merge support
      if (data.baseItems && typeof data.baseItems === 'object') {
        Object.assign(allBaseItems, data.baseItems);
        logger.verbose(`[FETCH_CONTENT_SYNC] Page ${page} - Got ${Object.keys(data.baseItems).length} base items for merge`);
      }

      const newSyncToken = res.headers["x-next-sync-token"] || token;
      logger.verbose(`[FETCH_CONTENT_SYNC] Next sync token: ${newSyncToken}`);

      if (!newSyncToken || newSyncToken === token) {
        nextSyncToken = newSyncToken || token;
        logger.verbose(`[FETCH_CONTENT_SYNC] No new sync token - ending sync`);
        break;
      }

      nextSyncToken = newSyncToken;
      token = newSyncToken;
      page++;
    } catch (error: any) {
      console.error(`[FETCH_CONTENT_SYNC] Failed on page ${page}:`, error.message);
      throw error;
    }
  }

  logger.verbose(
    `[FETCH_CONTENT_SYNC] Completed - Total items: ${allItems.length}, deleted: ${allDeleted.length}, base items: ${Object.keys(allBaseItems).length}`
  );
  return {
    items: allItems,
    deleted: allDeleted,
    baseItems: allBaseItems,
    nextSyncToken: nextSyncToken || token,
  };
}

async function fetchMediaSync(syncToken?: string): Promise<MediaSyncResult> {
  logger.verbose(`[FETCH_MEDIA_SYNC] Starting with syncToken: ${syncToken || "NONE"}`);
  logger.verbose(`[FETCH_MEDIA_SYNC] Fetching public media (no authentication)`);
  let allItems: MediaItem[] = [];
  let allDeleted: MediaDeletedItem[] = [];
  let token = syncToken || "";
  let nextSyncToken: string | undefined = undefined;
  let page = 0;

  while (true) {
    const url = new URL("/api/media/sync", leadCMSUrl);
    url.searchParams.set("filter[limit]", "100");
    url.searchParams.set("syncToken", token);

    logger.verbose(`[FETCH_MEDIA_SYNC] Page ${page}, URL: ${url.toString()}`);

    try {
      // SECURITY: Never send API key for read operations
      // Media sync should only return public files
      const res: AxiosResponse<MediaSyncResponse> = await axios.get(url.toString());

      if (res.status === 204) {
        logger.verbose(`[FETCH_MEDIA_SYNC] Got 204 No Content - ending sync`);
        break;
      }

      const data = res.data;
      logger.verbose(
        `[FETCH_MEDIA_SYNC] Page ${page} - Got ${data.items?.length || 0} items, ${data.deleted?.length || 0} deleted`
      );

      if (data.items && Array.isArray(data.items)) allItems.push(...data.items);

      if (data.deleted && Array.isArray(data.deleted)) {
        allDeleted.push(...data.deleted);
      }

      const newSyncToken = res.headers["x-next-sync-token"] || token;
      logger.verbose(`[FETCH_MEDIA_SYNC] Next sync token: ${newSyncToken}`);

      if (!newSyncToken || newSyncToken === token) {
        nextSyncToken = newSyncToken || token;
        logger.verbose(`[FETCH_MEDIA_SYNC] No new sync token - ending sync`);
        break;
      }

      nextSyncToken = newSyncToken;
      token = newSyncToken;
      page++;
    } catch (error: any) {
      console.error(`[FETCH_MEDIA_SYNC] Failed on page ${page}:`, error.message);
      throw error;
    }
  }

  logger.verbose(
    `[FETCH_MEDIA_SYNC] Completed - Total items: ${allItems.length}, deleted: ${allDeleted.length}`
  );
  return {
    items: allItems,
    deleted: allDeleted,
    nextSyncToken: nextSyncToken || token,
  };
}

/**
 * Fetch CMS config to check supported entities
 */
async function fetchCMSConfigForEntities(): Promise<{ content: boolean; media: boolean }> {
  try {
    const { setCMSConfig, isContentSupported, isMediaSupported } = await import('../lib/cms-config-types.js');

    const configUrl = new URL('/api/config', leadCMSUrl).toString();
    const response = await axios.get(configUrl, { timeout: 10000 });

    if (response.data) {
      setCMSConfig(response.data);
      return {
        content: isContentSupported(),
        media: isMediaSupported()
      };
    }
  } catch (error: any) {
    console.warn(`[FETCH_CONTENT_SYNC] Could not fetch CMS config: ${error.message}`);
    console.warn(`[FETCH_CONTENT_SYNC] Assuming content and media are supported (backward compatibility)`);
  }
  return { content: false, media: false };
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

async function main(options: FetchContentOptions = {}): Promise<void> {
  const { forceOverwrite = false } = options;

  // Log environment configuration for debugging
  logger.verbose(`[ENV] LeadCMS URL: ${leadCMSUrl}`);
  logger.verbose(
    `[ENV] LeadCMS API Key: ${leadCMSApiKey ? `${leadCMSApiKey.substring(0, 8)}...` : "NOT_SET"}`
  );
  logger.verbose(`[ENV] Default Language: ${defaultLanguage}`);
  logger.verbose(`[ENV] Content Dir: ${CONTENT_DIR}`);
  logger.verbose(`[ENV] Media Dir: ${MEDIA_DIR}`);

  // Check supported entities
  logger.verbose(`\n🔍 Checking CMS configuration...`);
  const { content: contentSupported, media: mediaSupported } = await fetchCMSConfigForEntities();

  if (!contentSupported && !mediaSupported) {
    logger.verbose(`⏭️  Neither Content nor Media entities are supported by this LeadCMS instance - skipping sync`);
    return;
  }

  if (!contentSupported) {
    logger.verbose(`⏭️  Content entity not supported - skipping content sync`);
  }

  if (!mediaSupported) {
    logger.verbose(`⏭️  Media entity not supported - skipping media sync`);
  }

  logger.verbose(`✅ Proceeding with sync\n`);

  // Only create directories for supported entity types
  if (contentSupported) {
    await fs.mkdir(CONTENT_DIR, { recursive: true });
  }

  if (mediaSupported) {
    await fs.mkdir(MEDIA_DIR, { recursive: true });
  }

  const typeMap = await fetchContentTypes();

  const { token: lastSyncToken, migrated: contentTokenMigrated } = await readSyncToken();
  const { token: lastMediaSyncToken, migrated: mediaTokenMigrated } = await readMediaSyncToken();

  let items: ContentItem[] = [],
    deleted: number[] = [],
    baseItems: Record<string, ContentItem> = {},
    nextSyncToken: string = "";

  let mediaItems: MediaItem[] = [],
    mediaDeleted: MediaDeletedItem[] = [],
    nextMediaSyncToken: string = "";

  // Sync content (only if supported)
  if (contentSupported) {
    try {
      if (lastSyncToken) {
        logger.verbose(`Syncing content from LeadCMS using sync token: ${lastSyncToken}`);
        ({ items, deleted, baseItems, nextSyncToken } = await fetchContentSync(lastSyncToken));
      } else {
        logger.verbose("No content sync token found. Doing full fetch from LeadCMS...");
        ({ items, deleted, baseItems, nextSyncToken } = await fetchContentSync(undefined));
      }
    } catch (error: any) {
      console.error(`[MAIN] Failed to fetch content:`, error.message);
      if (error.response?.status === 401) {
        console.error(`[MAIN] Authentication failed - check your LEADCMS_API_KEY`);
      }
      throw error;
    }
  }

  // Sync media (only if supported)
  if (mediaSupported) {
    try {
      if (lastMediaSyncToken) {
        logger.verbose(`Syncing media from LeadCMS using sync token: ${lastMediaSyncToken}`);
        ({ items: mediaItems, deleted: mediaDeleted, nextSyncToken: nextMediaSyncToken } = await fetchMediaSync(lastMediaSyncToken));
      } else {
        logger.verbose("No media sync token found. Doing full fetch from LeadCMS...");
        ({ items: mediaItems, deleted: mediaDeleted, nextSyncToken: nextMediaSyncToken } = await fetchMediaSync(undefined));
      }
    } catch (error: any) {
      console.error(`[MAIN] Failed to fetch media:`, error.message);
      if (error.response?.status === 401) {
        console.error(`[MAIN] Authentication failed - check your LEADCMS_API_KEY`);
      }
      // Don't throw here, continue with content sync even if media sync fails
      console.warn(`[MAIN] Continuing without media sync...`);
    }
  }

  logger.verbose(`Fetched ${items.length} content items, ${deleted.length} deleted.\x1b[0m`);
  logger.verbose(`Fetched ${mediaItems.length} media items, ${mediaDeleted.length} deleted.\x1b[0m`);

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

  for (const content of items) {
    if (content && typeof content === "object") {
      const idStr = content.id != null ? String(content.id) : undefined;

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
        // Transform both base and remote to local file format for comparison
        const baseTransformed = await transformRemoteToLocalFormat(baseContent, contentTypeMap);
        const remoteTransformed = await transformRemoteToLocalFormat(content, contentTypeMap);

        if (!isLocallyModified(baseTransformed, localContent)) {
          // Local file is unchanged from base — safe to overwrite with remote
          await saveContentFile({ content, typeMap, contentDir: CONTENT_DIR });
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
        await saveContentFile({ content, typeMap, contentDir: CONTENT_DIR });
        if (localContent) {
          overwrittenCount++;
        } else {
          newCount++;
        }
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

  // Remove deleted content files from all language directories
  for (const id of deleted) {
    await deleteContentFilesById(contentIdIndex, String(id));
  }

  // Handle media sync results
  if (mediaItems.length > 0) {
    logger.verbose(`\nProcessing media changes...`);

    // Download new/updated media files
    let downloaded = 0;
    for (const mediaItem of mediaItems) {
      if (mediaItem.location) {
        const relPath = mediaItem.location.replace(/^\/api\/media\//, "");
        const destPath = path.join(MEDIA_DIR, relPath);
        const didDownload = await downloadMediaFileDirect(mediaItem.location, destPath, leadCMSUrl || "", leadCMSApiKey || "");
        if (didDownload) {
          logger.verbose(`Downloaded: ${mediaItem.location} -> ${destPath}`);
          downloaded++;
        }
      }
    }
    console.log(`\nDone. ${downloaded} media files downloaded.\n`);
  } else {
    console.log(`\nNo media changes detected.\n`);
  }

  // Remove deleted media files from local filesystem
  if (mediaDeleted.length > 0) {
    console.log(`\nRemoving ${mediaDeleted.length} deleted media files...`);
    let removedCount = 0;
    for (const deletedMedia of mediaDeleted) {
      const relPath = deletedMedia.scopeUid
        ? path.join(deletedMedia.scopeUid, deletedMedia.name)
        : deletedMedia.name;
      const fullPath = path.join(MEDIA_DIR, relPath);
      try {
        await fs.unlink(fullPath);
        logger.verbose(`Deleted media: ${fullPath}`);
        removedCount++;
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          console.warn(`Warning: Could not delete media file ${fullPath}:`, err.message);
        }
      }
    }
    console.log(`Done. ${removedCount} media files removed.\n`);
  }

  // Save new sync tokens
  if (nextSyncToken) {
    await writeSyncToken(nextSyncToken);
    logger.verbose(`Content sync token updated: ${nextSyncToken}`);
  }

  if (nextMediaSyncToken) {
    await writeMediaSyncToken(nextMediaSyncToken);
    logger.verbose(`Media sync token updated: ${nextMediaSyncToken}`);
  }

  // Clean up legacy sync tokens after a successful pull
  if (contentTokenMigrated) {
    await cleanupLegacySyncToken();
    logger.verbose(`[SYNC] Removed legacy content sync token`);
  }
  if (mediaTokenMigrated) {
    await cleanupLegacyMediaSyncToken();
    logger.verbose(`[SYNC] Removed legacy media sync token`);
  }
}

// Export the main function so it can be imported by other modules
export { main as fetchLeadCMSContent };

// Export internal functions for testing
export { findAndDeleteContentFile };
export { buildContentIdIndex, deleteContentFilesById, extractContentId };

// Note: CLI execution moved to CLI entry points
// This file now only exports the function for programmatic use

// Export types
export type { ContentSyncResult, MediaSyncResult, MediaItem, MediaDeletedItem };
