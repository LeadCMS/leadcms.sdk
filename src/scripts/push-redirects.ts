/**
 * Push redirects to LeadCMS.
 *
 * Reads local redirects.yaml, compares to remote, and:
 *   - Creates redirects that don't exist remotely (no id or no remote match by id)
 *   - Updates redirects that have changed
 *   - Optionally deletes remote redirects not present locally (--delete)
 *
 * After push, writes back any assigned IDs and updatedAt to local YAML.
 */

import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import yaml from "js-yaml";
import { REDIRECTS_DIR, singleLanguage } from "./leadcms-helpers.js";
import { leadCMSDataService } from "../lib/data-service.js";
import { colorConsole, statusColors } from "../lib/console-colors.js";
import { logger } from "../lib/logger.js";
import type { RemoteContext } from "../lib/remote-context.js";
import type {
  RedirectDetailsDto,
  LocalRedirect,
  LocalRedirectsFile,
} from "../lib/automation-types.js";
import {
  detectSourceType,
  detectTargetType,
  redirectSurrogateKey,
  toRedirectCreateDto,
  toRedirectUpdateDto,
  flattenRedirectsFile,
  buildRedirectsFile,
  stripDefaultLanguage,
  injectDefaultLanguage,
} from "../lib/automation-types.js";
import { pullRedirectsSync, readRedirectSyncTokenForStatus } from "./pull-redirects.js";

// ── Types ──────────────────────────────────────────────────────────────

export interface PushRedirectsOptions {
  force?: boolean;
  dryRun?: boolean;
  allowDelete?: boolean;
  quiet?: boolean;
  remoteContext?: RemoteContext;
}

export interface RedirectOperation {
  type: "create" | "update" | "delete" | "skip" | "remote-deleted";
  local?: LocalRedirect;
  remote?: RedirectDetailsDto;
  reason?: string;
}

// ── Local file reading ─────────────────────────────────────────────────

function getRedirectsFilePath(): string {
  return path.join(REDIRECTS_DIR, "redirects.yaml");
}

async function readLocalRedirects(): Promise<LocalRedirect[]> {
  const filePath = getRedirectsFilePath();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = yaml.load(raw) as LocalRedirectsFile | null;
    if (parsed && typeof parsed === "object") {
      const flat = flattenRedirectsFile(parsed);
      return singleLanguage ? injectDefaultLanguage(flat, singleLanguage) : flat;
    }
  } catch {
    /* file doesn't exist */
  }
  return [];
}

async function writeLocalRedirects(redirects: LocalRedirect[]): Promise<void> {
  await fs.mkdir(REDIRECTS_DIR, { recursive: true });
  // Strip any legacy server-managed fields and sort by surrogate key within each section
  const cleaned = redirects.map((r) => {
    const {
      id: _id,
      createdAt: _c,
      updatedAt: _u,
      ...rest
    } = r as unknown as Record<string, unknown>;
    return rest as unknown as LocalRedirect;
  });
  const sorted = [...cleaned].sort((a, b) =>
    redirectSurrogateKey(a).localeCompare(redirectSurrogateKey(b))
  );
  const stripped = singleLanguage ? stripDefaultLanguage(sorted, singleLanguage) : sorted;
  const file = buildRedirectsFile(stripped);
  const content = yaml.dump(file, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });
  await fs.writeFile(getRedirectsFilePath(), content, "utf8");
}

// ── Change detection ───────────────────────────────────────────────────

/** Derive the comparable "payload" fields for a local redirect. */
function localPayloadKey(r: LocalRedirect): string {
  return JSON.stringify({
    sourceType: detectSourceType(r),
    targetType: detectTargetType(r),
    kind: r.kind,
    fromPath: r.fromPath ?? null,
    fromLanguage: r.fromLanguage ?? null,
    fromSlug: r.fromSlug ?? null,
    fromContentId: r.fromContentId ?? null,
    toUrl: r.toUrl ?? null,
    toPath: r.toPath ?? null,
    toLanguage: r.toLanguage ?? null,
    toSlug: r.toSlug ?? null,
    toContentId: r.toContentId ?? null,
  });
}

/** Derive the comparable "payload" fields for a remote redirect. */
function remotePayloadKey(r: RedirectDetailsDto): string {
  return JSON.stringify({
    sourceType: r.sourceType,
    targetType: r.targetType,
    kind: r.kind,
    fromPath: r.fromPath ?? null,
    fromLanguage: r.fromLanguage ?? null,
    fromSlug: r.fromSlug ?? null,
    fromContentId: r.fromContentId ?? null,
    toUrl: r.toUrl ?? null,
    toPath: r.toPath ?? null,
    toLanguage: r.toLanguage ?? null,
    toSlug: r.toSlug ?? null,
    toContentId: r.toContentId ?? null,
  });
}

// ── Plan operations ────────────────────────────────────────────────────

