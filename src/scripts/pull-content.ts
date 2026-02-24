#!/usr/bin/env node
/**
 * Pull only content from LeadCMS (no media, no comments)
 */

import "dotenv/config";
import axios from "axios";
import { leadCMSUrl } from "./leadcms-helpers.js";
import { setCMSConfig, isContentSupported } from "../lib/cms-config-types.js";
import { fetchLeadCMSContent } from "./fetch-leadcms-content.js";
import { leadCMSDataService } from "../lib/data-service.js";
import { saveContentFile } from "../lib/content-transformation.js";
import { CONTENT_DIR, fetchContentTypes } from "./leadcms-helpers.js";
import { resetContentState } from "./pull-all.js";
import { logger } from "../lib/logger.js";

interface PullContentOptions {
  targetId?: string;
  targetSlug?: string;
  /** When true, delete all local content files and sync tokens before pulling, effectively doing a fresh pull. */
  reset?: boolean;
  /** When true, skip three-way merge and always overwrite local files with remote content. */
  force?: boolean;
}

/**
 * Main function
 */
async function main(options: PullContentOptions = {}): Promise<void> {
  const { targetId, targetSlug, reset, force } = options;

  console.log(`\n📄 LeadCMS Pull Content\n`);

  // Handle --reset flag: clear content before pulling
  if (reset) {
    console.log(`🔄 Resetting content state...\n`);
    await resetContentState();
  }

  // If pulling specific content by ID or slug
  if (targetId || targetSlug) {
    console.log(`🎯 Pulling specific content: ${targetId ? `ID ${targetId}` : `slug "${targetSlug}"`}`);

    try {
      let content = null;

      if (targetId) {
        const id = parseInt(targetId, 10);
        if (isNaN(id)) {
          console.error(`❌ Invalid ID: ${targetId}`);
          return;
        }
        content = await leadCMSDataService.getContentById(id);
      } else if (targetSlug) {
        content = await leadCMSDataService.getContentBySlug(targetSlug);
      }

      if (!content) {
        console.log(`⚠️  Content not found: ${targetId ? `ID ${targetId}` : `slug "${targetSlug}"`}`);
        return;
      }

      console.log(`✅ Found content: ${content.title} (${content.type})`);
      console.log(`   - Slug: ${content.slug}`);
      console.log(`   - Language: ${content.language || 'default'}`);
      console.log(`   - Type: ${content.type}`);
      console.log(`   - Last updated: ${content.updatedAt || 'unknown'}`);

      // Fetch content types for transformation
      const typeMap = await fetchContentTypes();

      // Save the content file (force overwrite)
      await saveContentFile({
        content,
        typeMap,
        contentDir: CONTENT_DIR,
      });

      console.log(`\n✅ Content file saved successfully!`);
      console.log(`   Location: ${CONTENT_DIR}/${content.language || 'default'}/${content.type}/${content.slug}`);
      console.log(`\n✨ Pull completed!\n`);
      return;
    } catch (error: any) {
      console.error(`❌ Failed to pull content:`, error.message);
      throw error;
    }
  }

  // Check if content is supported
  try {
    logger.verbose(`🔍 Checking CMS configuration...`);
    const configUrl = new URL('/api/config', leadCMSUrl).toString();
    const response = await axios.get(configUrl, { timeout: 10000 });

    if (response.data) {
      setCMSConfig(response.data);

      if (!isContentSupported()) {
        console.log(`⏭️  Content entity not supported by this LeadCMS instance`);
        return;
      }

      logger.verbose(`✅ Content entity supported\n`);
    }
  } catch (error: any) {
    console.warn(`⚠️  Could not fetch CMS config: ${error.message}`);
    console.warn(`⚠️  Assuming content is supported (backward compatibility)\n`);
  }

  // Fetch content and media
  await fetchLeadCMSContent({ forceOverwrite: force });

  console.log(`\n✨ Content pull completed!\n`);
}

// Note: CLI execution moved to src/cli/bin/pull-content.ts
// This file now only exports the function for programmatic use

export { main as pullContent };
