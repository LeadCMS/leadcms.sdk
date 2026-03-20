/**
 * Pull sequences from LeadCMS.
 * Transforms segment IDs → names and emailTemplateId → emailTemplateName
 * for human-readable local files.
 */

import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import axios, { AxiosResponse } from "axios";
import {
  leadCMSUrl,
  leadCMSApiKey,
  SEQUENCES_DIR,
} from "./leadcms-helpers.js";
import { leadCMSDataService } from "../lib/data-service.js";
import { syncTokenPath, type RemoteContext } from "../lib/remote-context.js";
import type { MetadataMap } from "../lib/remote-context.js";
import { logger } from "../lib/logger.js";
import type {
  SequenceDetailsDto,
  SequenceSyncResponse,
  LocalAutomationFile,
  LocalSequenceDto,
  SegmentIdNameMap,
  EmailTemplateIdNameMap,
} from "../lib/automation-types.js";
import { toLocalSequence } from "../lib/automation-types.js";

interface SequenceSyncResult {
  items: SequenceDetailsDto[];
  deleted: number[];
  baseItems: Record<string, SequenceDetailsDto>;
  nextSyncToken: string;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
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
    const tokenPath = syncTokenPath(remoteCtx, "sequences");
    return readFileOrUndefined(tokenPath);
  }
  return readFileOrUndefined(path.join(SEQUENCES_DIR, ".sync-token"));
}

async function writeSyncToken(token: string, remoteCtx?: RemoteContext): Promise<void> {
  if (remoteCtx) {
    const tokenPath = syncTokenPath(remoteCtx, "sequences");
    await fs.mkdir(path.dirname(tokenPath), { recursive: true });
    await fs.writeFile(tokenPath, token, "utf8");
    return;
  }
  await fs.mkdir(SEQUENCES_DIR, { recursive: true });
  await fs.writeFile(path.join(SEQUENCES_DIR, ".sync-token"), token, "utf8");
}

async function pullSequenceSync(syncToken?: string): Promise<SequenceSyncResult> {
  if (!leadCMSUrl) {
    throw new Error("LeadCMS URL is not configured.");
  }

  if (!leadCMSApiKey) {
    throw new Error("LeadCMS API key is required to pull sequences.");
  }

  let allItems: SequenceDetailsDto[] = [];
  let allDeleted: number[] = [];
  let allBaseItems: Record<string, SequenceDetailsDto> = {};
  let token = syncToken || "";
  let nextSyncToken = token;

  while (true) {
    const url = new URL("/api/sequences/sync", leadCMSUrl);
    url.searchParams.set("filter[limit]", "100");
    url.searchParams.set("syncToken", token);
    if (syncToken) {
      url.searchParams.set("includeBase", "true");
    }

    const res: AxiosResponse<SequenceSyncResponse> = await axios.get(url.toString(), {
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

/** Build a map of sequence ID → file path from existing local files. */
async function buildSequenceIdIndex(dir: string): Promise<Map<string, string>> {
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
      const id = content?._entityType === "sequence" ? content?.data?.id : content?.id;
      if (id != null) {
        index.set(String(id), fullPath);
      }
    } catch { /* skip unreadable */ }
  }

  return index;
}

function getSequenceFilePath(sequence: SequenceDetailsDto | LocalSequenceDto): string {
  const slug = slugify(sequence.name) || `sequence-${sequence.id}`;
  return path.join(SEQUENCES_DIR, `${slug}.json`);
}

/** Build segment ID→name and email template ID→name lookup maps. */
async function buildLookupMaps(): Promise<{ segmentMap: SegmentIdNameMap; templateMap: EmailTemplateIdNameMap }> {
  const [segments, templates] = await Promise.all([
    leadCMSDataService.getAllSegments(),
    leadCMSDataService.getAllEmailTemplates(),
  ]);

  const segmentMap: SegmentIdNameMap = new Map();
  for (const seg of segments) {
    if (seg.id != null) segmentMap.set(seg.id, seg.name);
  }

  const templateMap: EmailTemplateIdNameMap = new Map();
  for (const tpl of templates) {
    if (tpl.id != null && tpl.name) templateMap.set(tpl.id, tpl.name);
  }

  return { segmentMap, templateMap };
}

export async function pullLeadCMSSequences(remoteCtx?: RemoteContext): Promise<void> {
  const lastSyncToken = await readSyncToken(remoteCtx);
  const { items, deleted, nextSyncToken } = await pullSequenceSync(lastSyncToken);

  let metadataMap: MetadataMap | undefined;
  const rcModule = remoteCtx ? await import("../lib/remote-context.js") : undefined;
  if (remoteCtx && rcModule) {
    metadataMap = await rcModule.readMetadataMap(remoteCtx);
  }

  const idIndex = (items.length > 0 || deleted.length > 0)
    ? await buildSequenceIdIndex(SEQUENCES_DIR)
    : new Map<string, string>();

  // Build lookup maps for ID→name transformations
  let segmentMap: SegmentIdNameMap = new Map();
  let templateMap: EmailTemplateIdNameMap = new Map();
  if (items.length > 0) {
    const maps = await buildLookupMaps();
    segmentMap = maps.segmentMap;
    templateMap = maps.templateMap;
  }

  let newCount = 0;
  let updatedCount = 0;

  for (const sequence of items) {
    const idStr = sequence.id != null ? String(sequence.id) : undefined;

    // Update per-remote metadata
    if (remoteCtx && rcModule && metadataMap && sequence.id != null) {
      rcModule.setSequenceRemoteId(metadataMap, sequence.name, sequence.id);
      rcModule.setMetadataForSequence(metadataMap, sequence.name, {
        id: sequence.id,
        createdAt: sequence.createdAt,
        updatedAt: sequence.updatedAt ?? undefined,
      });
    }

    // Remove old file if ID maps to a different path (e.g. rename)
    if (idStr && idIndex.has(idStr)) {
      const oldPath = idIndex.get(idStr)!;
      const newPath = getSequenceFilePath(sequence);
      if (oldPath !== newPath) {
        try { await fs.unlink(oldPath); } catch { /* ignore */ }
      }
    }

    // Transform to local shape
    const localDto = toLocalSequence(sequence, segmentMap, templateMap);
    const local: LocalAutomationFile<LocalSequenceDto> = {
      _entityType: "sequence",
      data: localDto,
    };

    const filePath = getSequenceFilePath(sequence);
    const content = JSON.stringify(local, null, 2) + "\n";
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
  if (remoteCtx && rcModule && metadataMap && items.length > 0) {
    await rcModule.writeMetadataMap(remoteCtx, metadataMap);
    logger.verbose(`[PULL] Updated metadata-map for remote "${remoteCtx.name}"`);
  }

  if (nextSyncToken) {
    await writeSyncToken(nextSyncToken, remoteCtx);
  }

  if (newCount > 0 || updatedCount > 0 || deleted.length > 0) {
    console.log(`\n📊 Sequences sync summary:`);
    if (newCount > 0) console.log(`   ✨ New: ${newCount}`);
    if (updatedCount > 0) console.log(`   📝 Updated: ${updatedCount}`);
    if (deleted.length > 0) console.log(`   🗑️  Deleted: ${deleted.length}`);
  }
}

export { pullSequenceSync, buildSequenceIdIndex, getSequenceFilePath, buildLookupMaps };
