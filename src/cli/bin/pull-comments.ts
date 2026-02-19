#!/usr/bin/env node
/**
 * LeadCMS Pull Comments CLI Entry Point
 */

import { pullComments } from '../../scripts/pull-comments.js';
import { initVerboseFromArgs } from '../../lib/logger.js';

const args = process.argv.slice(2);
initVerboseFromArgs(args);
const reset = args.includes('--reset');

pullComments({ reset }).catch((error: any) => {
  console.error('Error running LeadCMS pull comments:', error.message);
  process.exit(1);
});
