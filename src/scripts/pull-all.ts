#!/usr/bin/env node
/**
 * Orchestrator for pulling all content from LeadCMS
 * Checks entity support before fetching content, media, and comments
 */

import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import axios from "axios";
import { leadCMSUrl } from "./leadcms-helpers.js";
import { setCMSConfig, isContentSupported, isMediaSupported, isCommentsSupported } from "../lib/cms-config-types.js";
import { getConfig } from "../lib/config.js";

interface PullAllOptions {
  targetId?: string;
  targetSlug?: string;
  /** When true, delete all local files and sync tokens before pulling, effectively doing a fresh pull from scratch. */
  reset?: boolean;
}

/**
 * Fetch CMS config to determine which entities are supported
 */
async function fetchAndCacheCMSConfig(): Promise<{
  content: boolean;
  media: boolean;
  comments: boolean;
}> {
  try {
    console.log(`🔍 Checking CMS configuration...`);
    const configUrl = new URL('/api/config', leadCMSUrl).toString();
    const response = await axios.get(configUrl, { timeout: 10000 });

    if (response.data) {
      setCMSConfig(response.data);
      const support = {
        content: isContentSupported(),
        media: isMediaSupported(),
        comments: isCommentsSupported(),
      };

      console.log(`✅ CMS Configuration received`);
      console.log(`   - Content: ${support.content ? '✓' : '✗'}`);
      console.log(`   - Media: ${support.media ? '✓' : '✗'}`);
      console.log(`   - Comments: ${support.comments ? '✓' : '✗'}`);
      console.log('');

      return support;
    }
  } catch (error: any) {
    console.warn(`⚠️  Could not fetch CMS config: ${error.message}`);
    console.warn(`⚠️  Assuming all entities are supported (backward compatibility)\n`);
  }

  return { content: false, media: false, comments: false };
}

/**
 * Delete all local content, media, comments, and sync tokens.
 * Used by --reset to do a clean pull from scratch.
 */
async function resetLocalState(): Promise<void> {
  const config = getConfig();
  const contentDir = path.resolve(config.contentDir);
  const mediaDir = path.resolve(config.mediaDir);
  const commentsDir = path.resolve(config.commentsDir);

  console.log(`🗑️  Resetting local state...`);

  // Delete content directory (includes content sync token at contentDir/.sync-token)
  try {
    await fs.rm(contentDir, { recursive: true, force: true });
    console.log(`   ✓ Cleared content directory: ${contentDir}`);
  } catch { /* directory may not exist */ }

  // Delete media directory (includes media sync token at mediaDir/.sync-token)
  try {
    await fs.rm(mediaDir, { recursive: true, force: true });
    console.log(`   ✓ Cleared media directory: ${mediaDir}`);
  } catch { /* directory may not exist */ }

  // Delete comments directory (includes comment sync token at commentsDir/.sync-token)
  try {
    await fs.rm(commentsDir, { recursive: true, force: true });
    console.log(`   ✓ Cleared comments directory: ${commentsDir}`);
  } catch { /* directory may not exist */ }

  // Also clean up any legacy sync tokens (SDK ≤ 3.2) that may linger
  // in parent-of-contentDir and parent-of-commentsDir
  const legacyTokenFiles = [
    path.join(path.dirname(contentDir), 'sync-token.txt'),
    path.join(path.dirname(contentDir), 'media-sync-token.txt'),
    path.join(path.dirname(commentsDir), 'comment-sync-token.txt'),
  ];
  for (const legacyFile of legacyTokenFiles) {
    try {
      await fs.unlink(legacyFile);
      console.log(`   ✓ Removed legacy sync token: ${legacyFile}`);
    } catch { /* not found — ok */ }
  }

  console.log(`   ✅ Local state reset complete\n`);
}

/**
 * Main orchestrator function
 */
async function main(options: PullAllOptions = {}): Promise<void> {
  const { targetId, targetSlug, reset } = options;

  // If pulling specific content by ID or slug, use pull-content logic directly
  if (targetId || targetSlug) {
    console.log(`\n🚀 LeadCMS Pull - Fetching specific content\n`);
    const { pullContent } = await import('./pull-content.js');
    await pullContent({ targetId, targetSlug });
    return;
  }

  // Handle --reset flag: clear everything before pulling
  if (reset) {
    console.log(`\n🔄 LeadCMS Pull --reset - Fresh pull from scratch\n`);
    await resetLocalState();
  } else {
    console.log(`\n🚀 LeadCMS Pull - Fetching all content\n`);
  }

  // Check which entities are supported
  const { content, media, comments } = await fetchAndCacheCMSConfig();

  if (!content && !media && !comments) {
    console.log(`⏭️  No supported entities found - nothing to sync`);
    return;
  }

  // Import and run fetch functions for supported entities
  const fetchPromises: Promise<void>[] = [];

  if (content || media) {
    console.log(`📄 Fetching content and media...`);
    const { fetchLeadCMSContent } = await import('./fetch-leadcms-content.js');
    fetchPromises.push(fetchLeadCMSContent());
  }

  if (comments) {
    console.log(`💬 Fetching comments...`);
    const { fetchLeadCMSComments } = await import('./fetch-leadcms-comments.js');
    fetchPromises.push(fetchLeadCMSComments());
  }

  // Wait for all fetches to complete
  try {
    await Promise.all(fetchPromises);
    console.log(`\n✨ Pull completed successfully!\n`);
  } catch (error: any) {
    console.error(`\n❌ Pull failed: ${error.message}\n`);
    throw error;
  }
}

// Export the main function
export { main as pullAll };

// Export resetLocalState for testing and programmatic use
export { resetLocalState };

// Note: CLI execution moved to src/cli/bin/pull-all.ts
// This file now only exports the function for programmatic use
