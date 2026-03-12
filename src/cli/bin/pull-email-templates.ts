#!/usr/bin/env node
/**
 * LeadCMS Pull Email Templates CLI Entry Point
 */

import { pullEmailTemplates } from '../../scripts/pull-email-templates.js';
import { resolveIdentity } from '../../scripts/leadcms-helpers.js';
import { initVerboseFromArgs } from '../../lib/logger.js';
import { startSpinner } from '../../lib/spinner.js';
import { parseRemoteFlag } from './remote-flag.js';

const args = process.argv.slice(2);
initVerboseFromArgs(args);
const remoteContext = parseRemoteFlag(args);

let targetId: string | undefined;
const idIndex = args.findIndex(arg => arg === '--id');
if (idIndex !== -1 && args[idIndex + 1]) {
  targetId = args[idIndex + 1];
}

const reset = args.includes('--reset');

await resolveIdentity();

const spinner = startSpinner('Pulling email templates from LeadCMS…');
pullEmailTemplates({ targetId, reset, remoteContext })
  .then(() => {
    spinner.stop();
    process.exit(0);
  })
  .catch((error: any) => {
    spinner.fail('Email template pull failed');
    console.error(error.message);
    process.exit(1);
  });
