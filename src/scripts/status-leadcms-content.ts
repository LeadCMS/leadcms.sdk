// Load environment variables first
import "dotenv/config";
import { pushLeadCMSContent } from './push-leadcms-content.js';

// Status command - just runs push with statusOnly flag
async function main(): Promise<void> {
  try {
    await pushLeadCMSContent({ statusOnly: true });
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
