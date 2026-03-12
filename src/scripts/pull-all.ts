#!/usr/bin/env node
/**
 * Orchestrator for pulling all content from LeadCMS
 * Checks entity support before pulling content, media, and comments
 */

import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import axios from "axios";
import { leadCMSUrl, leadCMSApiKey } from "./leadcms-helpers.js";
import { setCMSConfig, isContentSupported, isMediaSupported, isCommentsSupported, isEmailTemplatesSupported, isSettingsSupported } from "../lib/cms-config-types.js";
import { getConfig } from "../lib/config.js";
import { logger } from "../lib/logger.js";
import { syncTokenPath, metadataMapPath } from "../lib/remote-context.js";
import type { RemoteContext } from "../lib/remote-context.js";

interface PullAllOptions {
  targetId?: string;
  targetSlug?: string;
  /** When true, delete all local files and sync tokens before pulling, effectively doing a fresh pull from scratch. */
  reset?: boolean;
  /** When true, skip three-way merge and always overwrite local files with remote content. */
  force?: boolean;
  /** Remote context for multi-remote support. */
  remoteContext?: RemoteContext;
}

/**
 * Fetch CMS config to determine which entities are supported
 */
async function fetchAndCacheCMSConfig(baseUrl?: string): Promise<{
  content: boolean;
  media: boolean;
  comments: boolean;
  emailTemplates: boolean;
  settings: boolean;
}> {
  try {
    const effectiveUrl = baseUrl || leadCMSUrl;
    logger.info(`🔍 Checking CMS configuration...`);
    const configUrl = new URL('/api/config', effectiveUrl).toString();
    const response = await axios.get(configUrl, { timeout: 10000 });

    if (response.data) {
      setCMSConfig(response.data);
      const hasApiKey = !!leadCMSApiKey;
      const support = {
        content: isContentSupported(),
        media: isMediaSupported(),
        comments: isCommentsSupported(),
        emailTemplates: isEmailTemplatesSupported() && hasApiKey,
        settings: isSettingsSupported() && hasApiKey,
      };

      logger.info(`✅ CMS Configuration received`);
      logger.info(`   - Content: ${support.content ? '✓' : '✗'}`);
      logger.info(`   - Media: ${support.media ? '✓' : '✗'}`);
      logger.info(`   - Comments: ${support.comments ? '✓' : '✗'}`);
      logger.info(`   - Email Templates: ${support.emailTemplates ? '✓' : '✗'}${isEmailTemplatesSupported() && !hasApiKey ? ' (requires auth)' : ''}`);
      logger.info(`   - Settings: ${support.settings ? '✓' : '✗'}${isSettingsSupported() && !hasApiKey ? ' (requires auth)' : ''}`);
      logger.info('');

      return support;
    }
  } catch (error: any) {
    console.warn(`⚠️  Could not fetch CMS config: ${error.message}`);
    console.warn(`⚠️  Assuming all entities are supported (backward compatibility)\n`);
  }

  return { content: false, media: false, comments: false, emailTemplates: false, settings: false };
}

/**
 * Reset content directory and its sync tokens.
 * Deletes content files, the sync token inside contentDir, and any legacy sync tokens.
 * When remoteCtx is provided, also clears per-remote sync tokens.
 */
async function resetContentState(remoteCtx?: RemoteContext): Promise<void> {
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

  // Clear per-remote content sync token when remote context is provided
  if (remoteCtx) {
    try {
      await fs.unlink(syncTokenPath(remoteCtx, 'content'));
      logger.verbose(`   ✓ Removed per-remote content sync token (${remoteCtx.name})`);
    } catch { /* not found — ok */ }
  }
}

/**
 * Reset media directory and its sync tokens.
 * Deletes media files, the sync token inside mediaDir, and any legacy sync tokens.
 * When remoteCtx is provided, also clears per-remote media sync token.
 */
async function resetMediaState(remoteCtx?: RemoteContext): Promise<void> {
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

  // Clear per-remote media sync token
  if (remoteCtx) {
    try {
      await fs.unlink(syncTokenPath(remoteCtx, 'media'));
      logger.verbose(`   ✓ Removed per-remote media sync token (${remoteCtx.name})`);
    } catch { /* not found — ok */ }
  }
}

/**
 * Reset comments directory and its sync tokens.
 * Deletes comment files, the sync token inside commentsDir, and any legacy sync tokens.
 * When remoteCtx is provided, also clears per-remote comments sync token.
 */
async function resetCommentsState(remoteCtx?: RemoteContext): Promise<void> {
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

  // Clear per-remote comments sync token
  if (remoteCtx) {
    try {
      await fs.unlink(syncTokenPath(remoteCtx, 'comments'));
      logger.verbose(`   ✓ Removed per-remote comments sync token (${remoteCtx.name})`);
    } catch { /* not found — ok */ }
  }
}

/**
 * Reset email templates directory and its sync tokens.
 * When remoteCtx is provided, also clears per-remote email-templates sync token.
 */
