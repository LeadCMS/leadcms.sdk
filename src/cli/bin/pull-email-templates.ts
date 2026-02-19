#!/usr/bin/env node
/**
 * LeadCMS Pull Email Templates CLI Entry Point
 */

import { pullEmailTemplates } from '../../scripts/pull-email-templates.js';
import { initVerboseFromArgs } from '../../lib/logger.js';
import { startSpinner } from '../../lib/spinner.js';

const args = process.argv.slice(2);
initVerboseFromArgs(args);

let targetId: string | undefined;
const idIndex = args.findIndex(arg => arg === '--id');
if (idIndex !== -1 && args[idIndex + 1]) {
  targetId = args[idIndex + 1];
}

const reset = args.includes('--reset');

const spinner = startSpinner('Pulling email templates from LeadCMS…');
pullEmailTemplates({ targetId, reset })
  .then(() => spinner.stop())
  .catch((error: any) => {
    spinner.fail('Email template pull failed');
    console.error(error.message);
    process.exit(1);
  });
