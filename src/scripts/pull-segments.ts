/**
 * Pull segments from LeadCMS.
 * Only Dynamic segments are synced; Static segments are excluded.
 */

import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import axios, { AxiosResponse } from "axios";
import {
  leadCMSUrl,
  leadCMSApiKey,
  SEGMENTS_DIR,
} from "./leadcms-helpers.js";
import { syncTokenPath, type RemoteContext } from "../lib/remote-context.js";
import type { MetadataMap } from "../lib/remote-context.js";
import { resetSegmentsState } from "./pull-all.js";
import { logger } from "../lib/logger.js";
import { slugify } from "../lib/slugify.js";
import type {
  SegmentDetailsDto,
  SegmentSyncResponse,
} from "../lib/automation-types.js";
import { stripNullsAndEmptyArrays } from "../lib/automation-types.js";

interface SegmentSyncResult {
  items: SegmentDetailsDto[];
  deleted: number[];
  baseItems: Record<string, SegmentDetailsDto>;
  nextSyncToken: string;
}



async function readFileOrUndefined(filePath: string): Promise<string | undefined> {
  try {
    return (await fs.readFile(filePath, "utf8")).trim() || undefined;
  } catch {
    return undefined;
  }
}

async function readSyncToken(remoteCtx?: RemoteContext): Promise<string | undefined> {
  if (remoteCtx) {
    const tokenPath = syncTokenPath(remoteCtx, "segments");
    return readFileOrUndefined(tokenPath);
  }
  return readFileOrUndefined(path.join(SEGMENTS_DIR, ".sync-token"));
}

async function writeSyncToken(token: string, remoteCtx?: RemoteContext): Promise<void> {
  if (remoteCtx) {
    const tokenPath = syncTokenPath(remoteCtx, "segments");
    await fs.mkdir(path.dirname(tokenPath), { recursive: true });
    await fs.writeFile(tokenPath, token, "utf8");
    return;
  }
  await fs.mkdir(SEGMENTS_DIR, { recursive: true });
  await fs.writeFile(path.join(SEGMENTS_DIR, ".sync-token"), token, "utf8");
}

async function pullSegmentSync(syncToken?: string): Promise<SegmentSyncResult> {
  if (!leadCMSUrl) {
    throw new Error("LeadCMS URL is not configured.");
  }

  if (!leadCMSApiKey) {
    throw new Error("LeadCMS API key is required to pull segments.");
  }

  let allItems: SegmentDetailsDto[] = [];
  let allDeleted: number[] = [];
  let allBaseItems: Record<string, SegmentDetailsDto> = {};
  let token = syncToken || "";
  let nextSyncToken = token;

  while (true) {
    const url = new URL("/api/segments/sync", leadCMSUrl);
    url.searchParams.set("filter[limit]", "100");
    url.searchParams.set("syncToken", token);
    if (syncToken) {
      url.searchParams.set("includeBase", "true");
    }

    const res: AxiosResponse<SegmentSyncResponse> = await axios.get(url.toString(), {
      headers: { Authorization: `Bearer ${leadCMSApiKey}` },
    });

    if (res.status === 204) break;

    const data = res.data || {};
    if (data.items && Array.isArray(data.items)) {
      allItems.push(...data.items);
    }
    if (data.deleted && Array.isArray(data.deleted)) {
      allDeleted.push(...data.deleted);
    }
    if (data.baseItems && typeof data.baseItems === "object") {
      Object.assign(allBaseItems, data.baseItems);
    }

    const newSyncToken = res.headers["x-next-sync-token"] || token;
    if (!newSyncToken || newSyncToken === token) {
      nextSyncToken = newSyncToken || token;
      break;
    }

    nextSyncToken = newSyncToken;
    token = newSyncToken;
  }

  return { items: allItems, deleted: allDeleted, baseItems: allBaseItems, nextSyncToken };
}

/** Build a map of segment ID → file path from existing local files. */
async function buildSegmentIdIndex(dir: string): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return index;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const fullPath = path.join(dir, entry.name);
    try {
      const content = JSON.parse(await fs.readFile(fullPath, "utf8"));
      const id = content?._entityType === "segment" ? content?.data?.id : content?.id;
      if (id != null) {
        index.set(String(id), fullPath);
      }
    } catch { /* skip unreadable */ }
  }

  return index;
}

function getSegmentFilePath(segment: SegmentDetailsDto): string {
  const slug = slugify(segment.name) || `segment-${segment.id}`;
  return path.join(SEGMENTS_DIR, `${slug}.json`);
}

