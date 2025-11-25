#!/usr/bin/env node
/**
 * LeadCMS Push Content CLI Entry Point
 */

import 'dotenv/config';
import { pushLeadCMSContent } from '../../scripts/push-leadcms-content.js';

const args = process.argv.slice(2);
const statusOnly = args.includes('--status');
const force = args.includes('--force');
const dryRun = args.includes('--dry-run');
const allowDelete = args.includes('--delete');

// Parse target ID or slug
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

pushLeadCMSContent({ statusOnly, force, targetId, targetSlug, dryRun, allowDelete }).catch((error: any) => {
  console.error('Error running LeadCMS push content:', error.message);
  process.exit(1);
});
