#!/usr/bin/env node
/**
 * LeadCMS Push Content CLI Entry Point
 */

import 'dotenv/config';
import { pushLeadCMSContent } from '../../scripts/push-leadcms-content.js';
import { requireAuthenticatedUser, resolveIdentity } from '../../scripts/leadcms-helpers.js';
import { initVerboseFromArgs } from '../../lib/logger.js';
import { startSpinner } from '../../lib/spinner.js';
import { parsePushContentStatusArgs } from './content-status-args.js';
import { parseRemoteFlag } from './remote-flag.js';

const args = process.argv.slice(2);
initVerboseFromArgs(args);
const remoteContext = parseRemoteFlag(args);
const { statusOnly, statusFilter } = parsePushContentStatusArgs(args);
const force = args.includes('--force');
const dryRun = args.includes('--dry-run');
const allowDelete = args.includes('--delete');

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

const spinner = startSpinner('Pushing content to LeadCMS…');
pushLeadCMSContent({ statusOnly, force, targetId, targetSlug, statusFilter, dryRun, allowDelete, remoteContext })
  .then(() => spinner.stop())
  .catch((error: any) => {
    spinner.fail('Content push failed');
    console.error(error.message);
    process.exit(1);
  });
