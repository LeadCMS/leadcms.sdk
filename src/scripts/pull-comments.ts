#!/usr/bin/env node
/**
 * Pull only comments from LeadCMS (no content, no media)
 */

import "dotenv/config";
import axios from "axios";
import { leadCMSUrl } from "./leadcms-helpers.js";
import { setCMSConfig, isCommentsSupported } from "../lib/cms-config-types.js";
import { fetchLeadCMSComments } from "./fetch-leadcms-comments.js";

/**
 * Main function
 */
async function main(): Promise<void> {
  console.log(`\n💬 LeadCMS Pull Comments\n`);

  // Check if comments are supported
  try {
    console.log(`🔍 Checking CMS configuration...`);
    const configUrl = new URL('/api/config', leadCMSUrl).toString();
    const response = await axios.get(configUrl, { timeout: 10000 });

    if (response.data) {
      setCMSConfig(response.data);

      if (!isCommentsSupported()) {
        console.log(`⏭️  Comments entity not supported by this LeadCMS instance`);
        return;
      }

      console.log(`✅ Comments entity supported\n`);
    }
  } catch (error: any) {
    console.warn(`⚠️  Could not fetch CMS config: ${error.message}`);
    console.warn(`⚠️  Assuming comments are supported (backward compatibility)\n`);
  }

  // Fetch comments
  await fetchLeadCMSComments();

  console.log(`\n✨ Comments pull completed!\n`);
}

// If this script is run directly, execute the main function
if (typeof import.meta !== 'undefined' && process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("Error running LeadCMS comments pull:", error.message);
    process.exit(1);
  });
}

export { main as pullComments };
