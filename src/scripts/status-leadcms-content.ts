// Load environment variables first
import "dotenv/config";
import { pushLeadCMSContent } from './push-leadcms-content.js';

// Status command - just runs push with statusOnly flag
async function main(): Promise<void> {
  try {
    const args = process.argv.slice(2);

    // Parse target ID or slug
    let targetId: string | undefined;
    let targetSlug: string | undefined;
    let showDetailedPreview = false;

    const idIndex = args.findIndex(arg => arg === '--id');
    if (idIndex !== -1 && args[idIndex + 1]) {
      targetId = args[idIndex + 1];
    }

    const slugIndex = args.findIndex(arg => arg === '--slug');
    if (slugIndex !== -1 && args[slugIndex + 1]) {
      targetSlug = args[slugIndex + 1];
    }

    // Check for --preview flag
    if (args.includes('--preview')) {
      showDetailedPreview = true;
    }

    await pushLeadCMSContent({ statusOnly: true, targetId, targetSlug, showDetailedPreview });
  } catch (error: any) {
    console.error('\x1b[31mError running LeadCMS status:\x1b[0m', error.message);
    process.exit(1);
  }
}

// Note: CLI execution moved to src/cli/bin/status.ts
// This file now only exports the function for programmatic use

export { main as statusLeadCMSContent };
