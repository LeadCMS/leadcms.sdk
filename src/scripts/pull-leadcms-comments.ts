import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import axios, { AxiosResponse } from "axios";
import {
  leadCMSUrl,
  leadCMSApiKey,
} from "./leadcms-helpers.js";
import type {
  Comment,
  CommentSyncResponse,
  CommentSyncResult,
  StoredComment,
} from "../lib/comment-types.js";
import { getConfig } from "../lib/config.js";
import { isValidLocaleCode } from "../lib/locale-utils.js";
import { logger } from "../lib/logger.js";
import {
  syncTokenPath,
  type RemoteContext,
  type MetadataMap,
} from "../lib/remote-context.js";

// Load config to get commentsDir
const config = getConfig();
const COMMENTS_DIR = path.resolve(config.commentsDir);

// ── Comment sync token paths ──────────────────────────────────────────
// New location: token lives inside the commentsDir.
const COMMENT_SYNC_TOKEN_PATH = path.join(COMMENTS_DIR, ".sync-token");
// Legacy location (SDK ≤ 3.2): token lived in the parent of commentsDir.
const LEGACY_COMMENT_SYNC_TOKEN_PATH = path.join(path.dirname(COMMENTS_DIR), "comment-sync-token.txt");

/**
 * Read the last comment sync token from disk.
 * Checks new location first, then falls back to legacy for migration.
 * When remoteCtx is provided, reads from the remote-specific state directory.
 */
async function readCommentSyncToken(remoteCtx?: RemoteContext): Promise<{ token: string | undefined; migrated: boolean }> {
  if (remoteCtx) {
    const tokenPath = syncTokenPath(remoteCtx, "comments");
    try {
      const token = (await fs.readFile(tokenPath, "utf8")).trim();
      if (token) return { token, migrated: false };
    } catch { /* not found */ }

    // Migration: check old single-remote path and move to per-remote path
    try {
      const legacyToken = (await fs.readFile(COMMENT_SYNC_TOKEN_PATH, "utf8")).trim();
      if (legacyToken) {
        logger.verbose(`[SYNC] Migrating comment sync token to remote "${remoteCtx.name}"`);
        return { token: legacyToken, migrated: true };
      }
    } catch { /* not found */ }
    return { token: undefined, migrated: false };
  }

  try {
    const token = (await fs.readFile(COMMENT_SYNC_TOKEN_PATH, "utf8")).trim();
    if (token) return { token, migrated: false };
  } catch { /* not found */ }

  try {
    const legacy = (await fs.readFile(LEGACY_COMMENT_SYNC_TOKEN_PATH, "utf8")).trim();
    if (legacy) {
      logger.verbose(`[SYNC] Migrating comment sync token from legacy location`);
      return { token: legacy, migrated: true };
    }
  } catch { /* not found */ }

  return { token: undefined, migrated: false };
}

/**
 * Write the comment sync token to disk.
 * When remoteCtx is provided, writes to the remote-specific state directory.
 */
async function writeCommentSyncToken(token: string, remoteCtx?: RemoteContext): Promise<void> {
  if (remoteCtx) {
    const tokenPath = syncTokenPath(remoteCtx, "comments");
    await fs.mkdir(path.dirname(tokenPath), { recursive: true });
    await fs.writeFile(tokenPath, token, "utf8");
    return;
  }
  await fs.mkdir(path.dirname(COMMENT_SYNC_TOKEN_PATH), { recursive: true });
  await fs.writeFile(COMMENT_SYNC_TOKEN_PATH, token, "utf8");
}

/**
 * Clean up legacy comment sync token after successful migration.
 */
async function cleanupLegacyCommentSyncToken(): Promise<void> {
  try {
    await fs.unlink(LEGACY_COMMENT_SYNC_TOKEN_PATH);
  } catch { /* not found — ok */ }
}

/**
 * Pull comments from LeadCMS sync endpoint
 * Handles pagination automatically
 */
