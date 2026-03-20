/**
 * Push and status for sequences.
 * Uses name-based references locally (segment names, email template names)
 * and transforms to/from ID-based references for the API.
 */

import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { SEQUENCES_DIR } from "./leadcms-helpers.js";
import { leadCMSDataService } from "../lib/data-service.js";
import { colorConsole, statusColors } from "../lib/console-colors.js";
import { logger } from "../lib/logger.js";
import type { RemoteContext, MetadataMap } from "../lib/remote-context.js";
import type {
    SequenceDetailsDto,
    SequenceCreateDto,
    LocalSequenceDto,
    LocalAutomationFile,
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

async function readLocalSequences(): Promise<LocalSequenceFile[]> {
    const results: LocalSequenceFile[] = [];
    let entries;
    try {
        entries = await fs.readdir(SEQUENCES_DIR, { withFileTypes: true });
    } catch {
        return results;
    }

    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const fullPath = path.join(SEQUENCES_DIR, entry.name);
        try {
            const raw = JSON.parse(await fs.readFile(fullPath, "utf8"));
            const sequence: LocalSequenceDto | undefined =
                raw?._entityType === "sequence" ? raw.data : undefined;
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
    // Priority 1: name match
    const nameMatch = remotes.find(r => r.name === local.name);
    if (nameMatch) return nameMatch;

    // Priority 2: metadata-map ID
    if (metadataMap?.sequences) {
        const entry = metadataMap.sequences[local.name];
        if (entry?.id != null) {
            return remotes.find(r => r.id === entry.id);
        }
    }

    // Priority 3: local id
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
            rc.setSequenceRemoteId(metaMap, response.name, response.id!);
            rc.setMetadataForSequence(metaMap, response.name, {
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
        const file: LocalAutomationFile<LocalSequenceDto> = {
            _entityType: "sequence",
            data: localDto,
        };
        await fs.writeFile(filePath, JSON.stringify(file, null, 2) + "\n", "utf8");
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

        if (!options.remoteContext && remoteUpdated > localUpdated) {
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
        const localNames = new Set(localFiles.map(f => f.sequence.name));
        const localIds = new Set(
            localFiles.map(f => f.sequence.id).filter((id): id is number => id != null),
        );
        for (const remote of remoteSequences) {
            if (!localNames.has(remote.name) && (remote.id == null || !localIds.has(remote.id))) {
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
            const created = await leadCMSDataService.createSequence(payload);
            console.log(`✅ Created sequence: ${sequence.name}`);
            await updateLocalFileAfterPush(filePath, created, segIdNameMap, tplIdNameMap, remoteCtx);
            continue;
        }

        const localUpdated = sequence.updatedAt ? new Date(sequence.updatedAt) : new Date(0);
        const remoteUpdated = match.updatedAt ? new Date(match.updatedAt) : new Date(0);

        if (!force && remoteUpdated > localUpdated) {
            console.warn(`⚠️  Remote sequence updated after local changes: ${sequence.name} — skipping (use --force to override)`);
            continue;
        }

        if (!hasSequenceChanges(sequence, match, segIdNameMap, tplIdNameMap)) continue;

        if (dryRun) {
            console.log(`🟡 [DRY RUN] Update sequence: ${sequence.name} (ID ${match.id})`);
            continue;
        }

        // Sequences use PUT for full replace
        const updated = await leadCMSDataService.updateSequence(match.id!, payload);
        console.log(`✅ Updated sequence: ${sequence.name}`);
        await updateLocalFileAfterPush(filePath, updated, segIdNameMap, tplIdNameMap, remoteCtx);
    }

    if (!allowDelete) return;

    const localNames = new Set(localFiles.map(f => f.sequence.name));
    const localIds = new Set(
        localFiles.map(f => f.sequence.id).filter((id): id is number => id != null),
    );

    for (const remote of remoteSequences) {
        if (localNames.has(remote.name) || (remote.id != null && localIds.has(remote.id))) continue;

        if (dryRun) {
            console.log(`🟡 [DRY RUN] Delete sequence: ${remote.name || remote.id}`);
            continue;
        }

        await leadCMSDataService.deleteSequence(remote.id!);
        console.log(`🗑️  Deleted sequence: ${remote.name || remote.id}`);
    }
}
