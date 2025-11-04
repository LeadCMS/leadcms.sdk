#!/usr/bin/env node
/**
 * LeadCMS Pull All CLI Entry Point
 */

import { pullAll } from '../../scripts/pull-all.js';

pullAll().catch((error: any) => {
  console.error('Error running LeadCMS pull:', error.message);
  process.exit(1);
});
