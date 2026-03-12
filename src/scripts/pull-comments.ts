#!/usr/bin/env node
/**
 * Pull only comments from LeadCMS (no content, no media)
 */

import "dotenv/config";
import axios from "axios";
import { leadCMSUrl } from "./leadcms-helpers.js";
import { setCMSConfig, isCommentsSupported } from "../lib/cms-config-types.js";
import { pullLeadCMSComments } from "./pull-leadcms-comments.js";
import { resetCommentsState } from "./pull-all.js";
import { logger } from "../lib/logger.js";
import type { RemoteContext } from "../lib/remote-context.js";

interface PullCommentsOptions {
  /** When true, delete all local comment files and sync tokens before pulling, effectively doing a fresh pull. */
  reset?: boolean;
  /** Optional remote context for multi-remote sync token isolation. */
  remoteContext?: RemoteContext;
}

/**
 * Main function
 */
async function main(options: PullCommentsOptions = {}): Promise<void> {
  const { reset, remoteContext } = options;

  console.log(`\n💬 LeadCMS Pull Comments\n`);

  // Handle --reset flag: clear comments before pulling
  if (reset) {
    console.log(`🔄 Resetting comments state...\n`);
    await resetCommentsState(remoteContext);
  }

  // Check if comments are supported
  try {
    logger.verbose(`🔍 Checking CMS configuration...`);
    const configUrl = new URL('/api/config', leadCMSUrl).toString();
    const response = await axios.get(configUrl, { timeout: 10000 });

    if (response.data) {
      setCMSConfig(response.data);

      if (!isCommentsSupported()) {
        console.log(`⏭️  Comments entity not supported by this LeadCMS instance`);
        return;
      }

      logger.verbose(`✅ Comments entity supported\n`);
    }
  } catch (error: any) {
    console.warn(`⚠️  Could not fetch CMS config: ${error.message}`);
    console.warn(`⚠️  Assuming comments are supported (backward compatibility)\n`);
  }

  // Fetch comments
  await pullLeadCMSComments(remoteContext);

  console.log(`\n✨ Comments pull completed!\n`);
}

// Note: CLI execution moved to src/cli/bin/pull-comments.ts
// This file now only exports the function for programmatic use

export { main as pullComments };
