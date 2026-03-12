#!/usr/bin/env node
/**
 * LeadCMS Status Settings CLI Entry Point
 */

import 'dotenv/config';
import { statusSettings } from '../../scripts/push-settings.js';
import { resolveIdentity } from '../../scripts/leadcms-helpers.js';
import { initVerboseFromArgs } from '../../lib/logger.js';
import { startSpinner } from '../../lib/spinner.js';
import { parseRemoteFlag } from './remote-flag.js';

const args = process.argv.slice(2);
initVerboseFromArgs(args);
parseRemoteFlag(args);

// Parse --name flag
let targetName: string | undefined;
const nameIndex = args.findIndex(arg => arg === '--name');
if (nameIndex !== -1 && args[nameIndex + 1]) {
  targetName = args[nameIndex + 1];
}

await resolveIdentity();

const spinner = startSpinner('Checking settings status…');
statusSettings({ targetName })
  .then(() => spinner.stop())
  .catch((error: any) => {
    spinner.fail('Failed to check settings status');
    console.error(error.message);
    process.exit(1);
  });
