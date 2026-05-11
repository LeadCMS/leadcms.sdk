/**
 * Pull redirects from LeadCMS.
 * Stores all redirects as a single YAML file: <redirectsDir>/redirects.yaml
 *
 * Pull sequence:
 *   1. POST /api/redirects/discover  — trigger server auto-discovery
 *   2. GET /api/redirects/sync?syncToken=...&filter[limit]=100  — SSE-style pagination
 *   3. Merge changes, persist updated sync token
 */

import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import axios, { AxiosResponse } from "axios";
import yaml from "js-yaml";
import { leadCMSUrl, leadCMSApiKey, REDIRECTS_DIR, singleLanguage } from "./leadcms-helpers.js";
import { syncTokenPath, resolveRemote, readMetadataMap, writeMetadataMap, type RemoteContext } from "../lib/remote-context.js";
import { logger } from "../lib/logger.js";
import type { RedirectDetailsDto, LocalRedirect, LocalRedirectsFile } from "../lib/automation-types.js";
import { toLocalRedirect, redirectSurrogateKey, flattenRedirectsFile, buildRedirectsFile, stripDefaultLanguage, injectDefaultLanguage } from "../lib/automation-types.js";

// ── Types ──────────────────────────────────────────────────────────────

interface RedirectSyncResponse {
  items?: RedirectDetailsDto[];
  deleted?: number[];
}

interface RedirectSyncResult {
  items: RedirectDetailsDto[];
  deleted: number[];
  nextSyncToken: string;
}

export interface PullRedirectsOptions {
  /** When true, delete all local redirect data and sync token before pulling. */
  reset?: boolean;
  /** Optional remote context for multi-remote sync token isolation. */
  remoteContext?: RemoteContext;
}

// ── Helpers ────────────────────────────────────────────────────────────

function getRedirectsFilePath(): string {
  return path.join(REDIRECTS_DIR, "redirects.yaml");
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
    const tokenPath = syncTokenPath(remoteCtx, "redirects");
    return readFileOrUndefined(tokenPath);
  }
  return readFileOrUndefined(path.join(REDIRECTS_DIR, ".sync-token"));
}

async function writeSyncToken(token: string, remoteCtx?: RemoteContext): Promise<void> {
  if (remoteCtx) {
    const tokenPath = syncTokenPath(remoteCtx, "redirects");
    await fs.mkdir(path.dirname(tokenPath), { recursive: true });
    await fs.writeFile(tokenPath, token, "utf8");
    return;
  }
  await fs.mkdir(REDIRECTS_DIR, { recursive: true });
  await fs.writeFile(path.join(REDIRECTS_DIR, ".sync-token"), token, "utf8");
}

async function readLocalRedirectsFile(): Promise<LocalRedirectsFile> {
  const filePath = getRedirectsFilePath();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = yaml.load(raw) as LocalRedirectsFile | null;
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch { /* file doesn't exist or is invalid */ }
  return {};
}

