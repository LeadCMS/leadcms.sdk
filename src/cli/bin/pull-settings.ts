#!/usr/bin/env node
/**
 * LeadCMS Pull Settings CLI Entry Point
 */

import 'dotenv/config';
import { pullSettings } from '../../scripts/pull-settings.js';
import { resolveIdentity } from '../../scripts/leadcms-helpers.js';
import { initVerboseFromArgs } from '../../lib/logger.js';
import { startSpinner } from '../../lib/spinner.js';

const args = process.argv.slice(2);
initVerboseFromArgs(args);

// Parse --name flag
let targetName: string | undefined;
const nameIndex = args.findIndex(arg => arg === '--name');
if (nameIndex !== -1 && args[nameIndex + 1]) {
  targetName = args[nameIndex + 1];
}

const reset = args.includes('--reset');

await resolveIdentity();

const spinner = startSpinner('Pulling settings from LeadCMS…');
pullSettings({ targetName, reset })
  .then(() => {
    spinner.stop();
    process.exit(0);
  })
  .catch((error: any) => {
    spinner.fail('Settings pull failed');
    console.error(error.message);
    process.exit(1);
  });