async function resetEmailTemplatesState(remoteCtx?: RemoteContext): Promise<void> {
  const config = getConfig();
  const emailTemplatesDir = path.resolve(config.emailTemplatesDir);

  try {
    await fs.rm(emailTemplatesDir, { recursive: true, force: true });
    logger.verbose(`   ✓ Cleared email templates directory: ${emailTemplatesDir}`);
  } catch { /* directory may not exist */ }

  // Clear per-remote email-templates sync token
  if (remoteCtx) {
    try {
      await fs.unlink(syncTokenPath(remoteCtx, 'email-templates'));
      logger.verbose(`   ✓ Removed per-remote email-templates sync token (${remoteCtx.name})`);
    } catch { /* not found — ok */ }
  }
}

/**
 * Reset settings directory.
 */
async function resetSettingsState(): Promise<void> {
  const config = getConfig();
  const settingsDir = path.resolve(config.settingsDir || ".leadcms/settings");

  try {
    await fs.rm(settingsDir, { recursive: true, force: true });
    logger.verbose(`   ✓ Cleared settings directory: ${settingsDir}`);
  } catch { /* directory may not exist */ }
}

/**
 * Delete all local content, media, comments, and sync tokens.
 * Used by --reset to do a clean pull from scratch.
 * When remoteCtx is provided, also clears per-remote state (sync tokens and metadata).
 */
async function resetLocalState(remoteCtx?: RemoteContext): Promise<void> {
  console.log(`🗑️  Resetting local state...`);

  await resetContentState(remoteCtx);
  await resetMediaState(remoteCtx);
  await resetCommentsState(remoteCtx);
  await resetEmailTemplatesState(remoteCtx);
  await resetSettingsState();

  // Clear per-remote metadata
  if (remoteCtx) {
    try {
      await fs.unlink(metadataMapPath(remoteCtx));
      logger.verbose(`   ✓ Removed per-remote metadata (${remoteCtx.name})`);
    } catch { /* not found — ok */ }
  }

  console.log(`   ✅ Local state reset complete\n`);
}

/**
 * Main orchestrator function
 */
async function main(options: PullAllOptions = {}): Promise<void> {
  const { targetId, targetSlug, reset, force, remoteContext: remoteCtx } = options;
  const effectiveUrl = remoteCtx?.url || leadCMSUrl;

  // If pulling specific content by ID or slug, use pull-content logic directly
  if (targetId || targetSlug) {
    console.log(`\n🚀 LeadCMS Pull - Pulling specific content\n`);
    const { pullContent } = await import('./pull-content.js');
    await pullContent({ targetId, targetSlug, remoteContext: remoteCtx });
    return;
  }

  // Handle --reset flag: clear everything before pulling
  if (reset) {
    console.log(`\n🔄 LeadCMS Pull --reset - Fresh pull from scratch\n`);
    await resetLocalState(remoteCtx);
  } else {
    console.log(`\n🚀 LeadCMS Pull - Pulling all content\n`);
  }

  // Check which entities are supported
  const { content, media, comments, emailTemplates, settings } = await fetchAndCacheCMSConfig(effectiveUrl);

  if (!content && !media && !comments && !emailTemplates && !settings) {
    console.log(`⏭️  No supported entities found - nothing to sync`);
    return;
  }

  // Pull settings first — other content may depend on settings
  if (settings) {
    console.log(`\n⚙️  Pulling settings...`);
    try {
      const { pullSettings } = await import('./pull-settings.js');
      await pullSettings({ reset: false });
    } catch (error: any) {
      console.error(`   ❌ Failed to pull settings: ${error.message}`);
      // Continue with other content - settings failure should not block the pull
    }
  }

  // Import and run pull functions for supported entities
  const pullPromises: Promise<void>[] = [];

  if (content) {
    console.log(`📄 Pulling content...`);
    const { pullLeadCMSContent } = await import('./pull-leadcms-content.js');
    pullPromises.push(pullLeadCMSContent({ forceOverwrite: force, remoteContext: remoteCtx }));
  }

  if (media) {
    console.log(`🖼️  Pulling media...`);
    const { pullLeadCMSMedia } = await import('./pull-leadcms-media.js');
    pullPromises.push(pullLeadCMSMedia({ remoteContext: remoteCtx }));
  }

  if (comments) {
    console.log(`💬 Pulling comments...`);
    const { pullLeadCMSComments } = await import('./pull-leadcms-comments.js');
    pullPromises.push(pullLeadCMSComments(remoteCtx));
  }

  if (emailTemplates) {
    console.log(`📧 Pulling email templates...`);
    const { pullLeadCMSEmailTemplates } = await import('./pull-leadcms-email-templates.js');
    pullPromises.push(pullLeadCMSEmailTemplates(remoteCtx));
  }

  // Wait for all pulls to complete
  try {
    await Promise.all(pullPromises);
    console.log(`\n✨ Pull completed successfully!\n`);
  } catch (error: any) {
    console.error(`\n❌ Pull failed: ${error.message}\n`);
    throw error;
  }
}

// Export the main function
export { main as pullAll };

// Export reset functions for individual pull commands and testing
export { resetLocalState, resetContentState, resetMediaState, resetCommentsState, resetEmailTemplatesState, resetSettingsState };

// Note: CLI execution moved to src/cli/bin/pull-all.ts
// This file now only exports the function for programmatic use
