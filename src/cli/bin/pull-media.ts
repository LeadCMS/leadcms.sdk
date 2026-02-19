#!/usr/bin/env node
/**
 * LeadCMS Pull Media CLI Entry Point
 */

import { pullMedia } from '../../scripts/pull-media.js';
import { initVerboseFromArgs } from '../../lib/logger.js';

const args = process.argv.slice(2);
initVerboseFromArgs(args);
const reset = args.includes('--reset');

pullMedia({ reset }).catch((error: any) => {
  console.error('Error running LeadCMS pull media:', error.message);
  process.exit(1);
});
