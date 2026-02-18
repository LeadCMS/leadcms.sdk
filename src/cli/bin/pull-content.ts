#!/usr/bin/env node
/**
 * LeadCMS Pull Content CLI Entry Point
 */

import { pullContent } from '../../scripts/pull-content.js';

const args = process.argv.slice(2);

// Parse target ID or slug
let targetId: string | undefined;
let targetSlug: string | undefined;

const idIndex = args.findIndex(arg => arg === '--id');
if (idIndex !== -1 && args[idIndex + 1]) {
  targetId = args[idIndex + 1];
}

const slugIndex = args.findIndex(arg => arg === '--slug');
if (slugIndex !== -1 && args[slugIndex + 1]) {
  targetSlug = args[slugIndex + 1];
}

const reset = args.includes('--reset');

pullContent({ targetId, targetSlug, reset }).catch((error: any) => {
  console.error('Error running LeadCMS pull content:', error.message);
  process.exit(1);
});
