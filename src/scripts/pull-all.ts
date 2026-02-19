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
import { setCMSConfig, isContentSupported, isMediaSupported, isCommentsSupported, isEmailTemplatesSupported } from "../lib/cms-config-types.js";
import { getConfig } from "../lib/config.js";
import { logger } from "../lib/logger.js";

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
  emailTemplates: boolean;
}> {
  try {
    logger.verbose(`🔍 Checking CMS configuration...`);
    const configUrl = new URL('/api/config', leadCMSUrl).toString();
    const response = await axios.get(configUrl, { timeout: 10000 });

    if (response.data) {
      setCMSConfig(response.data);
      const support = {
        content: isContentSupported(),
        media: isMediaSupported(),
        comments: isCommentsSupported(),
        emailTemplates: isEmailTemplatesSupported(),
      };

      logger.verbose(`✅ CMS Configuration received`);
      logger.verbose(`   - Content: ${support.content ? '✓' : '✗'}`);
      logger.verbose(`   - Media: ${support.media ? '✓' : '✗'}`);
      logger.verbose(`   - Comments: ${support.comments ? '✓' : '✗'}`);
      logger.verbose(`   - Email Templates: ${support.emailTemplates ? '✓' : '✗'}`);
      logger.verbose('');

      return support;
    }
  } catch (error: any) {
    console.warn(`⚠️  Could not fetch CMS config: ${error.message}`);
    console.warn(`⚠️  Assuming all entities are supported (backward compatibility)\n`);
  }

  return { content: false, media: false, comments: false, emailTemplates: false };
}

/**
 * Reset content directory and its sync tokens.
 * Deletes content files, the sync token inside contentDir, and any legacy sync tokens.
 */
async function resetContentState(): Promise<void> {
  const config = getConfig();
  const contentDir = path.resolve(config.contentDir);

  try {
    await fs.rm(contentDir, { recursive: true, force: true });
    logger.verbose(`   ✓ Cleared content directory: ${contentDir}`);
  } catch { /* directory may not exist */ }

  // Clean up legacy content sync token (SDK ≤ 3.2)
  try {
    await fs.unlink(path.join(path.dirname(contentDir), 'sync-token.txt'));
    logger.verbose(`   ✓ Removed legacy content sync token`);
  } catch { /* not found — ok */ }
}

/**
 * Reset media directory and its sync tokens.
 * Deletes media files, the sync token inside mediaDir, and any legacy sync tokens.
 */
async function resetMediaState(): Promise<void> {
  const config = getConfig();
  const mediaDir = path.resolve(config.mediaDir);
  const contentDir = path.resolve(config.contentDir);

  try {
    await fs.rm(mediaDir, { recursive: true, force: true });
    logger.verbose(`   ✓ Cleared media directory: ${mediaDir}`);
  } catch { /* directory may not exist */ }

  // Clean up legacy media sync token (SDK ≤ 3.2, stored next to content dir)
  try {
    await fs.unlink(path.join(path.dirname(contentDir), 'media-sync-token.txt'));
    logger.verbose(`   ✓ Removed legacy media sync token`);
  } catch { /* not found — ok */ }
}

/**
 * Reset comments directory and its sync tokens.
 * Deletes comment files, the sync token inside commentsDir, and any legacy sync tokens.
 */
async function resetCommentsState(): Promise<void> {
  const config = getConfig();
  const commentsDir = path.resolve(config.commentsDir);

  try {
    await fs.rm(commentsDir, { recursive: true, force: true });
    logger.verbose(`   ✓ Cleared comments directory: ${commentsDir}`);
  } catch { /* directory may not exist */ }

  // Clean up legacy comment sync token (SDK ≤ 3.2)
  try {
    await fs.unlink(path.join(path.dirname(commentsDir), 'comment-sync-token.txt'));
    logger.verbose(`   ✓ Removed legacy comment sync token`);
  } catch { /* not found — ok */ }
}

/**
 * Reset email templates directory and its sync tokens.
 */
async function resetEmailTemplatesState(): Promise<void> {
  const config = getConfig();
  const emailTemplatesDir = path.resolve(config.emailTemplatesDir);

  try {
    await fs.rm(emailTemplatesDir, { recursive: true, force: true });
    logger.verbose(`   ✓ Cleared email templates directory: ${emailTemplatesDir}`);
  } catch { /* directory may not exist */ }
}

/**
 * Delete all local content, media, comments, and sync tokens.
 * Used by --reset to do a clean pull from scratch.
 */
async function resetLocalState(): Promise<void> {
  console.log(`🗑️  Resetting local state...`);

  await resetContentState();
  await resetMediaState();
  await resetCommentsState();
  await resetEmailTemplatesState();

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
  const { content, media, comments, emailTemplates } = await fetchAndCacheCMSConfig();

  if (!content && !media && !comments && !emailTemplates) {
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

  if (emailTemplates) {
    console.log(`📧 Fetching email templates...`);
    const { fetchLeadCMSEmailTemplates } = await import('./fetch-leadcms-email-templates.js');
    fetchPromises.push(fetchLeadCMSEmailTemplates());
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

// Export reset functions for individual pull commands and testing
export { resetLocalState, resetContentState, resetMediaState, resetCommentsState, resetEmailTemplatesState };

// Note: CLI execution moved to src/cli/bin/pull-all.ts
// This file now only exports the function for programmatic use
