#!/usr/bin/env node
/**
 * LeadCMS Status Content CLI Entry Point
 */

import 'dotenv/config';
import { pushLeadCMSContent } from '../../scripts/push-leadcms-content.js';
import { initVerboseFromArgs } from '../../lib/logger.js';

const args = process.argv.slice(2);
initVerboseFromArgs(args);

// Parse target ID or slug
let targetId: string | undefined;
let targetSlug: string | undefined;
let showDetailedPreview = false;

const idIndex = args.findIndex(arg => arg === '--id');
if (idIndex !== -1 && args[idIndex + 1]) {
  targetId = args[idIndex + 1];
}

const slugIndex = args.findIndex(arg => arg === '--slug');
if (slugIndex !== -1 && args[slugIndex + 1]) {
  targetSlug = args[slugIndex + 1];
}

// Check for --preview flag
if (args.includes('--preview')) {
  showDetailedPreview = true;
}

// Check for --delete flag
const showDelete = args.includes('--delete');

pushLeadCMSContent({ statusOnly: true, targetId, targetSlug, showDetailedPreview, showDelete }).catch((error: any) => {
  console.error('Error running LeadCMS status content:', error.message);
  process.exit(1);
});
