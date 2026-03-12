#!/usr/bin/env node
/**
 * Pull only content from LeadCMS (no media, no comments)
 */

import "dotenv/config";
import axios from "axios";
import { leadCMSUrl } from "./leadcms-helpers.js";
import { setCMSConfig, isContentSupported } from "../lib/cms-config-types.js";
import { pullLeadCMSContent } from "./pull-leadcms-content.js";
import { leadCMSDataService } from "../lib/data-service.js";
import { saveContentFile } from "../lib/content-transformation.js";
import { CONTENT_DIR, fetchContentTypes } from "./leadcms-helpers.js";
import { resetContentState } from "./pull-all.js";
import { logger } from "../lib/logger.js";
import { filterContentOperations, getContentStatusData, type ContentOperations, type MatchOperation } from "./push-leadcms-content.js";
import type { RemoteContext } from "../lib/remote-context.js";

interface PullContentOptions {
  targetId?: string;
  targetSlug?: string;
  statusFilter?: string[];
  /** When true, delete all local content files and sync tokens before pulling, effectively doing a fresh pull. */
  reset?: boolean;
  /** When true, skip three-way merge and always overwrite local files with remote content. */
  force?: boolean;
  /** Remote context for multi-remote support. */
  remoteContext?: RemoteContext;
}

interface PullTargetItem {
  id: number;
  slug?: string;
}

interface PullTargetResult {
  items: PullTargetItem[];
  skipped: MatchOperation[];
}

export function getPullTargetsFromOperations(operations: ContentOperations): PullTargetResult {
  const items: PullTargetItem[] = [];
  const skipped: MatchOperation[] = [];
  const seenIds = new Set<number>();

  for (const operation of operations.create) {
    skipped.push(operation);
  }

  const remoteBackedOperations = [
    ...operations.update,
    ...operations.rename,
    ...operations.typeChange,
    ...operations.conflict,
    ...operations.delete,
  ];

  for (const operation of remoteBackedOperations) {
    const id = operation.remote?.id;
    if (typeof id !== 'number') {
      skipped.push(operation);
      continue;
    }

    if (seenIds.has(id)) {
      continue;
    }

    seenIds.add(id);
    items.push({ id, slug: operation.remote?.slug || operation.local.slug });
  }

  return { items, skipped };
}

async function pullFilteredContent(targetId?: string, targetSlug?: string, statusFilter?: string[]): Promise<boolean> {
  const hasFilter = !!(targetId || targetSlug || (statusFilter && statusFilter.length > 0));
  if (!hasFilter) {
    return false;
  }

  const { operations } = await getContentStatusData({ showDelete: true });
  const filteredOperations = filterContentOperations(operations, targetId, targetSlug, statusFilter);
  const { items, skipped } = getPullTargetsFromOperations(filteredOperations);

  if (items.length === 0) {
    if (skipped.length > 0) {
      console.log(`⚠️  ${skipped.length} matching local-only file(s) have no remote content to pull.`);
      for (const operation of skipped) {
        console.log(`   - ${operation.local.slug}`);
      }
    } else {
      console.log(`✅ No remote-backed content matched the requested filter.`);
    }
    return true;
  }

  console.log(`🎯 Pulling ${items.length} content item(s) from LeadCMS...`);

  if (skipped.length > 0) {
    console.log(`⚠️  Skipping ${skipped.length} local-only file(s) with no remote content to pull.`);
  }

  const typeMap = await fetchContentTypes();

  for (const item of items) {
    const content = await leadCMSDataService.getContentById(item.id);
    if (!content) {
      console.warn(`⚠️  Content not found for ID ${item.id}`);
      continue;
    }

    await saveContentFile({
      content,
      typeMap,
      contentDir: CONTENT_DIR,
    });

    console.log(`✅ Pulled: ${content.slug} (${content.type})`);
  }

  console.log(`\n✨ Content pull completed!\n`);
  return true;
}

/**
 * Main function
 */
async function main(options: PullContentOptions = {}): Promise<void> {
  const { targetId, targetSlug, statusFilter, reset, force, remoteContext: remoteCtx } = options;
  const effectiveUrl = remoteCtx?.url || leadCMSUrl;

  console.log(`\n📄 LeadCMS Pull Content\n`);

  // Handle --reset flag: clear content before pulling
  if (reset) {
    console.log(`🔄 Resetting content state...\n`);
    await resetContentState(remoteCtx);
  }

  // If pulling targeted or filtered content
  if (targetId || targetSlug || (statusFilter && statusFilter.length > 0)) {
    if (statusFilter && statusFilter.length > 0) {
      const handled = await pullFilteredContent(targetId, targetSlug, statusFilter);
      if (handled) {
        return;
      }
    }

    console.log(`🎯 Pulling specific content: ${targetId ? `ID ${targetId}` : `slug "${targetSlug}"`}`);

    try {
      let content = null;

      if (targetId) {
        const id = parseInt(targetId, 10);
        if (isNaN(id)) {
          console.error(`❌ Invalid ID: ${targetId}`);
          return;
        }
        content = await leadCMSDataService.getContentById(id);
      } else if (targetSlug) {
        content = await leadCMSDataService.getContentBySlug(targetSlug);
      }

      if (!content) {
        console.log(`⚠️  Content not found: ${targetId ? `ID ${targetId}` : `slug "${targetSlug}"`}`);
        return;
      }

      console.log(`✅ Found content: ${content.title} (${content.type})`);
      console.log(`   - Slug: ${content.slug}`);
      console.log(`   - Language: ${content.language || 'default'}`);
      console.log(`   - Type: ${content.type}`);
      console.log(`   - Last updated: ${content.updatedAt || 'unknown'}`);

      // Fetch content types for transformation
      const typeMap = await fetchContentTypes();

      // Save the content file (force overwrite)
      await saveContentFile({
        content,
        typeMap,
        contentDir: CONTENT_DIR,
      });

      console.log(`\n✅ Content file saved successfully!`);
      console.log(`   Location: ${CONTENT_DIR}/${content.language || 'default'}/${content.type}/${content.slug}`);
      console.log(`\n✨ Pull completed!\n`);
      return;
    } catch (error: any) {
      console.error(`❌ Failed to pull content:`, error.message);
      throw error;
    }
  }

  // Check if content is supported
  try {
    logger.verbose(`🔍 Checking CMS configuration...`);
    const configUrl = new URL('/api/config', effectiveUrl).toString();
    const response = await axios.get(configUrl, { timeout: 10000 });

    if (response.data) {
      setCMSConfig(response.data);

      if (!isContentSupported()) {
        console.log(`⏭️  Content entity not supported by this LeadCMS instance`);
        return;
      }

      logger.verbose(`✅ Content entity supported\n`);
    }
  } catch (error: any) {
    console.warn(`⚠️  Could not fetch CMS config: ${error.message}`);
    console.warn(`⚠️  Assuming content is supported (backward compatibility)\n`);
  }

  // Fetch content only (no media)
  await pullLeadCMSContent({ forceOverwrite: force, remoteContext: remoteCtx });

  console.log(`\n✨ Content pull completed!\n`);
}

// Note: CLI execution moved to src/cli/bin/pull-content.ts
// This file now only exports the function for programmatic use

export { main as pullContent };
