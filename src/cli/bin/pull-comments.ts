#!/usr/bin/env node
/**
 * LeadCMS Pull Comments CLI Entry Point
 */

import { pullComments } from '../../scripts/pull-comments.js';

pullComments().catch((error: any) => {
  console.error('Error running LeadCMS pull comments:', error.message);
  process.exit(1);
});