async function readRedirectIdMap(remoteCtx?: RemoteContext): Promise<Record<string, number>> {
  try {
    const rc = await import("../lib/remote-context.js");
    const ctx = remoteCtx ?? rc.resolveRemote();
    const map = await rc.readMetadataMap(ctx);
    return map.redirects ?? {};
  } catch {
    return {};
  }
}

function planOperations(
  locals: LocalRedirect[],
  remotes: RedirectDetailsDto[],
  allowDelete: boolean,
  idMap?: Record<string, number>
): RedirectOperation[] {
  const ops: RedirectOperation[] = [];
  const remoteByKey = new Map<string, RedirectDetailsDto>(
    remotes.map((r) => [redirectSurrogateKey(r), r])
  );
  const remoteIds = new Set(remotes.map((r) => r.id));
  const localKeys = new Set<string>();

  for (const local of locals) {
    const key = redirectSurrogateKey(local);
    localKeys.add(key);
    const remote = remoteByKey.get(key);
    if (remote) {
      if (localPayloadKey(local) !== remotePayloadKey(remote)) {
        ops.push({ type: "update", local, remote });
      } else {
        ops.push({ type: "skip", local, remote, reason: "no changes" });
      }
    } else if (idMap && idMap[key] !== undefined && !remoteIds.has(idMap[key])) {
      ops.push({ type: "remote-deleted", local });
    } else {
      ops.push({ type: "create", local });
    }
  }

  if (allowDelete) {
    for (const [key, remote] of remoteByKey) {
      if (!localKeys.has(key)) {
        ops.push({ type: "delete", remote });
      }
    }
  }

  return ops;
}

function appendRemoteOnlyCreates(
  ops: RedirectOperation[],
  locals: LocalRedirect[],
  remotes: RedirectDetailsDto[]
): void {
  const localKeys = new Set(locals.map((local) => redirectSurrogateKey(local)));
  const existingOpKeys = new Set(
    ops
      .map((op) => op.local ?? op.remote)
      .filter((redirect): redirect is LocalRedirect | RedirectDetailsDto => Boolean(redirect))
      .map((redirect) => redirectSurrogateKey(redirect))
  );

  for (const remote of remotes) {
    const key = redirectSurrogateKey(remote);
    if (!localKeys.has(key) && !existingOpKeys.has(key)) {
      ops.push({ type: "create", remote, reason: "New redirect on remote" });
      existingOpKeys.add(key);
    }
  }
}

// ── Main export ────────────────────────────────────────────────────────

export async function pushRedirects(options: PushRedirectsOptions = {}): Promise<void> {
  const { force: _force, dryRun = false, allowDelete = false, quiet = false, remoteContext } =
    options;

  if (remoteContext) {
    leadCMSDataService.configureForRemote(remoteContext.url, remoteContext.apiKey);
  }

  const locals = await readLocalRedirects();

  if (locals.length === 0 && !allowDelete) {
    console.log("   ℹ️  No local redirects found — nothing to push.");
    return;
  }

  let remotes: RedirectDetailsDto[];
  try {
    remotes = await leadCMSDataService.getAllRedirects();
  } catch (_error: unknown) {
    const error = _error as Error;
    console.error(`   ❌ Failed to fetch remote redirects: ${error.message}`);
    throw error;
  }

  const idMap = await readRedirectIdMap(remoteContext);
  const ops = planOperations(locals, remotes, allowDelete, idMap);

  const creates = ops.filter((o) => o.type === "create");
  const updates = ops.filter((o) => o.type === "update");
  const deletes = ops.filter((o) => o.type === "delete");
  const skips = ops.filter((o) => o.type === "skip");

  if (!quiet) {
    console.log(`\n   📊 Redirect sync plan:`);
    console.log(`      Create:  ${creates.length}`);
    console.log(`      Update:  ${updates.length}`);
    console.log(`      Delete:  ${deletes.length}`);
    console.log(`      Skip:    ${skips.length}`);
  }

  if (dryRun) {
    colorConsole.info(`\n   🔍 Dry run — no changes applied`);
    return;
  }

  // Create
  for (const op of creates) {
    const dto = toRedirectCreateDto(op.local!);
    try {
      const created = await leadCMSDataService.createRedirect(dto);
      colorConsole.success(`    + Created redirect #${created.id} (${created.kind})`);
    } catch (_error: unknown) {
      const error = _error as Error;
      colorConsole.error(`   ❌ Failed to create redirect: ${error.message}`);
    }
  }

  // Update
  for (const op of updates) {
    const dto = toRedirectUpdateDto(op.local!);
    try {
      const updated = await leadCMSDataService.updateRedirect(op.remote!.id, dto);
      colorConsole.info(`    ~ Updated redirect #${updated.id} (${updated.kind})`);
    } catch (_error: unknown) {
      const error = _error as Error;
      colorConsole.error(`   ❌ Failed to update redirect #${op.remote!.id}: ${error.message}`);
    }
  }

  // Delete
  for (const op of deletes) {
    try {
      await leadCMSDataService.deleteRedirect(op.remote!.id);
      colorConsole.warn(`    - Deleted redirect #${op.remote!.id}`);
    } catch (_error: unknown) {
      const error = _error as Error;
      colorConsole.error(`   ❌ Failed to delete redirect #${op.remote!.id}: ${error.message}`);
    }
  }

  // Write back to strip any legacy id/createdAt/updatedAt fields
  await writeLocalRedirects(locals);

  const changed = creates.length + updates.length + deletes.length;
  logger.verbose(`[push-redirects] Done: ${changed} change(s) applied`);
}