/** Strip runtime-only fields from a segment DTO for local persistence. */
function toLocalSegment(segment: SegmentDetailsDto): SegmentDetailsDto {
  const { contactCount, createdById, updatedById, createdByIp, createdByUserAgent, updatedByIp, updatedByUserAgent, contactIds, ...rest } = segment;
  return stripNullsAndEmptyArrays(rest);
}

function saveSegmentFile(segment: SegmentDetailsDto): { filePath: string; content: string } {
  const filePath = getSegmentFilePath(segment);
  const local = toLocalSegment(segment);
  return { filePath, content: JSON.stringify(local, null, 2) + "\n" };
}

interface PullSegmentsOptions {
  /** When true, delete all local segment files and sync token before pulling. */
  reset?: boolean;
  /** Optional remote context for multi-remote sync token isolation. */
  remoteContext?: RemoteContext;
}

export async function pullLeadCMSSegments(optionsOrRemoteCtx?: PullSegmentsOptions | RemoteContext): Promise<void> {
  // Support both old signature (RemoteContext) and new options object
  let reset: boolean | undefined;
  let remoteCtx: RemoteContext | undefined;
  if (optionsOrRemoteCtx && 'name' in optionsOrRemoteCtx && 'url' in optionsOrRemoteCtx) {
    remoteCtx = optionsOrRemoteCtx;
  } else if (optionsOrRemoteCtx) {
    const opts = optionsOrRemoteCtx as PullSegmentsOptions;
    reset = opts.reset;
    remoteCtx = opts.remoteContext;
  }

  if (reset) {
    console.log(`🔄 Resetting segments state...\n`);
    await resetSegmentsState(remoteCtx);
  }

  const lastSyncToken = await readSyncToken(remoteCtx);
  const { items, deleted, nextSyncToken } = await pullSegmentSync(lastSyncToken);

  // Filter out Static segments
  const dynamicItems = items.filter(s => s.type !== "Static");

  let metadataMap: MetadataMap | undefined;
  const rcModule = remoteCtx ? await import("../lib/remote-context.js") : undefined;
  if (remoteCtx && rcModule) {
    metadataMap = await rcModule.readMetadataMap(remoteCtx);
  }

  const idIndex = (dynamicItems.length > 0 || deleted.length > 0)
    ? await buildSegmentIdIndex(SEGMENTS_DIR)
    : new Map<string, string>();

  let newCount = 0;
  let updatedCount = 0;

  for (const segment of dynamicItems) {
    const idStr = segment.id != null ? String(segment.id) : undefined;

    // Update per-remote metadata
    if (remoteCtx && rcModule && metadataMap && segment.id != null) {
      rcModule.setSegmentRemoteId(metadataMap, segment.name, segment.id);
      rcModule.setMetadataForSegment(metadataMap, segment.name, {
        id: segment.id,
        createdAt: segment.createdAt,
        updatedAt: segment.updatedAt ?? undefined,
      });
    }

    // Remove old file if ID is already mapped to a different path
    if (idStr && idIndex.has(idStr)) {
      const oldPath = idIndex.get(idStr)!;
      const newPath = getSegmentFilePath(segment);
      if (oldPath !== newPath) {
        try { await fs.unlink(oldPath); } catch { /* ignore */ }
      }
    }

    const { filePath, content } = saveSegmentFile(segment);
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const existed = idStr ? idIndex.has(idStr) : false;
    await fs.writeFile(filePath, content, "utf8");

    if (existed) {
      updatedCount++;
    } else {
      newCount++;
    }
  }

  // Handle deletions
  for (const id of deleted) {
    const filePath = idIndex.get(String(id));
    if (filePath) {
      try { await fs.unlink(filePath); } catch { /* ignore */ }
    }
  }

  // Persist metadata
  if (remoteCtx && rcModule && metadataMap && dynamicItems.length > 0) {
    await rcModule.writeMetadataMap(remoteCtx, metadataMap);
    logger.verbose(`[PULL] Updated metadata-map for remote "${remoteCtx.name}"`);
  }

  if (nextSyncToken) {
    await writeSyncToken(nextSyncToken, remoteCtx);
  }

  if (newCount > 0 || updatedCount > 0 || deleted.length > 0) {
    console.log(`\n📊 Segments sync summary:`);
    if (newCount > 0) console.log(`   ✨ New: ${newCount}`);
    if (updatedCount > 0) console.log(`   📝 Updated: ${updatedCount}`);
    if (deleted.length > 0) console.log(`   🗑️  Deleted: ${deleted.length}`);
  }
}

export { pullSegmentSync, buildSegmentIdIndex, getSegmentFilePath, toLocalSegment, saveSegmentFile };
