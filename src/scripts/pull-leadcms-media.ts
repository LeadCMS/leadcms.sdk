import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import axios, { AxiosResponse } from "axios";
import {
  downloadMediaFileDirect,
  leadCMSUrl,
  leadCMSApiKey,
  MEDIA_DIR,
} from "./leadcms-helpers.js";
import { logger } from "../lib/logger.js";
import type { RemoteContext } from "../lib/remote-context.js";
import { syncTokenPath } from "../lib/remote-context.js";

/**
 * Options for pullLeadCMSMedia.
 */
export interface PullMediaOptions {
  /**
   * Remote context for multi-remote support. When provided, sync tokens and
   * API calls use this remote's URL and per-remote state directory.
   * When omitted, falls back to single-remote behavior (backward compat).
   */
  remoteContext?: RemoteContext;
}

// Type definitions
export interface MediaItem {
  location?: string;
  [key: string]: any;
}

export interface MediaDeletedItem {
  scopeUid: string;
  name: string;
}

interface MediaSyncResponse {
  items?: MediaItem[];
  deleted?: MediaDeletedItem[];
  nextSyncToken?: string;
}

export interface MediaSyncResult {
  items: MediaItem[];
  deleted: MediaDeletedItem[];
  nextSyncToken: string;
}

const MEDIA_PROGRESS_LOG_INTERVAL = 5;

// ── Sync token paths ───────────────────────────────────────────────────
const MEDIA_SYNC_TOKEN_PATH = path.join(MEDIA_DIR, ".sync-token");

// Legacy location (SDK ≤ 3.2): tokens lived in the parent of mediaDir.
const LEGACY_MEDIA_SYNC_TOKEN_PATH = path.join(path.dirname(MEDIA_DIR), "media-sync-token.txt");

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
 * Read media sync token. Checks new location first, then falls back to legacy.
 * When remoteCtx is provided, reads from the remote-specific state directory.
 */
async function readMediaSyncToken(remoteCtx?: RemoteContext): Promise<{ token: string | undefined; migrated: boolean }> {
  if (remoteCtx) {
    const tokenPath = syncTokenPath(remoteCtx, "media");
    const token = await readFileOrUndefined(tokenPath);
    if (token) return { token, migrated: false };

    // Migration: check old single-remote path
    const legacyToken = await readFileOrUndefined(MEDIA_SYNC_TOKEN_PATH);
    if (legacyToken) {
      logger.verbose(`[SYNC] Migrating media sync token to remote "${remoteCtx.name}"`);
      return { token: legacyToken, migrated: true };
    }
    return { token: undefined, migrated: false };
  }

  const token = await readFileOrUndefined(MEDIA_SYNC_TOKEN_PATH);
  if (token) return { token, migrated: false };

  const legacy = await readFileOrUndefined(LEGACY_MEDIA_SYNC_TOKEN_PATH);
  if (legacy) {
    logger.verbose(`[SYNC] Migrating media sync token from legacy location`);
    return { token: legacy, migrated: true };
  }
  return { token: undefined, migrated: false };
}

async function writeMediaSyncToken(token: string, remoteCtx?: RemoteContext): Promise<void> {
  if (remoteCtx) {
    const tokenPath = syncTokenPath(remoteCtx, "media");
    await fs.mkdir(path.dirname(tokenPath), { recursive: true });
    await fs.writeFile(tokenPath, token, "utf8");
    return;
  }
  await fs.mkdir(path.dirname(MEDIA_SYNC_TOKEN_PATH), { recursive: true });
  await fs.writeFile(MEDIA_SYNC_TOKEN_PATH, token, "utf8");
}

/**
 * Clean up legacy media sync token after successful migration.
 */
async function cleanupLegacyMediaSyncToken(): Promise<void> {
  await unlinkSafe(LEGACY_MEDIA_SYNC_TOKEN_PATH);
}

async function pullMediaSync(syncToken?: string, baseUrl?: string): Promise<MediaSyncResult> {
  const effectiveUrl = baseUrl || leadCMSUrl;
  logger.verbose(`[PULL_MEDIA_SYNC] Starting with syncToken: ${syncToken || "NONE"}`);
  logger.verbose(`[PULL_MEDIA_SYNC] Pulling public media (no authentication)`);
  let allItems: MediaItem[] = [];
  let allDeleted: MediaDeletedItem[] = [];
  let token = syncToken || "";
  let nextSyncToken: string | undefined = undefined;
  let page = 0;

  while (true) {
    const url = new URL("/api/media/sync", effectiveUrl);
    url.searchParams.set("filter[limit]", "100");
    url.searchParams.set("syncToken", token);

    logger.verbose(`[PULL_MEDIA_SYNC] Page ${page}, URL: ${url.toString()}`);

    try {
      // SECURITY: Never send API key for read operations
      // Media sync should only return public files
      const res: AxiosResponse<MediaSyncResponse> = await axios.get(url.toString());

      if (res.status === 204) {
        logger.verbose(`[PULL_MEDIA_SYNC] Got 204 No Content - ending sync`);
        break;
      }

      const data = res.data;
      logger.verbose(
        `[PULL_MEDIA_SYNC] Page ${page} - Got ${data.items?.length || 0} items, ${data.deleted?.length || 0} deleted`
      );

      if (data.items && Array.isArray(data.items)) allItems.push(...data.items);

      if (data.deleted && Array.isArray(data.deleted)) {
        allDeleted.push(...data.deleted);
      }

      const newSyncToken = res.headers["x-next-sync-token"] || token;
      logger.verbose(`[PULL_MEDIA_SYNC] Next sync token: ${newSyncToken}`);

      if (!newSyncToken || newSyncToken === token) {
        nextSyncToken = newSyncToken || token;
        logger.verbose(`[PULL_MEDIA_SYNC] No new sync token - ending sync`);
        break;
      }

      nextSyncToken = newSyncToken;
      token = newSyncToken;
      page++;
    } catch (error: any) {
      console.error(`[PULL_MEDIA_SYNC] Failed on page ${page}:`, error.message);
      throw error;
    }
  }

  logger.verbose(
    `[PULL_MEDIA_SYNC] Completed - Total items: ${allItems.length}, deleted: ${allDeleted.length}`
  );
  return {
    items: allItems,
    deleted: allDeleted,
    nextSyncToken: nextSyncToken || token,
  };
}

