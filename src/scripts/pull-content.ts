#!/usr/bin/env node
/**
 * Pull only content from LeadCMS (no media, no comments)
 */

import "dotenv/config";
import axios from "axios";
import { leadCMSUrl } from "./leadcms-helpers.js";
import { setCMSConfig, isContentSupported } from "../lib/cms-config-types.js";
import { fetchLeadCMSContent } from "./fetch-leadcms-content.js";

/**
 * Main function
 */
async function main(): Promise<void> {
  console.log(`\n📄 LeadCMS Pull Content\n`);

  // Check if content is supported
  try {
    console.log(`🔍 Checking CMS configuration...`);
    const configUrl = new URL('/api/config', leadCMSUrl).toString();
    const response = await axios.get(configUrl, { timeout: 10000 });

    if (response.data) {
      setCMSConfig(response.data);

      if (!isContentSupported()) {
        console.log(`⏭️  Content entity not supported by this LeadCMS instance`);
        return;
      }

      console.log(`✅ Content entity supported\n`);
    }
  } catch (error: any) {
    console.warn(`⚠️  Could not fetch CMS config: ${error.message}`);
    console.warn(`⚠️  Assuming content is supported (backward compatibility)\n`);
  }

  // Fetch content and media
  await fetchLeadCMSContent();

  console.log(`\n✨ Content pull completed!\n`);
}

// If this script is run directly, execute the main function
if (typeof import.meta !== 'undefined' && process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error("Error running LeadCMS content pull:", error.message);
    process.exit(1);
  });
}

export { main as pullContent };
