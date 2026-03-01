#!/usr/bin/env node
/**
 * LeadCMS Push All CLI Entry Point
 * Pushes both content and media
 */

import 'dotenv/config';
import { pushLeadCMSContent } from '../../scripts/push-leadcms-content.js';
import { pushMedia } from '../../scripts/push-media.js';
import { pushEmailTemplates } from '../../scripts/push-email-templates.js';
import { pushSettings } from '../../scripts/push-settings.js';
import { requireAuthenticatedUser } from '../../scripts/leadcms-helpers.js';
import { initVerboseFromArgs } from '../../lib/logger.js';
import { startSpinner } from '../../lib/spinner.js';

const args = process.argv.slice(2);
initVerboseFromArgs(args);

// Parse common flags
const force = args.includes('--force') || args.includes('-f');
const dryRun = args.includes('--dry-run') || args.includes('-d');
const allowDelete = args.includes('--delete');

// Parse content-specific flags
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

// Parse media-specific flags
let scopeUid: string | undefined;
const scopeIndex = args.findIndex(arg => arg === '--scope' || arg === '-s');
if (scopeIndex !== -1 && args[scopeIndex + 1]) {
  scopeUid = args[scopeIndex + 1];
}

async function pushAll() {
  await requireAuthenticatedUser();

  const spinner = startSpinner('Pushing to LeadCMS…');
  try {
    spinner.update('Pushing settings…');

    // Push settings first — other content may depend on settings
    await pushSettings({
      dryRun,
      force,
    });

    spinner.update('Pushing content…');

    // Push content
    await pushLeadCMSContent({
      statusOnly: false,
      force,
      targetId,
      targetSlug,
      dryRun,
      allowDelete
    });

    console.log('\n📧 Pushing email templates...');
    spinner.update('Pushing email templates…');
    await pushEmailTemplates({
      dryRun,
      force,
      allowDelete
    });

    console.log('\n📷 Pushing media...');
    spinner.update('Pushing media…');
    await pushMedia({
      dryRun,
      force,
      scopeUid,
      allowDelete
    });

    spinner.succeed('Push operation completed successfully!');
  } catch (error: any) {
    spinner.fail('Push operation failed');
    console.error(error.message);
    process.exit(1);
  }
}

pushAll();
