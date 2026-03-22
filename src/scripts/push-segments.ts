/**
 * Push and status for segments.
 * Only Dynamic segments are synced; Static segments are excluded.
 */

import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import { SEGMENTS_DIR } from "./leadcms-helpers.js";
import { leadCMSDataService } from "../lib/data-service.js";
import { colorConsole, statusColors } from "../lib/console-colors.js";
import { logger } from "../lib/logger.js";
import type { RemoteContext, MetadataMap } from "../lib/remote-context.js";
import type {
    SegmentDetailsDto,
    SegmentCreateDto,
    SegmentUpdateDto,
} from "../lib/automation-types.js";
import { stripNullsAndEmptyArrays } from "../lib/automation-types.js";

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

export interface SegmentOperation {
    type: "create" | "update" | "delete" | "conflict";
    local?: SegmentDetailsDto;
    remote?: SegmentDetailsDto;
    filePath?: string;
    reason?: string;
}

export interface SegmentStatusResult {
    operations: SegmentOperation[];
    totalLocal: number;
    totalRemote: number;
}

// ── Local file reading ──────────────────────────────────────────────────

interface LocalSegmentFile {
    filePath: string;
    segment: SegmentDetailsDto;
}

async function readLocalSegments(): Promise<LocalSegmentFile[]> {
    const results: LocalSegmentFile[] = [];
    let entries;
    try {
        entries = await fs.readdir(SEGMENTS_DIR, { withFileTypes: true });
    } catch {
        return results;
    }

    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const fullPath = path.join(SEGMENTS_DIR, entry.name);
        try {
            const raw = JSON.parse(await fs.readFile(fullPath, "utf8"));
            // Support both flat format and legacy _entityType wrapper
            const segment: SegmentDetailsDto | undefined =
                raw?._entityType === "segment" ? raw.data : (raw?.name ? raw : undefined);
            if (segment) {
                results.push({ filePath: fullPath, segment });
            }
        } catch { /* skip */ }
    }

    return results;
}

// ── Matching ────────────────────────────────────────────────────────────

