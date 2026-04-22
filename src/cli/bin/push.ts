#!/usr/bin/env node
/**
 * LeadCMS Push CLI Entry Point
 */

import { pushLeadCMSContent } from '../../scripts/push-leadcms-content.js';
import { requireAuthenticatedUser, resolveIdentity } from '../../scripts/leadcms-helpers.js';
import { initVerboseFromArgs } from '../../lib/logger.js';
import { parseRemoteFlag } from './remote-flag.js';

const args = process.argv.slice(2);
initVerboseFromArgs(args);
const remoteContext = parseRemoteFlag(args);
const statusOnly = args.includes('--status');
const force = args.includes('--force');
const dryRun = args.includes('--dry-run');
const allowDelete = args.includes('--delete');
const allowConflictMarkers = args.includes('--allow-conflict-markers');

if (!statusOnly && !dryRun) {
  await requireAuthenticatedUser(remoteContext?.apiKey);
} else {
  await resolveIdentity(remoteContext?.apiKey);
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

pushLeadCMSContent({ statusOnly, force, targetId, targetSlug, dryRun, allowDelete, allowConflictMarkers, remoteContext }).catch((error: any) => {
  console.error('Error running LeadCMS push:', error.message);
  process.exit(1);
});
