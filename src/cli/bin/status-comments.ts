#!/usr/bin/env node
/**
 * LeadCMS Status Comments CLI Entry Point
 */

import 'dotenv/config';
import { statusComments } from '../../scripts/push-comments.js';
import { resolveIdentity } from '../../scripts/leadcms-helpers.js';
import { initVerboseFromArgs } from '../../lib/logger.js';
import { startSpinner } from '../../lib/spinner.js';
import { parseRemoteFlag } from './remote-flag.js';

const args = process.argv.slice(2);
initVerboseFromArgs(args);
const remoteContext = parseRemoteFlag(args);

const showDelete = args.includes('--delete');
const showDetailedPreview = args.includes('--preview');

let targetId: string | undefined;
const idIndex = args.findIndex(arg => arg === '--id');
if (idIndex !== -1 && args[idIndex + 1]) {
  targetId = args[idIndex + 1];
}

await resolveIdentity(remoteContext?.apiKey);

const spinner = startSpinner('Checking comment status…');
statusComments({ showDelete, targetId, showDetailedPreview, remoteContext })
  .then(() => spinner.stop())
  .catch((error: any) => {
    spinner.fail('Failed to check comment status');
    console.error(error.message);
    process.exit(1);
  });