async function writeLocalRedirectsFile(redirects: LocalRedirect[]): Promise<void> {
  await fs.mkdir(REDIRECTS_DIR, { recursive: true });
  const filePath = getRedirectsFilePath();
  // Strip any legacy server-managed fields and sort by surrogate key within each section
  const cleaned = redirects.map(r => {
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = r as any;
    return rest as LocalRedirect;
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
  await fs.writeFile(filePath, content, "utf8");
}

// ── API sync ───────────────────────────────────────────────────────────

async function triggerDiscover(): Promise<void> {
  if (!leadCMSUrl) {
    throw new Error("LeadCMS URL is not configured.");
  }
  if (!leadCMSApiKey) {
    throw new Error("LeadCMS API key is required to pull redirects.");
  }

  logger.verbose("[API] Triggering redirect discovery");
  try {
    await axios.post(`${leadCMSUrl}/api/redirects/discover`, null, {
      headers: { Authorization: `Bearer ${leadCMSApiKey}` },
    });
  } catch (error: any) {
    // Discovery trigger is best-effort — warn but don't abort
    logger.verbose(`[API] Redirect discovery returned an error (continuing): ${error.message}`);
  }
}

async function pullRedirectsSync(syncToken?: string): Promise<RedirectSyncResult> {
  if (!leadCMSUrl) {
    throw new Error("LeadCMS URL is not configured.");
  }
  if (!leadCMSApiKey) {
    throw new Error("LeadCMS API key is required to pull redirects.");
  }

  const allItems: RedirectDetailsDto[] = [];
  const allDeleted: number[] = [];
  let token = syncToken || "";
  let nextSyncToken = token;

  while (true) {
    const url = new URL("/api/redirects/sync", leadCMSUrl);
    url.searchParams.set("filter[limit]", "100");
    url.searchParams.set("syncToken", token);

    logger.verbose(`[API] Fetching redirects sync (syncToken=${token || "(none)"})`);

    const res: AxiosResponse<RedirectSyncResponse> = await axios.get(url.toString(), {
      headers: { Authorization: `Bearer ${leadCMSApiKey}` },
    });

    if (res.status === 204) break;

    const data = res.data || {};
    if (Array.isArray(data.items)) {
      allItems.push(...data.items);
    }
    if (Array.isArray(data.deleted)) {
      allDeleted.push(...data.deleted);
    }

    const newToken = res.headers["x-next-sync-token"] || token;
    if (!newToken || newToken === token) {
      nextSyncToken = newToken || token;
      break;
    }

    nextSyncToken = newToken;
    token = newToken;
  }

  return { items: allItems, deleted: allDeleted, nextSyncToken };
}

// ── Merge ──────────────────────────────────────────────────────────────

// ── Id-map (surrogate-key → remote ID, stored in metadata.json) ─────────────

type RedirectIdMap = Record<string, number>;

async function readIdMap(remoteCtx?: RemoteContext): Promise<RedirectIdMap> {
  const ctx = remoteCtx ?? resolveRemote();
  const map = await readMetadataMap(ctx);
  return map.redirects ?? {};
}

async function writeIdMap(idMap: RedirectIdMap, metadataCtx: RemoteContext): Promise<void> {
  const map = await readMetadataMap(metadataCtx);
  map.redirects = idMap;
  await writeMetadataMap(metadataCtx, map);
}

// ── Merge ─────────────────────────────────────────────────────────────

function mergeRedirects(
  existing: LocalRedirect[],
  incoming: RedirectDetailsDto[],
  deleted: number[],
  idMap: RedirectIdMap,
): LocalRedirect[] {
  const byKey = new Map<string, LocalRedirect>(
    existing.map(r => [redirectSurrogateKey(r), r])
  );

  // Build reverse id→key map from the id-map for deletion lookups
  const idToKey = new Map<number, string>(
    Object.entries(idMap).map(([key, id]) => [id as number, key])
  );

  // Apply deletions
  for (const id of deleted) {
    const key = idToKey.get(id);
    if (key) {
      byKey.delete(key);
      delete idMap[key];
    }
  }

  // Upsert incoming items and update id-map
  for (const dto of incoming) {
    const key = redirectSurrogateKey(dto);
    byKey.set(key, toLocalRedirect(dto));
    idMap[key] = dto.id;
  }

  return Array.from(byKey.values());
}

// ── Main export ────────────────────────────────────────────────────────

export async function pullLeadCMSRedirects(
  optionsOrRemoteCtx?: PullRedirectsOptions | RemoteContext
): Promise<void> {
  let reset: boolean | undefined;
  let remoteCtx: RemoteContext | undefined;

  if (optionsOrRemoteCtx && "name" in optionsOrRemoteCtx && "url" in optionsOrRemoteCtx) {
    remoteCtx = optionsOrRemoteCtx as RemoteContext;
  } else if (optionsOrRemoteCtx) {
    const opts = optionsOrRemoteCtx as PullRedirectsOptions;
    reset = opts.reset;
    remoteCtx = opts.remoteContext;
  }

  if (reset) {
    console.log(`🔄 Resetting redirects state...\n`);
    const { resetRedirectsState } = await import("./pull-all.js");
    await resetRedirectsState(remoteCtx);
  }

  // Step 1: Trigger discovery (errors are non-fatal)
  await triggerDiscover();

  // Step 2: Sync
  const lastSyncToken = await readSyncToken(remoteCtx);
  const { items, deleted, nextSyncToken } = await pullRedirectsSync(lastSyncToken);

  // Step 3: Merge into local file
  const local = await readLocalRedirectsFile();
  const metadataCtx = remoteCtx ?? resolveRemote();
  const idMap = await readIdMap(metadataCtx);
  const flat = flattenRedirectsFile(local);
  const flatWithLang = singleLanguage ? injectDefaultLanguage(flat, singleLanguage) : flat;
  const merged = mergeRedirects(flatWithLang, items, deleted, idMap);

  // Only write if something changed
  const changed = items.length > 0 || deleted.length > 0;

  if (changed) {
    await writeLocalRedirectsFile(merged);
    await writeIdMap(idMap, metadataCtx);
    console.log(`   ✅ ${items.length} redirect(s) updated, ${deleted.length} deleted. Total: ${merged.length}`);
  } else {
    // Still write id-map if it doesn't exist yet (first run against existing YAML)
    await writeIdMap(idMap, metadataCtx);
    console.log(`   ✅ Redirects already up to date (${merged.length} total)`);
  }

  // Step 4: Persist sync token
  if (nextSyncToken) {
    await writeSyncToken(nextSyncToken, remoteCtx);
  }
}
