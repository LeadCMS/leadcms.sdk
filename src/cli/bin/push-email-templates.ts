#!/usr/bin/env node
/**
 * LeadCMS Push Email Templates CLI Entry Point
 */

import { pushEmailTemplates } from '../../scripts/push-email-templates.js';
import { requireAuthenticatedUser, resolveIdentity } from '../../scripts/leadcms-helpers.js';
import { initVerboseFromArgs } from '../../lib/logger.js';
import { startSpinner } from '../../lib/spinner.js';

const args = process.argv.slice(2);
initVerboseFromArgs(args);

const force = args.includes('--force') || args.includes('-f');
const dryRun = args.includes('--dry-run') || args.includes('-d');
const allowDelete = args.includes('--delete');

// Parse target ID
let targetId: string | undefined;
const idIndex = args.findIndex(arg => arg === '--id');
if (idIndex !== -1 && args[idIndex + 1]) {
  targetId = args[idIndex + 1];
}

// Parse target name
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

const spinner = startSpinner('Pushing email templates to LeadCMS…');
pushEmailTemplates({ force, dryRun, allowDelete, targetId, targetName })
  .then(() => spinner.stop())
  .catch((error: any) => {
    spinner.fail('Email template push failed');
    console.error(error.message);
    process.exit(1);
  });
