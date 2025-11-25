#!/usr/bin/env node
/**
 * LeadCMS Status All CLI Entry Point
 * Shows status for both content and media
 */

import 'dotenv/config';
import { pushLeadCMSContent } from '../../scripts/push-leadcms-content.js';
import { statusMedia } from '../../scripts/push-media.js';

const args = process.argv.slice(2);

// Parse content-specific flags
let targetId: string | undefined;
let targetSlug: string | undefined;
let showDetailedPreview = false;

const idIndex = args.findIndex(arg => arg === '--id');
if (idIndex !== -1 && args[idIndex + 1]) {
  targetId = args[idIndex + 1];
}

const slugIndex = args.findIndex(arg => arg === '--slug');
if (slugIndex !== -1 && args[slugIndex + 1]) {
  targetSlug = args[slugIndex + 1];
}

if (args.includes('--preview')) {
  showDetailedPreview = true;
}

// Check for --delete flag
const showDelete = args.includes('--delete');

// Parse media-specific flags
let scopeUid: string | undefined;
const scopeIndex = args.findIndex(arg => arg === '--scope' || arg === '-s');
if (scopeIndex !== -1 && args[scopeIndex + 1]) {
  scopeUid = args[scopeIndex + 1];
}

async function statusAll() {
  try {
    console.log('📊 Checking status...\n');

    // Check content status
    console.log('📝 Content Status:');
    console.log('─'.repeat(80));
    await pushLeadCMSContent({
      statusOnly: true,
      targetId,
      targetSlug,
      showDetailedPreview,
      showDelete
    });

    console.log('\n📷 Media Status:');
    console.log('─'.repeat(80));
    await statusMedia({ scopeUid, showDelete });

  } catch (error: any) {
    console.error('\n❌ Status check failed:', error.message);
    process.exit(1);
  }
}

statusAll();
