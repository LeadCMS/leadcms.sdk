#!/usr/bin/env node
/**
 * LeadCMS Push Email Templates CLI Entry Point
 */

import { pushEmailTemplates } from '../../scripts/push-email-templates.js';
import { initVerboseFromArgs } from '../../lib/logger.js';
import { startSpinner } from '../../lib/spinner.js';

const args = process.argv.slice(2);
initVerboseFromArgs(args);

const force = args.includes('--force') || args.includes('-f');
const dryRun = args.includes('--dry-run') || args.includes('-d');
const allowDelete = args.includes('--delete');

const spinner = startSpinner('Pushing email templates to LeadCMS…');
pushEmailTemplates({ force, dryRun, allowDelete })
  .then(() => spinner.stop())
  .catch((error: any) => {
    spinner.fail('Email template push failed');
    console.error(error.message);
    process.exit(1);
  });