async function pullCommentSync(syncToken?: string): Promise<CommentSyncResult> {
  logger.verbose(`[PULL_COMMENT_SYNC] Starting with syncToken: ${syncToken || "NONE"}`);
  logger.verbose(`[PULL_COMMENT_SYNC] Pulling public comments (no authentication)`);
  let allItems: Comment[] = [];
  let allDeleted: number[] = [];
  let token = syncToken || "";
  let nextSyncToken: string | undefined = undefined;
  let page = 0;

  while (true) {
    const url = new URL("/api/comments/sync", leadCMSUrl);
    url.searchParams.set("filter[limit]", "100");
    url.searchParams.set("syncToken", token);

    logger.verbose(`[PULL_COMMENT_SYNC] Page ${page}, URL: ${url.toString()}`);

    try {
      // SECURITY: Never send API key for read operations
      // Comments sync should only return public comments
      const res: AxiosResponse<CommentSyncResponse> = await axios.get(url.toString(), {
        headers: {},
      });

      if (res.status === 204) {
        logger.verbose(`[PULL_COMMENT_SYNC] Got 204 No Content - ending sync`);
        break;
      }

      const data = res.data;
      logger.verbose(
        `[PULL_COMMENT_SYNC] Page ${page} - Got ${data.items?.length || 0} items, ${data.deleted?.length || 0} deleted`
      );

      if (data.items && Array.isArray(data.items)) allItems.push(...data.items);

      if (data.deleted && Array.isArray(data.deleted)) {
        allDeleted.push(...data.deleted);
      }

      const newSyncToken = res.headers["x-next-sync-token"] || token;
      logger.verbose(`[PULL_COMMENT_SYNC] Next sync token: ${newSyncToken}`);

      if (!newSyncToken || newSyncToken === token) {
        nextSyncToken = newSyncToken || token;
        logger.verbose(`[PULL_COMMENT_SYNC] No new sync token - ending sync`);
        break;
      }

      nextSyncToken = newSyncToken;
      token = newSyncToken;
      page++;
    } catch (error: any) {
      console.error(`[PULL_COMMENT_SYNC] Failed on page ${page}:`, error.message);

      // Provide helpful error messages based on status code
      if (error.response?.status === 403) {
        console.error(`\n⛔ Access Denied (403 Forbidden)`);
        console.error(`   The comments endpoint is not accessible.`);
        console.error(`   Please check:`);
        console.error(`   1. The comments feature is enabled for your LeadCMS instance`);
        console.error(`   2. Public access to comments is configured in LeadCMS`);
        console.error(`   3. Your LeadCMS URL is correct: ${leadCMSUrl}`);
      } else if (error.response?.status === 401) {
        console.error(`\n🔒 Unauthorized (401)`);
        console.error(`   The comments endpoint requires authentication.`);
        console.error(`   This may indicate a LeadCMS configuration issue.`);
      } else if (error.response?.status === 404) {
        console.error(`\n❌ Not Found (404)`);
        console.error(`   The comments endpoint does not exist.`);
        console.error(`   Please verify your LeadCMS URL and version.`);
      }

      throw error;
    }
  }

  logger.verbose(
    `[PULL_COMMENT_SYNC] Completed - Total items: ${allItems.length}, deleted: ${allDeleted.length}`
  );
  return {
    items: allItems,
    deleted: allDeleted,
    nextSyncToken: nextSyncToken || token,
  };
}

/**
 * Convert Comment to StoredComment by removing nested objects.
 * Uses explicit property assignment to ensure consistent key order
 * regardless of the order returned by different API remotes.
 */
function toStoredComment(comment: Comment): StoredComment {
  const stored: StoredComment = {
    id: comment.id,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    parentId: comment.parentId,
    authorName: comment.authorName,
    body: comment.body,
    status: comment.status,
    answerStatus: comment.answerStatus,
    publishedAt: comment.publishedAt,
    commentableId: comment.commentableId,
    commentableType: comment.commentableType,
    avatarUrl: comment.avatarUrl,
    language: comment.language,
    translationKey: comment.translationKey,
    contactId: comment.contactId,
    source: comment.source,
    tags: comment.tags,
  };

  // Remove undefined properties to keep files clean
  for (const key of Object.keys(stored) as (keyof StoredComment)[]) {
    if (stored[key] === undefined) {
      delete stored[key];
    }
  }

  return stored;
}

/**
 * Canonical property order for StoredComment serialization.
 * Ensures consistent JSON output regardless of the order properties arrive from the API.
 */
const STORED_COMMENT_KEY_ORDER: (keyof StoredComment)[] = [
  'id', 'createdAt', 'updatedAt',
  'parentId', 'authorName', 'body',
  'status', 'answerStatus', 'publishedAt',
  'commentableId', 'commentableType',
  'avatarUrl', 'language', 'translationKey',
  'contactId', 'source', 'tags',
];

