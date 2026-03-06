#!/usr/bin/env node
/**
 * LeadCMS Push Comments CLI Entry Point
 */

import { pushComments } from '../../scripts/push-comments.js';
import { requireAuthenticatedUser, resolveIdentity } from '../../scripts/leadcms-helpers.js';
import { initVerboseFromArgs } from '../../lib/logger.js';
import { startSpinner } from '../../lib/spinner.js';

const args = process.argv.slice(2);
initVerboseFromArgs(args);

const force = args.includes('--force') || args.includes('-f');
const dryRun = args.includes('--dry-run') || args.includes('-d');
const allowDelete = args.includes('--delete');

let targetId: string | undefined;
const idIndex = args.findIndex(arg => arg === '--id');
if (idIndex !== -1 && args[idIndex + 1]) {
  targetId = args[idIndex + 1];
}

if (!dryRun) {
  await requireAuthenticatedUser();
} else {
  await resolveIdentity();
}

const spinner = startSpinner('Pushing comments to LeadCMS…');
pushComments({ force, dryRun, allowDelete, targetId })
  .then(() => spinner.stop())
  .catch((error: any) => {
    spinner.fail('Comment push failed');
    console.error(error.message);
    process.exit(1);
  });
