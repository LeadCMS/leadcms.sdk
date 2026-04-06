/**
 * Push and status for sequences.
 * Uses name-based references locally (segment names, email template names)
 * and transforms to/from ID-based references for the API.
 */

import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import * as Diff from "diff";
import { SEQUENCES_DIR } from "./leadcms-helpers.js";
import { leadCMSDataService } from "../lib/data-service.js";
import { colorConsole, statusColors, diffColors } from "../lib/console-colors.js";
import { logger } from "../lib/logger.js";
import type { RemoteContext, MetadataMap } from "../lib/remote-context.js";
import type {
  SequenceDetailsDto,
  SequenceCreateDto,
  LocalSequenceDto,
  SegmentNameIdMap,
  EmailTemplateNameIdMap,
  SegmentIdNameMap,
  EmailTemplateIdNameMap,
} from "../lib/automation-types.js";
import { toRemoteSequencePayload, toLocalSequence } from "../lib/automation-types.js";

// ── Interfaces ──────────────────────────────────────────────────────────

interface PushOptions {
  force?: boolean;
  dryRun?: boolean;
  allowDelete?: boolean;
  remoteContext?: RemoteContext;
}

interface StatusOptions {
  showDelete?: boolean;
  showDetailedPreview?: boolean;
  remoteContext?: RemoteContext;
}

export interface SequenceOperation {
  type: "create" | "update" | "delete" | "conflict";
  local?: LocalSequenceDto;
  remote?: SequenceDetailsDto;
  filePath?: string;
  reason?: string;
}

export interface SequenceStatusResult {
  operations: SequenceOperation[];
  totalLocal: number;
  totalRemote: number;
}

// ── Local file reading ──────────────────────────────────────────────────

interface LocalSequenceFile {
  filePath: string;
  sequence: LocalSequenceDto;
}

function formatSequenceApiError(error: any): string {
  const title = error?.response?.data?.title;
  if (typeof title === "string" && title.trim()) {
    return title.trim();
  }

  const detail = error?.response?.data?.detail;
  if (typeof detail === "string" && detail.trim()) {
    return detail.trim();
  }

  const errors = error?.response?.data?.errors;
  if (errors && typeof errors === "object") {
    const messages: string[] = [];
    for (const [field, fieldErrors] of Object.entries(errors)) {
      if (Array.isArray(fieldErrors)) {
        for (const fieldError of fieldErrors) {
          messages.push(`${field}: ${String(fieldError)}`);
        }
      }
    }
    if (messages.length > 0) {
      return messages.join("; ");
    }
  }

  return error?.message || "Unknown error";
}

