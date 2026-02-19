#!/usr/bin/env node
/**
 * LeadCMS Media Status CLI Entry Point
 */

import 'dotenv/config';
import { statusMedia } from '../../scripts/push-media.js';
import { initVerboseFromArgs } from '../../lib/logger.js';

const args = process.argv.slice(2);
initVerboseFromArgs(args);

// Parse scope UID
let scopeUid: string | undefined;
const scopeIndex = args.findIndex(arg => arg === '--scope' || arg === '-s');
if (scopeIndex !== -1 && args[scopeIndex + 1]) {
  scopeUid = args[scopeIndex + 1];
}

// Check for --delete flag
const showDelete = args.includes('--delete');

statusMedia({ scopeUid, showDelete }).catch((error: any) => {
  console.error('Error checking media status:', error.message);
  process.exit(1);
});