/**
 * Pull and sync media files from LeadCMS.
 */
async function main(options: PullMediaOptions = {}): Promise<void> {
  const { remoteContext: remoteCtx } = options;
  const effectiveUrl = remoteCtx?.url || leadCMSUrl;
  const effectiveApiKey = remoteCtx?.apiKey || leadCMSApiKey;

  logger.verbose(`[PULL_MEDIA] LeadCMS URL: ${effectiveUrl}`);
  logger.verbose(`[PULL_MEDIA] Media Dir: ${MEDIA_DIR}`);
  if (remoteCtx) {
    logger.verbose(`[PULL_MEDIA] Remote: ${remoteCtx.name}`);
  }

  await fs.mkdir(MEDIA_DIR, { recursive: true });

  const { token: lastMediaSyncToken, migrated: mediaTokenMigrated } = await readMediaSyncToken(remoteCtx);

  let mediaItems: MediaItem[] = [];
  let mediaDeleted: MediaDeletedItem[] = [];
  let nextMediaSyncToken: string = "";

  try {
    if (lastMediaSyncToken) {
      logger.verbose(`Syncing media from LeadCMS using sync token: ${lastMediaSyncToken}`);
      ({ items: mediaItems, deleted: mediaDeleted, nextSyncToken: nextMediaSyncToken } = await pullMediaSync(lastMediaSyncToken, effectiveUrl));
    } else {
      logger.verbose("No media sync token found. Doing full pull from LeadCMS...");
      ({ items: mediaItems, deleted: mediaDeleted, nextSyncToken: nextMediaSyncToken } = await pullMediaSync(undefined, effectiveUrl));
    }
  } catch (error: any) {
    console.error(`[PULL_MEDIA] Failed to pull media:`, error.message);
    if (error.response?.status === 401) {
      console.error(`[PULL_MEDIA] Authentication failed - check your LEADCMS_API_KEY`);
    }
    throw error;
  }

  logger.verbose(`Pulled ${mediaItems.length} media items, ${mediaDeleted.length} deleted.\x1b[0m`);

  // Download new/updated media files
  console.log(`🖼️  Processing media sync (${mediaItems.length} downloads, ${mediaDeleted.length} deletions)...`);
  if (mediaItems.length > 0) {
    logger.verbose(`\nProcessing media changes...`);

    let downloaded = 0;
    let attemptedDownloads = 0;
    for (const mediaItem of mediaItems) {
      if (mediaItem.location) {
        attemptedDownloads++;
        if (
          attemptedDownloads === 1
          || attemptedDownloads % MEDIA_PROGRESS_LOG_INTERVAL === 0
          || attemptedDownloads === mediaItems.length
        ) {
          console.log(`   ⬇️  Media download progress: ${attemptedDownloads}/${mediaItems.length}`);
        }

        const relPath = mediaItem.location.replace(/^\/api\/media\//, "");
        const destPath = path.join(MEDIA_DIR, relPath);
        const didDownload = await downloadMediaFileDirect(mediaItem.location, destPath, effectiveUrl || "", effectiveApiKey || "");
        if (didDownload) {
          logger.verbose(`Downloaded: ${mediaItem.location} -> ${destPath}`);
          downloaded++;
        }
      }
    }
    console.log(`Done. ${downloaded} media files downloaded.`);
  } else if (mediaDeleted.length === 0) {
    console.log(`No media changes detected.`);
  }

  // Remove deleted media files from local filesystem
  if (mediaDeleted.length > 0) {
    console.log(`Removing ${mediaDeleted.length} deleted media files...`);
    let removedCount = 0;
    for (const deletedMedia of mediaDeleted) {
      const relPath = deletedMedia.scopeUid
        ? path.join(deletedMedia.scopeUid, deletedMedia.name)
        : deletedMedia.name;
      const fullPath = path.join(MEDIA_DIR, relPath);
      try {
        await fs.unlink(fullPath);
        console.log(`   🗑️  ${relPath} (deleted on remote)`);
        removedCount++;
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          console.warn(`Warning: Could not delete media file ${fullPath}:`, err.message);
        }
      }
    }
    console.log(`Done. ${removedCount} media files removed.`);
  }

  // Save sync token
  if (nextMediaSyncToken) {
    await writeMediaSyncToken(nextMediaSyncToken, remoteCtx);
    logger.verbose(`Media sync token updated: ${nextMediaSyncToken}`);
  }

  // Clean up legacy sync token after successful migration
  if (mediaTokenMigrated) {
    await cleanupLegacyMediaSyncToken();
    logger.verbose(`[SYNC] Removed legacy media sync token`);
    if (remoteCtx) {
      await unlinkSafe(MEDIA_SYNC_TOKEN_PATH);
    }
  }
}

export { main as pullLeadCMSMedia };
