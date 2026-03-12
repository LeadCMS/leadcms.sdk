#!/usr/bin/env node
/**
 * LeadCMS Pull Content CLI Entry Point
 */

import { pullContent } from '../../scripts/pull-content.js';
import { resolveIdentity } from '../../scripts/leadcms-helpers.js';
import { initVerboseFromArgs } from '../../lib/logger.js';
import { startSpinner } from '../../lib/spinner.js';
import { parseContentStatusFilter } from './content-status-args.js';
import { parseRemoteFlag } from './remote-flag.js';

const args = process.argv.slice(2);
initVerboseFromArgs(args);
const remoteContext = parseRemoteFlag(args);

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
const force = args.includes('--force') || args.includes('-f');
const statusFilter = parseContentStatusFilter(args);

await resolveIdentity(remoteContext?.apiKey);

const spinner = startSpinner('Pulling content from LeadCMS…');
pullContent({ targetId, targetSlug, statusFilter, reset, force, remoteContext })
  .then(() => {
    spinner.stop();
    process.exit(0);
  })
  .catch((error: any) => {
    spinner.fail('Content pull failed');
    console.error(error.message);
    process.exit(1);
  });
