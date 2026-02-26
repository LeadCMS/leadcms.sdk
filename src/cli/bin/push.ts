#!/usr/bin/env node
/**
 * LeadCMS Push CLI Entry Point
 */

import { pushLeadCMSContent } from '../../scripts/push-leadcms-content.js';
import { requireAuthenticatedUser, resolveIdentity } from '../../scripts/leadcms-helpers.js';
import { initVerboseFromArgs } from '../../lib/logger.js';

const args = process.argv.slice(2);
initVerboseFromArgs(args);
const statusOnly = args.includes('--status');
const force = args.includes('--force');
const dryRun = args.includes('--dry-run');

if (!statusOnly && !dryRun) {
  await requireAuthenticatedUser();
} else {
  await resolveIdentity();
}

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

pushLeadCMSContent({ statusOnly, force, targetId, targetSlug, dryRun }).catch((error: any) => {
  console.error('Error running LeadCMS push:', error.message);
  process.exit(1);
});
