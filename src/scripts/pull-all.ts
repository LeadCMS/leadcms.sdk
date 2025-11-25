#!/usr/bin/env node
/**
 * Orchestrator for pulling all content from LeadCMS
 * Checks entity support before fetching content, media, and comments
 */

import "dotenv/config";
import axios from "axios";
import { leadCMSUrl } from "./leadcms-helpers.js";
import { setCMSConfig, isContentSupported, isMediaSupported, isCommentsSupported } from "../lib/cms-config-types.js";

interface PullAllOptions {
  targetId?: string;
  targetSlug?: string;
}

/**
 * Fetch CMS config to determine which entities are supported
 */
async function fetchAndCacheCMSConfig(): Promise<{
  content: boolean;
  media: boolean;
  comments: boolean;
}> {
  try {
    console.log(`🔍 Checking CMS configuration...`);
    const configUrl = new URL('/api/config', leadCMSUrl).toString();
    const response = await axios.get(configUrl, { timeout: 10000 });

    if (response.data) {
      setCMSConfig(response.data);
      const support = {
        content: isContentSupported(),
        media: isMediaSupported(),
        comments: isCommentsSupported(),
      };

      console.log(`✅ CMS Configuration received`);
      console.log(`   - Content: ${support.content ? '✓' : '✗'}`);
      console.log(`   - Media: ${support.media ? '✓' : '✗'}`);
      console.log(`   - Comments: ${support.comments ? '✓' : '✗'}`);
      console.log('');

      return support;
    }
  } catch (error: any) {
    console.warn(`⚠️  Could not fetch CMS config: ${error.message}`);
    console.warn(`⚠️  Assuming all entities are supported (backward compatibility)\n`);
  }

  return { content: false, media: false, comments: false };
}

/**
 * Main orchestrator function
 */
async function main(options: PullAllOptions = {}): Promise<void> {
  const { targetId, targetSlug } = options;

  // If pulling specific content by ID or slug, use pull-content logic directly
  if (targetId || targetSlug) {
    console.log(`\n🚀 LeadCMS Pull - Fetching specific content\n`);
    const { pullContent } = await import('./pull-content.js');
    await pullContent({ targetId, targetSlug });
    return;
  }

  console.log(`\n🚀 LeadCMS Pull - Fetching all content\n`);

  // Check which entities are supported
  const { content, media, comments } = await fetchAndCacheCMSConfig();

  if (!content && !media && !comments) {
    console.log(`⏭️  No supported entities found - nothing to sync`);
    return;
  }

  // Import and run fetch functions for supported entities
  const fetchPromises: Promise<void>[] = [];

  if (content || media) {
    console.log(`📄 Fetching content and media...`);
    const { fetchLeadCMSContent } = await import('./fetch-leadcms-content.js');
    fetchPromises.push(fetchLeadCMSContent());
  }

  if (comments) {
    console.log(`💬 Fetching comments...`);
    const { fetchLeadCMSComments } = await import('./fetch-leadcms-comments.js');
    fetchPromises.push(fetchLeadCMSComments());
  }

  // Wait for all fetches to complete
  try {
    await Promise.all(fetchPromises);
    console.log(`\n✨ Pull completed successfully!\n`);
  } catch (error: any) {
    console.error(`\n❌ Pull failed: ${error.message}\n`);
    throw error;
  }
}

// Export the main function
export { main as pullAll };

// Note: CLI execution moved to src/cli/bin/pull-all.ts
// This file now only exports the function for programmatic use