// ── Status ────────────────────────────────────────────────────────────

export interface RedirectStatusResult {
  operations: RedirectOperation[];
  totalLocal: number;
}

function labelRedirect(local?: LocalRedirect, remote?: RedirectDetailsDto): string {
  const fmtSlug = (lang: string | null | undefined, slug: string | null | undefined) =>
    slug ? (lang ? `[${lang}] ${slug}` : slug) : null;

  const from =
    local?.fromPath ??
    fmtSlug(local?.fromLanguage, local?.fromSlug) ??
    (local?.fromContentId != null ? `ContentId:${local.fromContentId}` : null) ??
    remote?.fromPath ??
    fmtSlug(remote?.fromLanguage, remote?.fromSlug) ??
    "unknown";
  const to =
    local?.toPath ??
    local?.toUrl ??
    fmtSlug(local?.toLanguage, local?.toSlug) ??
    (local?.toContentId != null ? `ContentId:${local.toContentId}` : null) ??
    remote?.toPath ??
    remote?.toUrl ??
    fmtSlug(remote?.toLanguage, remote?.toSlug) ??
    "unknown";
  const kindCode = (local?.kind ?? remote?.kind) === "Permanent" ? "301" : "302";
  return `[${kindCode}] ${from} → ${to}`;
}

export async function buildRedirectStatus(
  options: { showDelete?: boolean; remoteContext?: RemoteContext } = {}
): Promise<RedirectStatusResult> {
  const { showDelete = false, remoteContext } = options;
  if (remoteContext) {
    leadCMSDataService.configureForRemote(remoteContext.url, remoteContext.apiKey);
  }
  const locals = await readLocalRedirects();
  const remotes = await leadCMSDataService.getAllRedirects();
  const idMap = await readRedirectIdMap(remoteContext);
  const ops = planOperations(locals, remotes, showDelete, idMap);

  appendRemoteOnlyCreates(ops, locals, remotes);

  try {
    const syncToken = await readRedirectSyncTokenForStatus(remoteContext);
    if (syncToken) {
      const syncResult = await pullRedirectsSync(syncToken, remoteContext?.url);
      appendRemoteOnlyCreates(ops, locals, syncResult.items);
    }
  } catch {
    // Status should still work offline or against older servers without sync support.
  }

  return {
    operations: ops.filter((o) => o.type !== "skip"),
    totalLocal: locals.length,
  };
}

export async function statusRedirects(
  options: { showDelete?: boolean; remoteContext?: RemoteContext } = {}
): Promise<void> {
  if (!leadCMSDataService.isApiKeyConfigured()) {
    colorConsole.important("\n📊 LeadCMS Redirect Status");
    colorConsole.log("");
    colorConsole.warn("⏭️  Redirects require authentication — no API key configured, skipping");
    return;
  }
  const result = await buildRedirectStatus(options);
  const { operations } = result;
  colorConsole.important("\n📊 LeadCMS Redirect Status");
  colorConsole.log("");
  if (operations.length === 0) {
    colorConsole.success("✅ All redirects are in sync!");
    colorConsole.log("");
    return;
  }
  for (const op of operations) {
    const label = labelRedirect(op.local, op.remote);
    const idLabel = op.remote?.id ? colorConsole.gray(`(ID: ${op.remote.id})`) : "";
    switch (op.type) {
      case "create": {
        const createLabel = op.remote && !op.local ? "added remotely:" : "added locally: ";
        colorConsole.log(
          `   ${statusColors.created(createLabel)} ${colorConsole.highlight(label)}`
        );
        break;
      }
      case "update":
        colorConsole.log(
          `   ${statusColors.modified("updated locally:")} ${colorConsole.highlight(label)} ${idLabel}`
        );
        break;
      case "delete":
        colorConsole.log(
          `   ${statusColors.conflict("deleted locally:")} ${colorConsole.highlight(label)} ${idLabel}`
        );
        break;
      case "remote-deleted":
        colorConsole.log(
          `   ${statusColors.conflict("deleted remotely:")} ${colorConsole.highlight(label)}`
        );
        break;
    }
  }
  if (operations.some((op) => op.type === "create" && op.remote && !op.local)) {
    const remoteFlag = options.remoteContext?.name ? ` -r ${options.remoteContext.name}` : "";
    colorConsole.log("");
    colorConsole.info(
      `Run "leadcms pull-redirects${remoteFlag}" to sync remote redirects locally.`
    );
  }
  colorConsole.log("");
}
