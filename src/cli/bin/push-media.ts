#!/usr/bin/env node
/**
 * LeadCMS Push Media CLI Entry Point
 */

import 'dotenv/config';
import { pushMedia } from '../../scripts/push-media.js';
import { requireAuthenticatedUser, resolveIdentity } from '../../scripts/leadcms-helpers.js';
import { initVerboseFromArgs } from '../../lib/logger.js';
import { startSpinner } from '../../lib/spinner.js';

const args = process.argv.slice(2);
initVerboseFromArgs(args);
const dryRun = args.includes('--dry-run') || args.includes('-d');
const force = args.includes('--force') || args.includes('-f');
const allowDelete = args.includes('--delete');

if (!dryRun) {
  await requireAuthenticatedUser();
} else {
  await resolveIdentity();
}

// Parse scope UID
let scopeUid: string | undefined;
const scopeIndex = args.findIndex(arg => arg === '--scope' || arg === '-s');
if (scopeIndex !== -1 && args[scopeIndex + 1]) {
  scopeUid = args[scopeIndex + 1];
}

const spinner = startSpinner('Pushing media to LeadCMS…');
pushMedia({ dryRun, force, scopeUid, allowDelete })
  .then(() => spinner.stop())
  .catch((error: any) => {
    spinner.fail('Media push failed');
    console.error(error.message);
    process.exit(1);
  });
