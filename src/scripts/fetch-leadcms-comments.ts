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
 */
async function readCommentSyncToken(): Promise<{ token: string | undefined; migrated: boolean }> {
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
 * Write the comment sync token to disk (new location inside commentsDir)
 */
async function writeCommentSyncToken(token: string): Promise<void> {
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
 * Fetch comments from LeadCMS sync endpoint
 * Handles pagination automatically
 */
async function fetchCommentSync(syncToken?: string): Promise<CommentSyncResult> {
  logger.verbose(`[FETCH_COMMENT_SYNC] Starting with syncToken: ${syncToken || "NONE"}`);
  logger.verbose(`[FETCH_COMMENT_SYNC] Fetching public comments (no authentication)`);
  let allItems: Comment[] = [];
  let allDeleted: number[] = [];
  let token = syncToken || "";
  let nextSyncToken: string | undefined = undefined;
  let page = 0;

  while (true) {
    const url = new URL("/api/comments/sync", leadCMSUrl);
    url.searchParams.set("filter[limit]", "100");
    url.searchParams.set("syncToken", token);

    logger.verbose(`[FETCH_COMMENT_SYNC] Page ${page}, URL: ${url.toString()}`);

    try {
      // SECURITY: Never send API key for read operations
      // Comments sync should only return public comments
      const res: AxiosResponse<CommentSyncResponse> = await axios.get(url.toString());

      if (res.status === 204) {
        logger.verbose(`[FETCH_COMMENT_SYNC] Got 204 No Content - ending sync`);
        break;
      }

      const data = res.data;
      logger.verbose(
        `[FETCH_COMMENT_SYNC] Page ${page} - Got ${data.items?.length || 0} items, ${data.deleted?.length || 0} deleted`
      );

      if (data.items && Array.isArray(data.items)) allItems.push(...data.items);

      if (data.deleted && Array.isArray(data.deleted)) {
        allDeleted.push(...data.deleted);
      }

      const newSyncToken = res.headers["x-next-sync-token"] || token;
      logger.verbose(`[FETCH_COMMENT_SYNC] Next sync token: ${newSyncToken}`);

      if (!newSyncToken || newSyncToken === token) {
        nextSyncToken = newSyncToken || token;
        logger.verbose(`[FETCH_COMMENT_SYNC] No new sync token - ending sync`);
        break;
      }

      nextSyncToken = newSyncToken;
      token = newSyncToken;
      page++;
    } catch (error: any) {
      console.error(`[FETCH_COMMENT_SYNC] Failed on page ${page}:`, error.message);

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
    `[FETCH_COMMENT_SYNC] Completed - Total items: ${allItems.length}, deleted: ${allDeleted.length}`
  );
  return {
    items: allItems,
    deleted: allDeleted,
    nextSyncToken: nextSyncToken || token,
  };
}

/**
 * Convert Comment to StoredComment by removing nested objects
 */
function toStoredComment(comment: Comment): StoredComment {
  const { content, parent, contact, ...stored } = comment;
  return stored;
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
      return a.id - b.id;
    });

    await fs.writeFile(filePath, JSON.stringify(sortedComments, null, 2), "utf8");
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
 * Fetch CMS config to check if comments are supported
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
    console.warn(`[FETCH_COMMENT_SYNC] Could not fetch CMS config: ${error.message}`);
    console.warn(`[FETCH_COMMENT_SYNC] Assuming comments are supported (backward compatibility)`);
  }
  return false;
}

/**
 * Main function to sync comments from LeadCMS
 */
export async function main(): Promise<void> {
  logger.verbose(`[ENV] LeadCMS URL: ${leadCMSUrl}`);
  logger.verbose(
    `[ENV] LeadCMS API Key: ${leadCMSApiKey ? `${leadCMSApiKey.substring(0, 8)}...` : "NOT_SET"}`
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

  const { token: lastSyncToken, migrated: commentTokenMigrated } = await readCommentSyncToken();

  let items: Comment[] = [],
    deleted: number[] = [],
    nextSyncToken: string = "";

  try {
    if (lastSyncToken) {
      logger.verbose(`Syncing comments from LeadCMS using sync token: ${lastSyncToken}`);
      ({ items, deleted, nextSyncToken } = await fetchCommentSync(lastSyncToken));
    } else {
      logger.verbose("No comment sync token found. Doing full fetch from LeadCMS...");
      ({ items, deleted, nextSyncToken } = await fetchCommentSync(undefined));
    }
  } catch (error: any) {
    console.error(`\n❌ Failed to sync comments from LeadCMS`);
    console.error(`   Error: ${error.message}`);

    // Error details are already logged by fetchCommentSync
    // Just provide a summary here
    if (error.response?.status === 403 || error.response?.status === 401) {
      console.error(`\n💡 This may be a LeadCMS configuration issue.`);
      console.error(`   Contact your LeadCMS administrator to check API settings.`);
    }

    throw error;
  }

  console.log(`\x1b[32mFetched ${items.length} comment items, ${deleted.length} deleted.\x1b[0m`);

  // Process updated/new comments
  if (items.length > 0) {
    const groupedComments = groupCommentsByEntityAndLanguage(items);

    for (const [entityKey, comments] of groupedComments) {
      const [commentableType, commentableIdStr, language] = entityKey.split("/");
      const commentableId = parseInt(commentableIdStr, 10);

      // Load existing comments for this language
      const existing = await loadCommentsForEntity(commentableType, commentableId, language);

      // Create a map of existing comments by ID for quick lookup
      const existingMap = new Map(existing.map((c) => [c.id, c]));

      // Update or add comments
      for (const comment of comments) {
        const stored = toStoredComment(comment);
        existingMap.set(stored.id, stored);
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
    await writeCommentSyncToken(nextSyncToken);
    logger.verbose(`Comment sync token updated: ${nextSyncToken}`);
  }

  // Clean up legacy sync token after successful migration
  if (commentTokenMigrated) {
    await cleanupLegacyCommentSyncToken();
    logger.verbose(`[SYNC] Removed legacy comment sync token`);
  }

  console.log(`\nComment sync completed successfully.`);
}

// Export the main function so it can be imported by other modules
export { main as fetchLeadCMSComments };

// Note: CLI execution moved to CLI entry points
// This file now only exports the function for programmatic use

// Export helper functions for testing
export {
  loadCommentsForEntity,
  saveCommentsForEntity,
  groupCommentsByEntityAndLanguage,
  toStoredComment,
  deleteComment,
};

// Export types
export type { CommentSyncResult };
