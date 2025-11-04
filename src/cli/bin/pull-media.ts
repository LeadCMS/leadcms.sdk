#!/usr/bin/env node
/**
 * LeadCMS Pull Media CLI Entry Point
 */

import { pullMedia } from '../../scripts/pull-media.js';

pullMedia().catch((error: any) => {
  console.error('Error running LeadCMS pull media:', error.message);
  process.exit(1);
});
