#!/usr/bin/env node
/**
 * LeadCMS Media Status CLI Entry Point
 */

import 'dotenv/config';
import { statusMedia } from '../../scripts/push-media.js';
import { resolveIdentity } from '../../scripts/leadcms-helpers.js';
import { initVerboseFromArgs } from '../../lib/logger.js';
import { startSpinner } from '../../lib/spinner.js';

const args = process.argv.slice(2);
initVerboseFromArgs(args);

// Parse scope UID
let scopeUid: string | undefined;
const scopeIndex = args.findIndex(arg => arg === '--scope' || arg === '-s');
if (scopeIndex !== -1 && args[scopeIndex + 1]) {
  scopeUid = args[scopeIndex + 1];
}

// Check for --delete flag
const showDelete = args.includes('--delete');

await resolveIdentity();

const spinner = startSpinner('Checking media status…');
statusMedia({ scopeUid, showDelete })
  .then(() => spinner.stop())
  .catch((error: any) => {
    spinner.fail('Failed to check media status');
    console.error(error.message);
    process.exit(1);
  });
