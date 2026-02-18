#!/usr/bin/env node
/**
 * LeadCMS Init CLI Entry Point
 */

import { initLeadCMS } from '../../scripts/init-leadcms.js';

initLeadCMS().catch((error) => {
  console.error('❌ Initialization failed:', error.message);
  process.exit(1);
});
