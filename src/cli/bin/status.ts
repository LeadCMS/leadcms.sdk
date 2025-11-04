#!/usr/bin/env node
/**
 * LeadCMS Status CLI Entry Point
 */

import { statusLeadCMSContent } from '../../scripts/status-leadcms-content.js';

statusLeadCMSContent().catch((error: any) => {
  console.error('Error running LeadCMS status:', error.message);
  process.exit(1);
});
