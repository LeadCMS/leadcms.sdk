#!/usr/bin/env node
/**
 * LeadCMS Push Settings CLI Entry Point
 */

import 'dotenv/config';
import { pushSettings } from '../../scripts/push-settings.js';
import { requireAuthenticatedUser, resolveIdentity } from '../../scripts/leadcms-helpers.js';
import { initVerboseFromArgs } from '../../lib/logger.js';
import { startSpinner } from '../../lib/spinner.js';

const args = process.argv.slice(2);
initVerboseFromArgs(args);

const force = args.includes('--force') || args.includes('-f');
const dryRun = args.includes('--dry-run') || args.includes('-d');

// Parse --name flag
let targetName: string | undefined;
const nameIndex = args.findIndex(arg => arg === '--name');
if (nameIndex !== -1 && args[nameIndex + 1]) {
  targetName = args[nameIndex + 1];
}

if (!dryRun) {
  await requireAuthenticatedUser();
} else {
  await resolveIdentity();
}

const spinner = startSpinner('Pushing settings to LeadCMS…');
pushSettings({ targetName, dryRun, force })
  .then(() => spinner.stop())
  .catch((error: any) => {
    spinner.fail('Settings push failed');
    console.error(error.message);
    process.exit(1);
  });