async function readLocalSequences(dir?: string): Promise<LocalSequenceFile[]> {
  const results: LocalSequenceFile[] = [];
  const scanDir = dir || SEQUENCES_DIR;
  let entries;
  try {
    entries = await fs.readdir(scanDir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(scanDir, entry.name);
    if (entry.isDirectory()) {
      // Recurse into language subdirectories
      results.push(...(await readLocalSequences(fullPath)));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(await fs.readFile(fullPath, "utf8"));
      // Support both flat format and legacy _entityType wrapper
      const sequence: LocalSequenceDto | undefined =
        raw?._entityType === "sequence" ? raw.data : (raw?.name ? raw : undefined);
      if (sequence) {
        results.push({ filePath: fullPath, sequence });
      }
    } catch { /* skip */ }
  }

  return results;
}

// ── Lookup maps ─────────────────────────────────────────────────────────

async function buildNameToIdMaps(): Promise<{
  segmentMap: SegmentNameIdMap;
  templateMap: EmailTemplateNameIdMap;
}> {
  const [segments, templates] = await Promise.all([
    leadCMSDataService.getAllSegments(),
    leadCMSDataService.getAllEmailTemplates(),
  ]);

  const segmentMap: SegmentNameIdMap = new Map();
  for (const seg of segments) {
    if (seg.id != null) segmentMap.set(seg.name, seg.id);
  }

  const templateMap: EmailTemplateNameIdMap = new Map();
  for (const tpl of templates) {
    if (tpl.id != null && tpl.name) templateMap.set(tpl.name, tpl.id);
  }

  return { segmentMap, templateMap };
}

async function buildIdToNameMaps(): Promise<{
  segmentMap: SegmentIdNameMap;
  templateMap: EmailTemplateIdNameMap;
}> {
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

// ── Matching ────────────────────────────────────────────────────────────

function getRemoteMatch(
  local: LocalSequenceDto,
  remotes: SequenceDetailsDto[],
  metadataMap?: MetadataMap,
): SequenceDetailsDto | undefined {
  // Priority 1: name + language match (composite natural key)
  const nameMatch = remotes.find(
    r => r.name === local.name && r.language === local.language,
  );
  if (nameMatch) return nameMatch;

  // Priority 2: metadata-map ID (keyed by language + name)
  if (metadataMap?.sequences) {
    const entry = metadataMap.sequences[local.language]?.[local.name];
    if (entry?.id != null) {
      return remotes.find(r => r.id === entry.id);
    }
  }

  // Priority 3: local id (backward compat for single-remote)
  if (local.id != null) {
    return remotes.find(r => r.id === local.id);
  }

  return undefined;
}

// ── Compare ─────────────────────────────────────────────────────────────

function hasSequenceChanges(
  local: LocalSequenceDto,
  remote: SequenceDetailsDto,
  segmentIdNameMap: SegmentIdNameMap,
  templateIdNameMap: EmailTemplateIdNameMap,
): boolean {
  // Compare using the local representation of the remote
  const remoteAsLocal = toLocalSequence(remote, segmentIdNameMap, templateIdNameMap);
  // Strip timestamps for comparison
  const { createdAt: _lc, updatedAt: _lu, id: _lid, ...localComp } = local;
  const { createdAt: _rc, updatedAt: _ru, id: _rid, ...remoteComp } = remoteAsLocal;
  return JSON.stringify(localComp) !== JSON.stringify(remoteComp);
}

// ── Update local file after push ────────────────────────────────────────

async function updateLocalFileAfterPush(
  filePath: string,
  response: SequenceDetailsDto,
  segmentIdNameMap: SegmentIdNameMap,
  templateIdNameMap: EmailTemplateIdNameMap,
  remoteCtx?: RemoteContext,
): Promise<void> {
  if (remoteCtx) {
    try {
      const rc = await import("../lib/remote-context.js");
      const metaMap = await rc.readMetadataMap(remoteCtx);
      const lang = response.language || 'en';
      rc.setSequenceRemoteId(metaMap, lang, response.name, response.id!);
      rc.setMetadataForSequence(metaMap, lang, response.name, {
        id: response.id,
        createdAt: response.createdAt,
        updatedAt: response.updatedAt ?? undefined,
      });
      await rc.writeMetadataMap(remoteCtx, metaMap);
    } catch (e: any) {
      console.warn(`Failed to update remote metadata: ${e.message}`);
    }
  }

  if (remoteCtx && !remoteCtx.isDefault) return;

  try {
    const localDto = toLocalSequence(response, segmentIdNameMap, templateIdNameMap);
    await fs.writeFile(filePath, JSON.stringify(localDto, null, 2) + "\n", "utf8");
    logger.verbose(`[PUSH] Updated local file: ${filePath}`);
  } catch (e: any) {
    logger.verbose(`[PUSH] Failed to update local file ${filePath}: ${e.message}`);
  }
}

// ── Status ──────────────────────────────────────────────────────────────

export async function buildSequenceStatus(options: StatusOptions = {}): Promise<SequenceStatusResult> {
  const { showDelete, remoteContext: remoteCtx } = options;
  const operations: SequenceOperation[] = [];

  const localFiles = await readLocalSequences();
  const remoteSequences = await leadCMSDataService.getAllSequences();
  const { segmentMap: segIdNameMap, templateMap: tplIdNameMap } = await buildIdToNameMaps();

  let metadataMap: MetadataMap | undefined;
  if (remoteCtx) {
    const rc = await import("../lib/remote-context.js");
    metadataMap = await rc.readMetadataMap(remoteCtx);
  }

  for (const { filePath, sequence } of localFiles) {
    const match = getRemoteMatch(sequence, remoteSequences, metadataMap);

    if (!match) {
      operations.push({ type: "create", local: sequence, filePath });
      continue;
    }

    const localUpdated = sequence.updatedAt ? new Date(sequence.updatedAt) : new Date(0);
    const remoteUpdated = match.updatedAt ? new Date(match.updatedAt) : new Date(0);

    // Use per-remote metadata timestamps for conflict detection when available
    let lastKnownRemoteUpdated = localUpdated;
    if (metadataMap) {
      const lang = sequence.language || 'en';
      const meta = metadataMap.sequences?.[lang]?.[sequence.name];
      if (meta?.updatedAt) {
        lastKnownRemoteUpdated = new Date(meta.updatedAt);
      }
    }

    if (!options.remoteContext && remoteUpdated > lastKnownRemoteUpdated) {
      operations.push({
        type: "conflict",
        local: sequence,
        remote: match,
        filePath,
        reason: "Remote sequence updated after local changes",
      });
      continue;
    }

    if (hasSequenceChanges(sequence, match, segIdNameMap, tplIdNameMap)) {
      operations.push({ type: "update", local: sequence, remote: match, filePath });
    }
  }

  if (showDelete) {
    const localKeys = new Set(
      localFiles.map(f => `${f.sequence.language}:${f.sequence.name}`),
    );
    for (const remote of remoteSequences) {
      const key = `${remote.language}:${remote.name}`;
      if (!localKeys.has(key)) {
        operations.push({ type: "delete", remote });
      }
    }
  }

  return {
    operations,
    totalLocal: localFiles.length,
    totalRemote: remoteSequences.length,
  };
}

function printSequenceDiffPreview(
  op: SequenceOperation,
  segIdNameMap: SegmentIdNameMap,
  tplIdNameMap: EmailTemplateIdNameMap,
): void {
  if (op.type !== "update" && op.type !== "conflict") return;
  if (!op.local || !op.remote) return;

  try {
    const remoteAsLocal = toLocalSequence(op.remote, segIdNameMap, tplIdNameMap);
    const { createdAt: _lc, updatedAt: _lu, id: _lid, ...localComp } = op.local;
    const { createdAt: _rc, updatedAt: _ru, id: _rid, ...remoteComp } = remoteAsLocal;

    const localJson = JSON.stringify(localComp, null, 2);
    const remoteJson = JSON.stringify(remoteComp, null, 2);

    const diff = Diff.diffLines(remoteJson, localJson);
    let addedLines = 0;
    let removedLines = 0;

    colorConsole.info("          Content diff preview:");
    let previewLines = 0;
    const maxPreviewLines = 10;

    for (const part of diff) {
      const lines = part.value.split("\n").filter((line: string) => line.trim() !== "");

      if (part.added) {
        addedLines += lines.length;
        if (previewLines < maxPreviewLines) {
          for (const line of lines.slice(0, Math.min(lines.length, maxPreviewLines - previewLines))) {
            colorConsole.log(`          ${diffColors.added(`+ ${line}`)}`);
            previewLines++;
          }
        }
      } else if (part.removed) {
        removedLines += lines.length;
        if (previewLines < maxPreviewLines) {
          for (const line of lines.slice(0, Math.min(lines.length, maxPreviewLines - previewLines))) {
            colorConsole.log(`          ${diffColors.removed(`- ${line}`)}`);
            previewLines++;
          }
        }
      }

      if (previewLines >= maxPreviewLines) break;
    }

    if (previewLines >= maxPreviewLines && (addedLines + removedLines > previewLines)) {
      colorConsole.gray(`          ... (${addedLines + removedLines - previewLines} more changes)`);
    }

    colorConsole.log(`          ${colorConsole.green(`+${addedLines}`)} / ${colorConsole.red(`-${removedLines}`)} lines`);
    colorConsole.log("");
  } catch (error: any) {
    logger.verbose(`[DIFF] Failed to generate diff for sequence ${op.local?.name}: ${error.message}`);
  }
}

export async function statusSequences(options: StatusOptions = {}): Promise<void> {
  if (!leadCMSDataService.isApiKeyConfigured()) {
    console.log("\n📊 LeadCMS Sequence Status");
    console.log("");
    console.log("⏭️  Sequences require authentication — no API key configured, skipping");
    return;
  }

  const result = await buildSequenceStatus(options);
  const { operations } = result;

  colorConsole.important("\n📊 LeadCMS Sequence Status");
  colorConsole.log("");

  if (operations.length === 0) {
    colorConsole.success("✅ All sequences are in sync!");
    colorConsole.log("");
    return;
  }

  let segIdNameMap: SegmentIdNameMap | undefined;
  let tplIdNameMap: EmailTemplateIdNameMap | undefined;
  if (options.showDetailedPreview) {
    const maps = await buildIdToNameMaps();
    segIdNameMap = maps.segmentMap;
    tplIdNameMap = maps.templateMap;
  }

  for (const op of operations) {
    const nameLabel = op.local?.name || op.remote?.name || "unknown";
    const idLabel = op.remote?.id ? `(ID: ${op.remote.id})` : "";
    switch (op.type) {
      case "create":
        colorConsole.log(`   ${statusColors.created("new:      ")} ${colorConsole.highlight(nameLabel)}`);
        break;
      case "update":
        colorConsole.log(`   ${statusColors.modified("modified: ")} ${colorConsole.highlight(nameLabel)} ${colorConsole.gray(idLabel)}`);
        break;
      case "conflict":
        colorConsole.log(`   ${statusColors.conflict("conflict: ")} ${colorConsole.highlight(nameLabel)} ${colorConsole.gray(idLabel)}`);
        if (op.reason) colorConsole.log(`              ${colorConsole.gray(op.reason)}`);
        break;
      case "delete":
        colorConsole.log(`   ${statusColors.conflict("deleted:  ")} ${colorConsole.highlight(nameLabel)} ${colorConsole.gray(idLabel)}`);
        break;
    }

    if (options.showDetailedPreview && segIdNameMap && tplIdNameMap) {
      printSequenceDiffPreview(op, segIdNameMap, tplIdNameMap);
    }
  }

  colorConsole.log("");
}

// ── Push ────────────────────────────────────────────────────────────────

export async function pushSequences(options: PushOptions = {}): Promise<void> {
  if (!leadCMSDataService.isApiKeyConfigured()) {
    console.log("⏭️  Sequences require authentication — no API key configured, skipping");
    return;
  }

  const { force, dryRun, allowDelete, remoteContext: remoteCtx } = options;

  if (remoteCtx) {
    leadCMSDataService.configureForRemote(remoteCtx.url, remoteCtx.apiKey);
    logger.verbose(`[PUSH] Using remote "${remoteCtx.name}" (${remoteCtx.url})`);
  }

  let metadataMap: MetadataMap | undefined;
  if (remoteCtx) {
    const rc = await import("../lib/remote-context.js");
    metadataMap = await rc.readMetadataMap(remoteCtx);
  }

  const localFiles = await readLocalSequences();
  const remoteSequences = await leadCMSDataService.getAllSequences();
  const { segmentMap: segNameIdMap, templateMap: tplNameIdMap } = await buildNameToIdMaps();
  const { segmentMap: segIdNameMap, templateMap: tplIdNameMap } = await buildIdToNameMaps();

  for (const { filePath, sequence } of localFiles) {
    const match = getRemoteMatch(sequence, remoteSequences, metadataMap);

    let payload: SequenceCreateDto;
    try {
      payload = toRemoteSequencePayload(sequence, segNameIdMap, tplNameIdMap);
    } catch (e: any) {
      console.warn(`⚠️  Skipping sequence "${sequence.name}": ${e.message}`);
      continue;
    }

    if (!match) {
      if (dryRun) {
        console.log(`🟡 [DRY RUN] Create sequence: ${sequence.name}`);
        continue;
      }

      let created: SequenceDetailsDto;
      try {
        created = await leadCMSDataService.createSequence(payload);
      } catch (error: any) {
        const reason = formatSequenceApiError(error);
        throw new Error(`Failed to create sequence "${sequence.name}": ${reason}`);
      }

      console.log(`✅ Created sequence: ${sequence.name}`);
      await updateLocalFileAfterPush(filePath, created, segIdNameMap, tplIdNameMap, remoteCtx);
      continue;
    }

    const localUpdated = sequence.updatedAt ? new Date(sequence.updatedAt) : new Date(0);
    const remoteUpdated = match.updatedAt ? new Date(match.updatedAt) : new Date(0);

    // Use per-remote metadata timestamps for conflict detection when available
    let lastKnownRemoteUpdated = localUpdated;
    if (metadataMap) {
      const lang = sequence.language || 'en';
      const meta = metadataMap.sequences?.[lang]?.[sequence.name];
      if (meta?.updatedAt) {
        lastKnownRemoteUpdated = new Date(meta.updatedAt);
      }
    }

    if (!force && remoteUpdated > lastKnownRemoteUpdated) {
      console.warn(`⚠️  Remote sequence updated after local changes: ${sequence.name} — skipping (use --force to override)`);
      continue;
    }

    if (!hasSequenceChanges(sequence, match, segIdNameMap, tplIdNameMap)) continue;

    if (dryRun) {
      console.log(`🟡 [DRY RUN] Update sequence: ${sequence.name} (ID ${match.id})`);
      continue;
    }

    // Sequences use PUT for full replace
    let updated: SequenceDetailsDto;
    try {
      updated = await leadCMSDataService.updateSequence(match.id!, payload);
    } catch (error: any) {
      const reason = formatSequenceApiError(error);
      throw new Error(`Failed to update sequence "${sequence.name}" (ID ${match.id}): ${reason}`);
    }

    console.log(`✅ Updated sequence: ${sequence.name}`);
    await updateLocalFileAfterPush(filePath, updated, segIdNameMap, tplIdNameMap, remoteCtx);
  }

  if (!allowDelete) return;

  const localKeys = new Set(
    localFiles.map(f => `${f.sequence.language}:${f.sequence.name}`),
  );

  for (const remote of remoteSequences) {
    const key = `${remote.language}:${remote.name}`;
    if (localKeys.has(key)) continue;

    if (dryRun) {
      console.log(`🟡 [DRY RUN] Delete sequence: ${remote.name || remote.id}`);
      continue;
    }

    await leadCMSDataService.deleteSequence(remote.id!);
    console.log(`🗑️  Deleted sequence: ${remote.name || remote.id}`);
  }
}
