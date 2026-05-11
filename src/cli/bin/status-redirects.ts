#!/usr/bin/env node
/**
 * LeadCMS Status Redirects CLI Entry Point
 */

import 'dotenv/config';
import { statusRedirects } from '../../scripts/push-redirects.js';
import { resolveIdentity } from '../../scripts/leadcms-helpers.js';
import { initVerboseFromArgs } from '../../lib/logger.js';
import { startSpinner } from '../../lib/spinner.js';
import { parseRemoteFlag } from './remote-flag.js';

const args = process.argv.slice(2);
initVerboseFromArgs(args);
const remoteContext = parseRemoteFlag(args);

const showDelete = args.includes('--delete');

await resolveIdentity();

const spinner = startSpinner('Checking redirect status…');
statusRedirects({ showDelete, remoteContext })
  .then(() => spinner.stop())
  .catch((error: any) => {
    spinner.fail('Failed to check redirect status');
    console.error(error.message);
    process.exit(1);
  });
