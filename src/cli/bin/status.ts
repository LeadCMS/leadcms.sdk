#!/usr/bin/env node
/**
 * LeadCMS Status CLI Entry Point
 */

import { statusLeadCMSContent } from '../../scripts/status-leadcms-content.js';
import { resolveIdentity } from '../../scripts/leadcms-helpers.js';
import { initVerboseFromArgs } from '../../lib/logger.js';

initVerboseFromArgs();
await resolveIdentity();
statusLeadCMSContent().catch((error: any) => {
  console.error('Error running LeadCMS status:', error.message);
  process.exit(1);
});