/**
 * Normalize a StoredComment to have consistent property order for serialization.
 */
function normalizeCommentKeys(comment: StoredComment): StoredComment {
  const normalized = {} as StoredComment;
  for (const key of STORED_COMMENT_KEY_ORDER) {
    if (key in comment) {
      (normalized as any)[key] = comment[key];
    }
  }
  return normalized;
}

/**
 * Get comment file path based on language
 * Default language goes in root, others in language subdirectories
 */
function getCommentFilePath(
  commentableType: string,
  commentableId: number,
  language: string
): string {
  const defaultLanguage = config.defaultLanguage;
  const typeLower = commentableType.toLowerCase();

  if (language === defaultLanguage) {
    return path.join(COMMENTS_DIR, typeLower, `${commentableId}.json`);
  } else {
    return path.join(COMMENTS_DIR, language, typeLower, `${commentableId}.json`);
  }
}

/**
 * Load existing comments from a specific entity file
 */
async function loadCommentsForEntity(
  commentableType: string,
  commentableId: number,
  language: string
): Promise<StoredComment[]> {
  const filePath = getCommentFilePath(commentableType, commentableId, language);
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch {
    // File doesn't exist or is invalid, return empty array
    return [];
  }
}

/**
 * Save comments for a specific entity to disk
 */
async function saveCommentsForEntity(
  commentableType: string,
  commentableId: number,
  language: string,
  comments: StoredComment[]
): Promise<void> {
  const filePath = getCommentFilePath(commentableType, commentableId, language);
  const dirPath = path.dirname(filePath);
  await fs.mkdir(dirPath, { recursive: true });

  if (comments.length === 0) {
    // If no comments, remove the file
    try {
      await fs.unlink(filePath);
      logger.verbose(`Removed empty comment file: ${filePath}`);
    } catch {
      // File might not exist, that's okay
    }
  } else {
    // Sort comments by createdAt and then by id for consistency
    const sortedComments = [...comments].sort((a, b) => {
      const dateCompare = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (dateCompare !== 0) return dateCompare;
      return (a.id || 0) - (b.id || 0);
    });

    // Normalize property order for consistent serialization across remotes
    const normalized = sortedComments.map(normalizeCommentKeys);

    await fs.writeFile(filePath, JSON.stringify(normalized, null, 2), "utf8");
    logger.verbose(`Saved ${sortedComments.length} comments to ${filePath}`);
  }
}

/**
 * Delete a specific comment by ID (used internally during sync)
 * Searches through all comment files to find and remove the comment
 */
async function deleteComment(commentId: number): Promise<void> {
  try {
    // Check if comments directory exists
    await fs.access(COMMENTS_DIR);

    // Get all top-level directories (could be language codes or comment types)
    const topLevelItems = await fs.readdir(COMMENTS_DIR);

    for (const item of topLevelItems) {
      const itemPath = path.join(COMMENTS_DIR, item);
      const stat = await fs.stat(itemPath);

      if (!stat.isDirectory()) continue;

      // Check if this is a language directory (locale code) or commentable type
      const isLanguageDir = isValidLocaleCode(item);

      if (isLanguageDir) {
        // This is a language subdirectory, look for commentable types inside
        const commentableTypes = await fs.readdir(itemPath);

        for (const commentableType of commentableTypes) {
          const typePath = path.join(itemPath, commentableType);
          const typeStat = await fs.stat(typePath);

          if (!typeStat.isDirectory()) continue;

          // Look through comment files in this type directory
          await searchAndDeleteInTypeDirectory(typePath, commentableType, item, commentId);
        }
      } else {
        // This is a commentable type at root level (default language)
        await searchAndDeleteInTypeDirectory(itemPath, item, config.defaultLanguage, commentId);
      }
    }
  } catch (error: any) {
    if (error.code !== "ENOENT") {
      throw error;
    }
    // Comments directory doesn't exist, nothing to delete
  }
}

/**
 * Helper function to search for and delete a comment in a type directory
 */
