#!/usr/bin/env node
/**
 * LeadCMS Status Email Templates CLI Entry Point
 */

import 'dotenv/config';
import { statusEmailTemplates } from '../../scripts/push-email-templates.js';
import { resolveIdentity } from '../../scripts/leadcms-helpers.js';
import { initVerboseFromArgs } from '../../lib/logger.js';
import { startSpinner } from '../../lib/spinner.js';

const args = process.argv.slice(2);
initVerboseFromArgs(args);

// Parse target ID
let targetId: string | undefined;
const idIndex = args.findIndex(arg => arg === '--id');
if (idIndex !== -1 && args[idIndex + 1]) {
    targetId = args[idIndex + 1];
}

// Check for --preview flag
const showDetailedPreview = args.includes('--preview');

// Check for --delete flag
const showDelete = args.includes('--delete');

await resolveIdentity();

const spinner = startSpinner('Checking email template status…');
statusEmailTemplates({ showDelete, targetId, showDetailedPreview })
    .then(() => spinner.stop())
    .catch((error: any) => {
        spinner.fail('Failed to check email template status');
        console.error(error.message);
        process.exit(1);
    });
