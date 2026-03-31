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
import { getConfig } from "../lib/config.js";
import { resetSequencesState } from "./pull-all.js";
import { logger } from "../lib/logger.js";
import type {
  SequenceDetailsDto,
  SequenceSyncResponse,
  LocalSequenceDto,
  SegmentIdNameMap,
  EmailTemplateIdNameMap,
} from "../lib/automation-types.js";
import { orderLocalSequenceFields, toLocalSequence } from "../lib/automation-types.js";
import { slugify } from "../lib/slugify.js";

interface SequenceSyncResult {
  items: SequenceDetailsDto[];
  deleted: number[];
  baseItems: Record<string, SequenceDetailsDto>;
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
    url.searchParams.set("filter[include]", "steps");
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
      // Support both flat format and legacy _entityType wrapper
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

interface PullSequencesOptions {
  /** When true, delete all local sequence files and sync token before pulling. */
  reset?: boolean;
  /** Optional remote context for multi-remote sync token isolation. */
  remoteContext?: RemoteContext;
}

export async function pullLeadCMSSequences(optionsOrRemoteCtx?: PullSequencesOptions | RemoteContext): Promise<void> {
  // Support both old signature (RemoteContext) and new options object
  let reset: boolean | undefined;
  let remoteCtx: RemoteContext | undefined;
  if (optionsOrRemoteCtx && 'name' in optionsOrRemoteCtx && 'url' in optionsOrRemoteCtx) {
    remoteCtx = optionsOrRemoteCtx;
  } else if (optionsOrRemoteCtx) {
    const opts = optionsOrRemoteCtx as PullSequencesOptions;
    reset = opts.reset;
    remoteCtx = opts.remoteContext;
  }

  if (reset) {
    console.log(`🔄 Resetting sequences state...\n`);
    await resetSequencesState(remoteCtx);
  }

  const lastSyncToken = await readSyncToken(remoteCtx);
  const { items, deleted, nextSyncToken } = await pullSequenceSync(lastSyncToken);

  let metadataMap: MetadataMap | undefined;
  const rcModule = remoteCtx ? await import("../lib/remote-context.js") : undefined;
  if (remoteCtx && rcModule) {
    metadataMap = await rcModule.readMetadataMap(remoteCtx);
  }

  // Load defaultRemote's maps so local files always reflect the default
  // remote's ids and timestamps, even when pulling from another remote.
  let defaultMetadataMap: MetadataMap | undefined;
  if (remoteCtx && !remoteCtx.isDefault && rcModule) {
    const cfg = getConfig();
    if (cfg.defaultRemote) {
      const defaultStateDir = path.join(path.dirname(remoteCtx.stateDir), cfg.defaultRemote);
      const defaultCtx: import("../lib/remote-context.js").RemoteContext = {
        name: cfg.defaultRemote,
        url: cfg.remotes?.[cfg.defaultRemote]?.url || '',
        isDefault: true,
        stateDir: defaultStateDir,
      };
      defaultMetadataMap = await rcModule.readMetadataMap(defaultCtx);
    }
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
    const stepCount = sequence.steps?.length ?? 0;

    logger.verbose(`[PULL] Sequence "${sequence.name}" (${sequence.language}, id:${sequence.id ?? '?'}) — ${stepCount} step(s)`);
    if (stepCount > 0) {
      logger.verbose(`[PULL]   Step order: ${sequence.steps!.map(s => `${s.name} (id:${s.id})`).join(' → ')}`);
    }

    // Capture old entry BEFORE updating metadata so we can detect renames
    // using the correct remote's IDs (not the default remote's file IDs).
    const oldEntry = (remoteCtx && !remoteCtx.isDefault && rcModule && metadataMap && idStr)
      ? rcModule.findSequenceByRemoteId(metadataMap, idStr)
      : undefined;

    // Update per-remote metadata
    if (remoteCtx && rcModule && metadataMap && sequence.id != null) {
      const lang = sequence.language || 'en';
      rcModule.setSequenceRemoteId(metadataMap, lang, sequence.name, sequence.id);
      rcModule.setMetadataForSequence(metadataMap, lang, sequence.name, {
        id: sequence.id,
        createdAt: sequence.createdAt,
        updatedAt: sequence.updatedAt ?? undefined,
      });
    }

    // Remove old file if ID maps to a different path (e.g. rename)
    if (remoteCtx && !remoteCtx.isDefault) {
      // Non-default remote: use metadata-based lookup to avoid
      // matching against the default remote's IDs in local files.
      if (oldEntry) {
        const oldSlug = slugify(oldEntry.name) || `sequence-${idStr}`;
        const oldPath = path.join(SEQUENCES_DIR, `${oldSlug}.json`);
        const newPath = getSequenceFilePath(sequence);
        if (oldPath !== newPath) {
          console.log(`   🗑️  ${path.basename(oldPath)} → ${path.basename(newPath)} (renamed)`);
          try { await fs.unlink(oldPath); } catch { /* ignore */ }
        }
      }
    } else if (idStr && idIndex.has(idStr)) {
      const oldPath = idIndex.get(idStr)!;
      const newPath = getSequenceFilePath(sequence);
      if (oldPath !== newPath) {
        console.log(`   🗑️  ${path.basename(oldPath)} → ${path.basename(newPath)} (renamed)`);
        try { await fs.unlink(oldPath); } catch { /* ignore */ }
      }
    }

    // Transform to local shape
    const localDto = toLocalSequence(sequence, segmentMap, templateMap);

    // For non-default remotes, replace server-generated fields with the
    // defaultRemote's values so local files always reflect prod ids/dates.
    // The current remote's values are already stored in its per-remote maps.
    let localToSave = localDto;
    if (remoteCtx && !remoteCtx.isDefault) {
      const { id: _id, createdAt: _ca, updatedAt: _ua, ...rest } = localDto;
      const lang = sequence.language || 'en';
      const name = sequence.name;
      const defaultMeta = defaultMetadataMap?.sequences?.[lang]?.[name];
      localToSave = orderLocalSequenceFields({
        ...(defaultMeta?.id != null ? { id: Number(defaultMeta.id) } : {}),
        ...(defaultMeta?.createdAt ? { createdAt: defaultMeta.createdAt } : {}),
        ...(defaultMeta?.updatedAt ? { updatedAt: defaultMeta.updatedAt } : {}),
        ...rest,
      } as LocalSequenceDto);
    }

    const filePath = getSequenceFilePath(sequence);
    const content = JSON.stringify(localToSave, null, 2) + "\n";
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    if (localToSave.steps?.length) {
      logger.verbose(`[PULL]   Saved step order: ${localToSave.steps.map(s => s.name).join(' → ')}`);
    }
    logger.verbose(`[PULL]   → ${filePath}`);

    const existed = (remoteCtx && !remoteCtx.isDefault)
      ? !!oldEntry
      : (idStr ? idIndex.has(idStr) : false);
    await fs.writeFile(filePath, content, "utf8");

    if (existed) {
      updatedCount++;
    } else {
      newCount++;
    }
  }

  // Handle deletions
  for (const id of deleted) {
    if (remoteCtx && !remoteCtx.isDefault && rcModule && metadataMap) {
      // Non-default remote: resolve ID → name via metadata.
      const entry = rcModule.findSequenceByRemoteId(metadataMap, id);
      if (entry) {
        const slug = slugify(entry.name) || `sequence-${id}`;
        const filePath = path.join(SEQUENCES_DIR, `${slug}.json`);
        console.log(`   🗑️  ${path.basename(filePath)} (deleted on remote)`);
        try { await fs.unlink(filePath); } catch { /* ignore */ }
        // Clean up metadata entry
        if (metadataMap.sequences?.[entry.language]?.[entry.name]) {
          delete metadataMap.sequences[entry.language][entry.name];
        }
      }
    } else {
      const filePath = idIndex.get(String(id));
      if (filePath) {
        console.log(`   🗑️  ${path.basename(filePath)} (deleted on remote)`);
        try { await fs.unlink(filePath); } catch { /* ignore */ }
      }
    }
  }

  // Persist metadata
  if (remoteCtx && rcModule && metadataMap && (items.length > 0 || deleted.length > 0)) {
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
