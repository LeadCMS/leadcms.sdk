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

    const idIndex = args.findIndex(arg => arg === '--id');
    if (idIndex !== -1 && args[idIndex + 1]) {
      targetId = args[idIndex + 1];
    }

    const slugIndex = args.findIndex(arg => arg === '--slug');
    if (slugIndex !== -1 && args[slugIndex + 1]) {
      targetSlug = args[slugIndex + 1];
    }

    await pushLeadCMSContent({ statusOnly: true, targetId, targetSlug });
  } catch (error: any) {
    console.error('Error running LeadCMS status:', error.message);
    process.exit(1);
  }
}

// Handle direct script execution
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { main as statusLeadCMSContent };
