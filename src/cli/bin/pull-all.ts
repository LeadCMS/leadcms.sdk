#!/usr/bin/env node
/**
 * LeadCMS Pull All CLI Entry Point
 */

import { pullAll } from '../../scripts/pull-all.js';
import { initVerboseFromArgs } from '../../lib/logger.js';

const args = process.argv.slice(2);
initVerboseFromArgs(args);

// Parse target ID or slug
let targetId: string | undefined;
let targetSlug: string | undefined;
let reset = false;

const idIndex = args.findIndex(arg => arg === '--id');
if (idIndex !== -1 && args[idIndex + 1]) {
  targetId = args[idIndex + 1];
}

const slugIndex = args.findIndex(arg => arg === '--slug');
if (slugIndex !== -1 && args[slugIndex + 1]) {
  targetSlug = args[slugIndex + 1];
}

if (args.includes('--reset')) {
  reset = true;
}

pullAll({ targetId, targetSlug, reset }).catch((error: any) => {
  console.error('Error running LeadCMS pull:', error.message);
  process.exit(1);
});
