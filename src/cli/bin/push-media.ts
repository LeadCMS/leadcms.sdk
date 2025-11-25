#!/usr/bin/env node
/**
 * LeadCMS Push Media CLI Entry Point
 */

import 'dotenv/config';
import { pushMedia } from '../../scripts/push-media.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || args.includes('-d');
const force = args.includes('--force') || args.includes('-f');
const allowDelete = args.includes('--delete');

// Parse scope UID
let scopeUid: string | undefined;
const scopeIndex = args.findIndex(arg => arg === '--scope' || arg === '-s');
if (scopeIndex !== -1 && args[scopeIndex + 1]) {
  scopeUid = args[scopeIndex + 1];
}

pushMedia({ dryRun, force, scopeUid, allowDelete }).catch((error: any) => {
  console.error('Error pushing media:', error.message);
  process.exit(1);
});
