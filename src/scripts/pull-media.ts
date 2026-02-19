#!/usr/bin/env node
/**
 * Pull only media from LeadCMS (no content, no comments)
 */

import "dotenv/config";
import axios from "axios";
import { leadCMSUrl } from "./leadcms-helpers.js";
import { setCMSConfig, isMediaSupported } from "../lib/cms-config-types.js";
import { resetMediaState } from "./pull-all.js";
import { logger } from "../lib/logger.js";

interface PullMediaOptions {
  /** When true, delete all local media files and sync tokens before pulling, effectively doing a fresh pull. */
  reset?: boolean;
}

/**
 * Main function - currently media is fetched as part of content sync
 * This is a placeholder for future dedicated media sync
 */
async function main(options: PullMediaOptions = {}): Promise<void> {
  const { reset } = options;

  console.log(`\n🖼️  LeadCMS Pull Media\n`);

  // Handle --reset flag: clear media before pulling
  if (reset) {
    console.log(`🔄 Resetting media state...\n`);
    await resetMediaState();
  }

  // Check if media is supported
  try {
    logger.verbose(`🔍 Checking CMS configuration...`);
    const configUrl = new URL('/api/config', leadCMSUrl).toString();
    const response = await axios.get(configUrl, { timeout: 10000 });

    if (response.data) {
      setCMSConfig(response.data);

      if (!isMediaSupported()) {
        console.log(`⏭️  Media entity not supported by this LeadCMS instance`);
        return;
      }

      logger.verbose(`✅ Media entity supported\n`);
    }
  } catch (error: any) {
    console.warn(`⚠️  Could not fetch CMS config: ${error.message}`);
    console.warn(`⚠️  Assuming media is supported (backward compatibility)\n`);
  }

  // Import and run content fetch (which includes media)
  const { fetchLeadCMSContent } = await import('./fetch-leadcms-content.js');
  await fetchLeadCMSContent();

  console.log(`\n✨ Media pull completed!\n`);
}

// Note: CLI execution moved to src/cli/bin/pull-media.ts
// This file now only exports the function for programmatic use

export { main as pullMedia };
