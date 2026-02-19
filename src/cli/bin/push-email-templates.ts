#!/usr/bin/env node
/**
 * LeadCMS Push Email Templates CLI Entry Point
 */

import { pushEmailTemplates } from '../../scripts/push-email-templates.js';
import { initVerboseFromArgs } from '../../lib/logger.js';

const args = process.argv.slice(2);
initVerboseFromArgs(args);

const force = args.includes('--force') || args.includes('-f');
const dryRun = args.includes('--dry-run') || args.includes('-d');
const allowDelete = args.includes('--delete');

pushEmailTemplates({ force, dryRun, allowDelete }).catch((error: any) => {
  console.error('Error running LeadCMS push email templates:', error.message);
  process.exit(1);
});