async function searchAndDeleteInTypeDirectory(
  typePath: string,
  commentableType: string,
  language: string,
  commentId: number
): Promise<void> {
  const files = await fs.readdir(typePath);

  for (const file of files) {
    if (!file.endsWith(".json")) continue;

    const commentableId = parseInt(file.replace(".json", ""), 10);
    if (isNaN(commentableId)) continue;

    const comments = await loadCommentsForEntity(commentableType, commentableId, language);
    const originalLength = comments.length;
    const filtered = comments.filter((c) => c.id !== commentId);

    if (filtered.length < originalLength) {
      // Found and removed the comment
      await saveCommentsForEntity(commentableType, commentableId, language, filtered);
      logger.verbose(`Deleted comment ${commentId} from ${commentableType}/${commentableId} (${language})`);
      return; // Comment found and deleted, we're done
    }
  }
}

/**
 * Group comments by their commentable entity and language
 */
function groupCommentsByEntityAndLanguage(comments: Comment[]): Map<string, Comment[]> {
  const grouped = new Map<string, Comment[]>();

  for (const comment of comments) {
    const key = `${comment.commentableType}/${comment.commentableId}/${comment.language}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(comment);
  }

  return grouped;
}



/**
 * Check CMS config to check if comments are supported
 */
async function fetchCMSConfigForEntity(): Promise<boolean> {
  try {
    const { default: axios } = await import('axios');
    const { setCMSConfig, isCommentsSupported } = await import('../lib/cms-config-types.js');

    const configUrl = new URL('/api/config', leadCMSUrl).toString();
    const response = await axios.get(configUrl, { timeout: 10000 });

    if (response.data) {
      setCMSConfig(response.data);
      return isCommentsSupported();
    }
  } catch (error: any) {
    console.warn(`[PULL_COMMENT_SYNC] Could not fetch CMS config: ${error.message}`);
    console.warn(`[PULL_COMMENT_SYNC] Assuming comments are supported (backward compatibility)`);
  }
  return false;
}

/**
 * Main function to sync comments from LeadCMS
 */
export async function main(remoteCtx?: RemoteContext): Promise<void> {
  logger.verbose(`[ENV] LeadCMS URL: ${leadCMSUrl}`);
  logger.verbose(
    `[ENV] LeadCMS API Key: ${leadCMSApiKey ? 'CONFIGURED (ignored for anonymous comment pull)' : 'NOT_SET'}`
  );
  logger.verbose(`[ENV] Comments Dir: ${COMMENTS_DIR}`);

  // Check if comments are supported
  logger.verbose(`\n🔍 Checking CMS configuration...`);
  const commentsSupported = await fetchCMSConfigForEntity();

  if (!commentsSupported) {
    console.log(`⏭️  Comments entity not supported by this LeadCMS instance - skipping comment sync`);
    return;
  }

  logger.verbose(`✅ Comments supported - proceeding with sync\n`);

  await fs.mkdir(COMMENTS_DIR, { recursive: true });

  const { token: lastSyncToken, migrated: commentTokenMigrated } = await readCommentSyncToken(remoteCtx);

  let items: Comment[] = [],
    deleted: number[] = [],
    nextSyncToken: string = "";

  try {
    if (lastSyncToken) {
      logger.verbose(`Syncing comments from LeadCMS using sync token: ${lastSyncToken}`);
      ({ items, deleted, nextSyncToken } = await pullCommentSync(lastSyncToken));
    } else {
      logger.verbose("No comment sync token found. Doing full pull from LeadCMS...");
      ({ items, deleted, nextSyncToken } = await pullCommentSync(undefined));
    }
  } catch (error: any) {
    console.error(`\n❌ Failed to sync comments from LeadCMS`);
    console.error(`   Error: ${error.message}`);

    // Error details are already logged by pullCommentSync
    // Just provide a summary here
    if (error.response?.status === 403 || error.response?.status === 401) {
      console.error(`\n💡 This may be a LeadCMS configuration issue.`);
      console.error(`   Contact your LeadCMS administrator to check API settings.`);
    }

    throw error;
  }

  console.log(`\x1b[32mPulled ${items.length} comment items, ${deleted.length} deleted.\x1b[0m`);

  // Load per-remote metadata for multi-remote support
  const rcModule = remoteCtx ? await import('../lib/remote-context.js') : undefined;
  let metadataMap: MetadataMap | undefined;
  if (remoteCtx && rcModule) {
    metadataMap = await rcModule.readMetadataMap(remoteCtx);
  }

  // Load defaultRemote's metadata so stored comment files always reflect the
  // default remote's ids and timestamps, even when pulling from another remote.
  // Derive defaultRemote stateDir from the current remote's stateDir (sibling
  // directory) so it works regardless of process.cwd().
  let defaultMetadataMap: MetadataMap | undefined;
  if (remoteCtx && !remoteCtx.isDefault && rcModule) {
    const cfg = getConfig();
    if (cfg.defaultRemote) {
      const defaultStateDir = path.join(path.dirname(remoteCtx.stateDir), cfg.defaultRemote);
      const defaultCtx: import('../lib/remote-context.js').RemoteContext = {
        name: cfg.defaultRemote,
        url: cfg.remotes?.[cfg.defaultRemote]?.url || '',
        isDefault: true,
        stateDir: defaultStateDir,
      };
      defaultMetadataMap = await rcModule.readMetadataMap(defaultCtx);
    }
  }

  // Process updated/new comments
  if (items.length > 0) {
    const groupedComments = groupCommentsByEntityAndLanguage(items);

    for (const [entityKey, comments] of groupedComments) {
      const [commentableType, commentableIdStr, language] = entityKey.split("/");
      const commentableId = parseInt(commentableIdStr, 10);

      // Load existing comments for this language
      const existing = await loadCommentsForEntity(commentableType, commentableId, language);

      // Create a map of existing comments by ID (or translationKey for id-less
      // comments from non-default remotes) for quick lookup
      const existingMap = new Map<number | string | undefined, StoredComment>(
        existing.map((c) => [c.id ?? c.translationKey, c]),
      );

      // Update or add comments
      for (const comment of comments) {
        // Update per-remote metadata with this comment's data
        if (remoteCtx && rcModule && metadataMap && comment.translationKey && comment.language) {
          if (comment.id != null) {
            rcModule.setCommentRemoteId(metadataMap, comment.language, comment.translationKey, comment.id);
          }
          rcModule.setMetadataForComment(metadataMap, comment.language, comment.translationKey, {
            createdAt: comment.createdAt,
            updatedAt: comment.updatedAt ?? undefined,
          });
        }

        let commentToStore = toStoredComment(comment);

        // For non-default remotes, replace id/createdAt/updatedAt with the
        // default remote's values so local files always reflect prod metadata.
        // If the comment has no default entry yet, strip these fields entirely.
        // The current remote's values are already saved in its per-remote maps.
        if (remoteCtx && !remoteCtx.isDefault && comment.translationKey && comment.language) {
          const defaultEntry = defaultMetadataMap?.comments?.[comment.language]?.[comment.translationKey];
          const { id, createdAt, updatedAt, ...rest } = commentToStore;
          commentToStore = {
            ...(defaultEntry?.id != null ? { id: Number(defaultEntry.id) } : {}),
            ...(defaultEntry?.createdAt ? { createdAt: defaultEntry.createdAt as string } : {}),
            ...(defaultEntry?.updatedAt ? { updatedAt: defaultEntry.updatedAt as string } : {}),
            ...rest,
          } as StoredComment;
        }

        existingMap.set(commentToStore.id ?? commentToStore.translationKey, commentToStore);
      }

      // Convert back to array and save
      const updated = Array.from(existingMap.values());
      await saveCommentsForEntity(commentableType, commentableId, language, updated);
    }
  }

  // Handle deleted comments
  if (deleted.length > 0) {
    console.log(`\nProcessing ${deleted.length} deleted comments...`);
    for (const commentId of deleted) {
      await deleteComment(commentId);
    }
  }

  // Save new sync token
  if (nextSyncToken) {
    await writeCommentSyncToken(nextSyncToken, remoteCtx);
    logger.verbose(`Comment sync token updated: ${nextSyncToken}`);
  }

  // Write per-remote metadata map
  if (remoteCtx && rcModule && metadataMap && items.length > 0) {
    await rcModule.writeMetadataMap(remoteCtx, metadataMap);
  }

  // Clean up legacy sync token after successful migration
  if (commentTokenMigrated) {
    await cleanupLegacyCommentSyncToken();
    logger.verbose(`[SYNC] Removed legacy comment sync token`);
  }

  console.log(`\nComment sync completed successfully.`);
}

// Export the main function so it can be imported by other modules
export { main as pullLeadCMSComments };

// Note: CLI execution moved to CLI entry points
// This file now only exports the function for programmatic use

// Export helper functions for testing
export {
  pullCommentSync,
  loadCommentsForEntity,
  saveCommentsForEntity,
  groupCommentsByEntityAndLanguage,
  toStoredComment,
  deleteComment,
};

// Export types
export type { CommentSyncResult };