function getRemoteMatch(
    local: SegmentDetailsDto,
    remotes: SegmentDetailsDto[],
    metadataMap?: MetadataMap,
): SegmentDetailsDto | undefined {
    // Priority 1: match by name
    const nameMatch = remotes.find(r => r.name === local.name);
    if (nameMatch) return nameMatch;

    // Priority 2: metadata-map ID
    if (metadataMap?.segments) {
        const entry = metadataMap.segments[local.name];
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

// ── Build payload ───────────────────────────────────────────────────────

function toCreatePayload(seg: SegmentDetailsDto): SegmentCreateDto {
    return {
        name: seg.name,
        description: seg.description,
        type: seg.type,
        definition: seg.definition,
    };
}

function toUpdatePayload(seg: SegmentDetailsDto): SegmentUpdateDto {
    return {
        name: seg.name,
        description: seg.description,
        definition: seg.definition,
    };
}

// ── Compare ─────────────────────────────────────────────────────────────

function hasSegmentChanges(local: SegmentDetailsDto, remote: SegmentDetailsDto): boolean {
    if (local.name !== remote.name) return true;
    if ((local.description ?? null) !== (remote.description ?? null)) return true;
    const localDef = JSON.stringify(stripNullsAndEmptyArrays(local.definition) ?? null);
    const remoteDef = JSON.stringify(stripNullsAndEmptyArrays(remote.definition) ?? null);
    if (localDef !== remoteDef) return true;
    return false;
}

// ── Update local file after push ────────────────────────────────────────

async function updateLocalFileAfterPush(
    filePath: string,
    response: SegmentDetailsDto,
    remoteCtx?: RemoteContext,
): Promise<void> {
    if (remoteCtx) {
        try {
            const rc = await import("../lib/remote-context.js");
            const metaMap = await rc.readMetadataMap(remoteCtx);
            rc.setSegmentRemoteId(metaMap, response.name, response.id!);
            rc.setMetadataForSegment(metaMap, response.name, {
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
        const { contactCount, createdById, updatedById, createdByIp, createdByUserAgent, updatedByIp, updatedByUserAgent, contactIds, ...rest } = response;
        const cleaned = stripNullsAndEmptyArrays(rest);
        await fs.writeFile(filePath, JSON.stringify(cleaned, null, 2) + "\n", "utf8");
        logger.verbose(`[PUSH] Updated local file: ${filePath}`);
    } catch (e: any) {
        logger.verbose(`[PUSH] Failed to update local file ${filePath}: ${e.message}`);
    }
}

// ── Status ──────────────────────────────────────────────────────────────

export async function buildSegmentStatus(options: StatusOptions = {}): Promise<SegmentStatusResult> {
    const { showDelete, remoteContext: remoteCtx } = options;
    const operations: SegmentOperation[] = [];

    const localFiles = await readLocalSegments();
    const remoteSegments = (await leadCMSDataService.getAllSegments()).filter(s => s.type !== "Static");

    let metadataMap: MetadataMap | undefined;
    if (remoteCtx) {
        const rc = await import("../lib/remote-context.js");
        metadataMap = await rc.readMetadataMap(remoteCtx);
    }

    for (const { filePath, segment } of localFiles) {
        const match = getRemoteMatch(segment, remoteSegments, metadataMap);

        if (!match) {
            operations.push({ type: "create", local: segment, filePath });
            continue;
        }

        // Conflict check: remote updated after local
        const localUpdated = segment.updatedAt ? new Date(segment.updatedAt) : new Date(0);
        const remoteUpdated = match.updatedAt ? new Date(match.updatedAt) : new Date(0);

        if (!options.remoteContext && remoteUpdated > localUpdated) {
            operations.push({
                type: "conflict",
                local: segment,
                remote: match,
                filePath,
                reason: "Remote segment updated after local changes",
            });
            continue;
        }

        if (hasSegmentChanges(segment, match)) {
            operations.push({ type: "update", local: segment, remote: match, filePath });
        }
    }

    if (showDelete) {
        const localNames = new Set(localFiles.map(f => f.segment.name));
        const localIds = new Set(
            localFiles.map(f => f.segment.id).filter((id): id is number => id != null),
        );
        for (const remote of remoteSegments) {
            if (!localNames.has(remote.name) && (remote.id == null || !localIds.has(remote.id))) {
                operations.push({ type: "delete", remote });
            }
        }
    }

    return {
        operations,
        totalLocal: localFiles.length,
        totalRemote: remoteSegments.length,
    };
}

export async function statusSegments(options: StatusOptions = {}): Promise<void> {
    if (!leadCMSDataService.isApiKeyConfigured()) {
        console.log("\n📊 LeadCMS Segment Status");
        console.log("");
        console.log("⏭️  Segments require authentication — no API key configured, skipping");
        return;
    }

    const result = await buildSegmentStatus(options);
    const { operations } = result;

    colorConsole.important("\n📊 LeadCMS Segment Status");
    colorConsole.log("");

    if (operations.length === 0) {
        colorConsole.success("✅ All segments are in sync!");
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

export async function pushSegments(options: PushOptions = {}): Promise<void> {
    if (!leadCMSDataService.isApiKeyConfigured()) {
        console.log("⏭️  Segments require authentication — no API key configured, skipping");
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

    const localFiles = await readLocalSegments();
    const remoteSegments = (await leadCMSDataService.getAllSegments()).filter(s => s.type !== "Static");

    for (const { filePath, segment } of localFiles) {
        const match = getRemoteMatch(segment, remoteSegments, metadataMap);

        if (!match) {
            if (dryRun) {
                console.log(`🟡 [DRY RUN] Create segment: ${segment.name}`);
                continue;
            }
            const created = await leadCMSDataService.createSegment(toCreatePayload(segment));
            console.log(`✅ Created segment: ${segment.name}`);
            await updateLocalFileAfterPush(filePath, created, remoteCtx);
            continue;
        }

        const localUpdated = segment.updatedAt ? new Date(segment.updatedAt) : new Date(0);
        const remoteUpdated = match.updatedAt ? new Date(match.updatedAt) : new Date(0);

        if (!force && remoteUpdated > localUpdated) {
            console.warn(`⚠️  Remote segment updated after local changes: ${segment.name} — skipping (use --force to override)`);
            continue;
        }

        if (!hasSegmentChanges(segment, match)) continue;

        if (dryRun) {
            console.log(`🟡 [DRY RUN] Update segment: ${segment.name} (ID ${match.id})`);
            continue;
        }

        const updated = await leadCMSDataService.updateSegment(match.id!, toUpdatePayload(segment));
        console.log(`✅ Updated segment: ${segment.name}`);
        await updateLocalFileAfterPush(filePath, updated, remoteCtx);
    }

    if (!allowDelete) return;

    const localNames = new Set(localFiles.map(f => f.segment.name));
    const localIds = new Set(
        localFiles.map(f => f.segment.id).filter((id): id is number => id != null),
    );

    for (const remote of remoteSegments) {
        if (localNames.has(remote.name) || (remote.id != null && localIds.has(remote.id))) continue;

        if (dryRun) {
            console.log(`🟡 [DRY RUN] Delete segment: ${remote.name || remote.id}`);
            continue;
        }

        await leadCMSDataService.deleteSegment(remote.id!);
        console.log(`🗑️  Deleted segment: ${remote.name || remote.id}`);
    }
}
