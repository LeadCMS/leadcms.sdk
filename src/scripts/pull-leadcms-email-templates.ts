import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import axios, { AxiosResponse } from "axios";
import {
  leadCMSUrl,
  leadCMSApiKey,
  defaultLanguage,
  EMAIL_TEMPLATES_DIR,
} from "./leadcms-helpers.js";
import {
  parseEmailTemplateFileContent,
  transformEmailTemplateRemoteToLocalFormat,
  type EmailTemplateRemoteData,
} from "../lib/email-template-transformation.js";
import { threeWayMerge, isLocallyModified } from "../lib/content-merge.js";
import { leadCMSDataService } from "../lib/data-service.js";
import { syncTokenPath, type RemoteContext } from "../lib/remote-context.js";
import type { MetadataMap } from "../lib/remote-context.js";
import { getConfig } from "../lib/config.js";
import { slugify } from "../lib/slugify.js";
import { logger } from "../lib/logger.js";

interface ScriptError extends Error {
  code?: string;
  response?: {
    status?: number;
    data?: { detail?: string; title?: string; message?: string;[key: string]: unknown } | null;
  };
  status?: number;
}

interface EmailTemplateSyncResponse {
  items?: EmailTemplateRemoteData[];
  deleted?: number[];
  baseItems?: Record<string, EmailTemplateRemoteData>;
}

interface EmailTemplateSyncResult {
  items: EmailTemplateRemoteData[];
  deleted: number[];
  baseItems: Record<string, EmailTemplateRemoteData>;
  nextSyncToken: string;
}

const SYNC_TOKEN_PATH = path.join(EMAIL_TEMPLATES_DIR, ".sync-token");

async function readFileOrUndefined(filePath: string): Promise<string | undefined> {
  try {
    return (await fs.readFile(filePath, "utf8")).trim() || undefined;
  } catch {
    return undefined;
  }
}

interface EmailTemplateIdentityEntry {
  filePath: string;
  language: string;
  name: string;
  id?: string;
}

type EmailTemplateIdentityIndex = Map<string, EmailTemplateIdentityEntry[]>;

function emailTemplateIdentityKey(language: string, name: string): string {
  return `${language}/${name}`;
}

async function buildEmailTemplateIdentityIndex(dir: string): Promise<EmailTemplateIdentityIndex> {
  const index: EmailTemplateIdentityIndex = new Map();

  async function walk(
    currentDir: string,
    locale: string = defaultLanguage,
    baseDir: string = dir
  ): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (_err: unknown) {
      const err = _err as ScriptError;
      if (err.code !== "ENOENT") {
        console.warn(`[EMAIL_TEMPLATES] Could not read directory ${currentDir}:`, err.message);
      }
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        const isLocaleDir = currentDir === dir && /^[a-z]{2}(-[A-Z]{2})?$/.test(entry.name);
        await walk(fullPath, isLocaleDir ? entry.name : locale, isLocaleDir ? fullPath : baseDir);
      } else if (entry.isFile() && entry.name.endsWith(".html")) {
        try {
          const content = await fs.readFile(fullPath, "utf8");
          const parsed = parseEmailTemplateFileContent(content);
          const metadata = parsed.metadata || {};
          const name =
            typeof metadata.name === "string" ? metadata.name : path.basename(fullPath, ".html");
          const language = typeof metadata.language === "string" ? metadata.language : locale;
          const id = metadata.id == null ? undefined : String(metadata.id);
          const key = emailTemplateIdentityKey(language, name);
          const existing = index.get(key) ?? [];
          existing.push({ filePath: fullPath, language, name, id });
          index.set(key, existing);
        } catch {
          /* skip unreadable files */
        }
      }
    }
  }

  await walk(dir);
  return index;
}

/**
 * Read the email-templates sync token.
 * When remoteCtx is provided, reads from the remote-specific state directory.
 */
async function readSyncToken(
  remoteCtx?: RemoteContext
): Promise<{ token: string | undefined; migrated: boolean }> {
  if (remoteCtx) {
    const tokenPath = syncTokenPath(remoteCtx, "email-templates");
    const token = await readFileOrUndefined(tokenPath);
    if (token) return { token, migrated: false };

    // Migration: check old single-remote path
    const legacyToken = await readFileOrUndefined(SYNC_TOKEN_PATH);
    if (legacyToken) {
      logger.verbose(`[SYNC] Migrating email-templates sync token to remote "${remoteCtx.name}"`);
      return { token: legacyToken, migrated: true };
    }
    return { token: undefined, migrated: false };
  }

  const token = await readFileOrUndefined(SYNC_TOKEN_PATH);
  return { token, migrated: false };
}

async function writeSyncToken(token: string, remoteCtx?: RemoteContext): Promise<void> {
  if (remoteCtx) {
    const tokenPath = syncTokenPath(remoteCtx, "email-templates");
    await fs.mkdir(path.dirname(tokenPath), { recursive: true });
    await fs.writeFile(tokenPath, token, "utf8");
    return;
  }
  await fs.mkdir(path.dirname(SYNC_TOKEN_PATH), { recursive: true });
  await fs.writeFile(SYNC_TOKEN_PATH, token, "utf8");
}

async function pullEmailTemplateSync(syncToken?: string): Promise<EmailTemplateSyncResult> {
  if (!leadCMSUrl) {
    throw new Error("LeadCMS URL is not configured.");
  }

  if (!leadCMSApiKey) {
    throw new Error("LeadCMS API key is required to pull email templates.");
  }

  let allItems: EmailTemplateRemoteData[] = [];
  let allDeleted: number[] = [];
  let allBaseItems: Record<string, EmailTemplateRemoteData> = {};
  let token = syncToken || "";
  let nextSyncToken = token;

  while (true) {
    const url = new URL("/api/email-templates/sync", leadCMSUrl);
    url.searchParams.set("filter[limit]", "100");
    url.searchParams.set("syncToken", token);
    if (syncToken) {
      url.searchParams.set("includeBase", "true");
    }

    const res: AxiosResponse<EmailTemplateSyncResponse> = await axios.get(url.toString(), {
      headers: {
        Authorization: `Bearer ${leadCMSApiKey}`,
      },
    });

    if (res.status === 204) {
      break;
    }

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

  return {
    items: allItems,
    deleted: allDeleted,
    baseItems: allBaseItems,
    nextSyncToken,
  };
}

function getGroupFolderName(template: EmailTemplateRemoteData): string {
  const groupName = template.emailGroup?.name as string | undefined;
  if (groupName) {
    const slug = slugify(groupName);
    return slug || groupName;
  }

  return "ungrouped";
}

function getTemplateFileName(template: EmailTemplateRemoteData): string {
  const name = template.name || "template";
  const slug = slugify(name);
  if (slug) {
    return slug;
  }

  if (template.id != null) {
    return `template-${template.id}`;
  }

  return "template";
}

function getEmailTemplateFilePath(template: EmailTemplateRemoteData): string {
  const language = template.language || defaultLanguage;
  const groupFolder = getGroupFolderName(template);
  const fileName = getTemplateFileName(template);

  let targetDir = EMAIL_TEMPLATES_DIR;
  if (language !== defaultLanguage) {
    targetDir = path.join(targetDir, language);
  }

  return path.join(targetDir, groupFolder, `${fileName}.html`);
}

async function saveEmailTemplateFile(template: EmailTemplateRemoteData): Promise<string> {
  const filePath = getEmailTemplateFilePath(template);
  const transformed = transformEmailTemplateRemoteToLocalFormat(template);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, transformed, "utf8");
  return filePath;
}

async function buildEmailTemplateIdIndex(dir: string): Promise<Map<string, string[]>> {
  const index = new Map<string, string[]>();

  async function walk(currentDir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (_err: unknown) {
      const err = _err as ScriptError;
      if (err.code !== "ENOENT") {
        console.warn(`[EMAIL_TEMPLATES] Could not read directory ${currentDir}:`, err.message);
      }
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".html")) {
        try {
          const content = await fs.readFile(fullPath, "utf8");
          const parsed = parseEmailTemplateFileContent(content);
          const id = parsed.metadata?.id;
          if (id !== undefined && id !== null) {
            const idStr = String(id);
            const existing = index.get(idStr);
            if (existing) {
              existing.push(fullPath);
            } else {
              index.set(idStr, [fullPath]);
            }
          }
        } catch {
          // skip unreadable files
        }
      }
    }
  }

  await walk(dir);
  return index;
}

async function deleteEmailTemplateFilesById(
  index: Map<string, string[]>,
  id: string
): Promise<number> {
  const paths = index.get(id);
  if (!paths) return 0;

  let deletedCount = 0;
  for (const filePath of paths) {
    try {
      await fs.unlink(filePath);
      deletedCount++;
    } catch {
      // ignore missing files
    }
  }

  index.delete(id);
  return deletedCount;
}

async function deleteEmailTemplateFilesByIdentity(
  index: EmailTemplateIdentityIndex,
  language: string,
  name: string
): Promise<number> {
  const key = emailTemplateIdentityKey(language, name);
  const entries = index.get(key);
  if (!entries || entries.length === 0) return 0;

  let deletedCount = 0;
  for (const entry of entries) {
    try {
      await fs.unlink(entry.filePath);
      deletedCount++;
    } catch {
      // ignore missing files
    }
  }

  index.delete(key);
  return deletedCount;
}

async function cleanupStaleRemoteDeletedEmailTemplates(
  remoteCtx: RemoteContext | undefined,
  metadataMap: MetadataMap | undefined,
  rcModule: typeof import("../lib/remote-context.js") | undefined
): Promise<number> {
  if (!remoteCtx || remoteCtx.isDefault || !metadataMap || !rcModule) return 0;

  try {
    const dataServiceModule = await import("../lib/data-service.js");
    const service = dataServiceModule.leadCMSDataService as unknown as {
      getAllEmailTemplates?: () => Promise<
        Array<{ id?: number | string; name?: string; language?: string }>
      >;
      isMockMode?: () => boolean;
    };
    if (service.isMockMode?.()) return 0;
    if (typeof service.getAllEmailTemplates !== "function") return 0;

    const remoteTemplates = await service.getAllEmailTemplates();
    const remoteIds = new Set(
      remoteTemplates
        .map((template) => template.id)
        .filter((id): id is number | string => id != null)
    );
    const remoteKeys = new Set(
      remoteTemplates
        .filter((template) => template.name)
        .map((template) =>
          emailTemplateIdentityKey(template.language || defaultLanguage, template.name!)
        )
    );
    const localIndex = await buildEmailTemplateIdentityIndex(EMAIL_TEMPLATES_DIR);
    let removed = 0;

    for (const [key, entries] of Array.from(localIndex.entries())) {
      const [language, ...nameParts] = key.split("/");
      const name = nameParts.join("/");
      const remoteId = metadataMap.emailTemplates?.[language]?.[name]?.id;
      const wasSynced = remoteId != null || entries.some((entry) => entry.id != null);
      if (!wasSynced) continue;

      const missingRemoteId = remoteId != null && !remoteIds.has(remoteId);
      const missingRemoteKey = remoteId == null && !remoteKeys.has(key);
      if (!missingRemoteId && !missingRemoteKey) continue;

      removed += await deleteEmailTemplateFilesByIdentity(localIndex, language, name);
      if (metadataMap.emailTemplates?.[language]?.[name]) {
        delete metadataMap.emailTemplates[language][name];
        if (Object.keys(metadataMap.emailTemplates[language]).length === 0) {
          delete metadataMap.emailTemplates[language];
        }
      }
    }

    return removed;
  } catch (_error: unknown) {
    const error = _error as Error;
    logger.verbose(`[PULL] Skipping stale email template cleanup: ${error.message}`);
    return 0;
  }
}

export async function pullLeadCMSEmailTemplates(remoteCtx?: RemoteContext): Promise<void> {
  const { token: lastSyncToken } = await readSyncToken(remoteCtx);

  const { items, deleted, baseItems, nextSyncToken } = await pullEmailTemplateSync(lastSyncToken);

  // Load per-remote metadata for multi-remote support
  let metadataMap: MetadataMap | undefined;
  const rcModule = remoteCtx ? await import("../lib/remote-context.js") : undefined;
  if (remoteCtx && rcModule) {
    metadataMap = await rcModule.readMetadataMap(remoteCtx);
  }

  // Load defaultRemote's maps so frontmatter always reflects the default
  // remote's ids and timestamps, even when pulling from another remote.
  // Derive defaultRemote stateDir from the current remote's stateDir (sibling
  // directory) so it works regardless of process.cwd().
  let defaultMetadataMap: MetadataMap | undefined;
  if (remoteCtx && !remoteCtx.isDefault && rcModule) {
    const cfg = getConfig();
    if (cfg.defaultRemote) {
      const defaultStateDir = path.join(path.dirname(remoteCtx.stateDir), cfg.defaultRemote);
      const defaultCtx: import("../lib/remote-context.js").RemoteContext = {
        name: cfg.defaultRemote,
        url: cfg.remotes?.[cfg.defaultRemote]?.url || "",
        isDefault: true,
        stateDir: defaultStateDir,
      };
      defaultMetadataMap = await rcModule.readMetadataMap(defaultCtx);
    }
  }

  // The sync API returns emailGroup: null — resolve from the groups endpoint
  if (items.length > 0) {
    const emailGroups = await leadCMSDataService.getAllEmailGroups();
    const groupById = new Map(emailGroups.map((g) => [Number(g.id), g]));

    for (const template of items) {
      if (template.emailGroupId != null && !template.emailGroup) {
        const group = groupById.get(Number(template.emailGroupId));
        if (group) {
          template.emailGroup = { id: group.id, name: group.name, language: group.language };
        }
      }
    }

    // Also enrich base items for three-way merge
    for (const base of Object.values(baseItems)) {
      if (base.emailGroupId != null && !base.emailGroup) {
        const group = groupById.get(Number(base.emailGroupId));
        if (group) {
          base.emailGroup = { id: group.id, name: group.name, language: group.language };
        }
      }
    }
  }

  const idIndex =
    items.length > 0 || deleted.length > 0
      ? await buildEmailTemplateIdIndex(EMAIL_TEMPLATES_DIR)
      : new Map<string, string[]>();
  const identityIndex =
    items.length > 0 || deleted.length > 0
      ? await buildEmailTemplateIdentityIndex(EMAIL_TEMPLATES_DIR)
      : new Map<string, EmailTemplateIdentityEntry[]>();

  console.log(
    `📧 Processing email template sync (${items.length} remote update(s), ${deleted.length} remote deletion event(s))...`
  );

  const hasBaseItems = Object.keys(baseItems).length > 0;
  let mergedCount = 0;
  let conflictCount = 0;
  let overwrittenCount = 0;
  let newCount = 0;

  for (const template of items) {
    const idStr = template.id != null ? String(template.id) : undefined;
    const filePath = getEmailTemplateFilePath(template);

    // Capture old entry BEFORE updating metadata so we can detect renames
    // using the correct remote's IDs (not the default remote's file IDs).
    const oldEntry =
      remoteCtx && !remoteCtx.isDefault && rcModule && metadataMap && idStr
        ? rcModule.findEmailTemplateByRemoteId(metadataMap, idStr)
        : undefined;

    // Update per-remote metadata with this template's data
    if (remoteCtx && rcModule && metadataMap && template.name && template.language) {
      if (template.id != null) {
        rcModule.setEmailTemplateRemoteId(
          metadataMap,
          template.language || defaultLanguage,
          template.name,
          template.id
        );
      }
      rcModule.setMetadataForEmailTemplate(
        metadataMap,
        template.language || defaultLanguage,
        template.name,
        {
          createdAt: template.createdAt,
          updatedAt: template.updatedAt ?? undefined,
        }
      );
    }

    // For non-default remotes, replace server-generated fields with the
    // defaultRemote's values so frontmatter always reflects prod ids/dates.
    // The current remote's values are already stored in its per-remote maps.
    let templateToSave = template;
    if (remoteCtx && !remoteCtx.isDefault) {
      const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = template;
      const lang = template.language || defaultLanguage;
      const name = template.name || "";
      const defaultId = defaultMetadataMap?.emailTemplates?.[lang]?.[name]?.id;
      const defaultMeta = defaultMetadataMap?.emailTemplates?.[lang]?.[name];
      templateToSave = {
        ...(defaultId != null ? { id: defaultId } : {}),
        ...(defaultMeta?.createdAt ? { createdAt: defaultMeta.createdAt } : {}),
        ...(defaultMeta?.updatedAt ? { updatedAt: defaultMeta.updatedAt } : {}),
        ...rest,
      } as EmailTemplateRemoteData;
    }

    let localContent: string | null = null;
    try {
      localContent = await fs.readFile(filePath, "utf8");
    } catch {
      // file does not exist
    }

    // Remove old files if the template was renamed or language changed.
    if (remoteCtx && !remoteCtx.isDefault) {
      // Non-default remote: use metadata-based lookup to avoid
      // matching against the default remote's IDs in local files.
      if (
        oldEntry &&
        (oldEntry.name !== template.name ||
          oldEntry.language !== (template.language || defaultLanguage))
      ) {
        const oldTemplate = {
          ...template,
          name: oldEntry.name,
          language: oldEntry.language,
        } as EmailTemplateRemoteData;
        const oldPath = getEmailTemplateFilePath(oldTemplate);
        console.log(
          `   🗑️  Removing old email template file: ${path.basename(oldPath)} (name or language changed)`
        );
        try {
          await fs.unlink(oldPath);
        } catch {
          /* ignore */
        }
      }
    } else if (idStr != null) {
      const oldPaths = idIndex.get(idStr);
      if (oldPaths && oldPaths.length > 0 && !oldPaths.some((p) => p === filePath)) {
        console.log(
          `   🗑️  Removing old email template file: ${oldPaths.map((p) => path.basename(p)).join(", ")} (name or language changed)`
        );
      }
      await deleteEmailTemplateFilesById(idIndex, idStr);
    }

    const baseTemplate = idStr ? baseItems[idStr] : undefined;

    if (localContent && baseTemplate && hasBaseItems) {
      const baseTransformed = transformEmailTemplateRemoteToLocalFormat(baseTemplate);
      const remoteTransformed = transformEmailTemplateRemoteToLocalFormat(templateToSave);

      if (!isLocallyModified(baseTransformed, localContent)) {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, remoteTransformed, "utf8");
        overwrittenCount++;
      } else {
        const mergeResult = threeWayMerge(baseTransformed, localContent, remoteTransformed);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, mergeResult.merged, "utf8");

        if (mergeResult.success) {
          console.log(`🔀 Auto-merged: ${template.name || template.id}`);
          mergedCount++;
        } else {
          console.warn(
            `⚠️  Conflict in: ${template.name || template.id} (${mergeResult.conflictCount} conflict(s))`
          );
          conflictCount++;
        }
      }
    } else {
      await saveEmailTemplateFile(templateToSave);
      if (localContent) {
        overwrittenCount++;
      } else {
        newCount++;
      }
    }
  }

  if (items.length > 0) {
    console.log(`   ✅ Processed ${items.length} email template update(s).`);
    if (newCount > 0) console.log(`   ✨ New: ${newCount}`);
    if (overwrittenCount > 0) console.log(`   📝 Updated (no local changes): ${overwrittenCount}`);
    if (mergedCount > 0) console.log(`   🔀 Auto-merged: ${mergedCount}`);
    if (conflictCount > 0)
      console.log(`   ⚠️  Conflicts (need manual resolution): ${conflictCount}`);
  }

  let deletedLocalTemplates = 0;
  let deletionEventsWithoutLocalFile = 0;
  let deletionEventsUnknownToMetadata = 0;
  if (deleted.length > 0) {
    console.log(`🗑️  Applying email template deletions (${deleted.length} remote event(s))...`);
  }
  for (const id of deleted) {
    if (remoteCtx && !remoteCtx.isDefault && rcModule && metadataMap) {
      // Non-default remote: resolve ID → name via metadata.
      const entry = rcModule.findEmailTemplateByRemoteId(metadataMap, id);
      if (entry) {
        let eventDeletedCount = await deleteEmailTemplateFilesByIdentity(
          identityIndex,
          entry.language,
          entry.name
        );
        if (eventDeletedCount > 0) {
          console.log(`   🗑️  ${entry.name} (deleted on remote)`);
          deletedLocalTemplates += eventDeletedCount;
        }

        // If identity lookup misses, use the default remote's ID to look up the
        // actual file path in idIndex because local frontmatter stores that ID.
        const defaultId = defaultMetadataMap?.emailTemplates?.[entry.language]?.[entry.name]?.id;
        const indexKey = defaultId != null ? String(defaultId) : null;
        const paths = eventDeletedCount === 0 && indexKey ? idIndex.get(indexKey) : undefined;
        if (paths && paths.length > 0) {
          console.log(
            `   🗑️  ${paths.map((p) => path.basename(p)).join(", ")} (deleted on remote)`
          );
          for (const filePath of paths) {
            try {
              await fs.unlink(filePath);
              eventDeletedCount++;
              deletedLocalTemplates++;
            } catch {
              /* ignore */
            }
          }
          if (indexKey) idIndex.delete(indexKey);
        } else if (eventDeletedCount === 0) {
          // Fallback: construct path from name/language (emailGroup unknown — may miss grouped templates)
          const oldTemplate = {
            name: entry.name,
            language: entry.language,
          } as EmailTemplateRemoteData;
          const filePath = getEmailTemplateFilePath(oldTemplate);
          try {
            await fs.unlink(filePath);
            eventDeletedCount++;
            deletedLocalTemplates++;
            console.log(`   🗑️  ${path.basename(filePath)} (deleted on remote)`);
          } catch {
            /* ignore */
          }
        }
        if (eventDeletedCount === 0) {
          deletionEventsWithoutLocalFile++;
        }
        // Clean up metadata entry
        if (metadataMap.emailTemplates?.[entry.language]?.[entry.name]) {
          delete metadataMap.emailTemplates[entry.language][entry.name];
        }
      } else {
        deletionEventsUnknownToMetadata++;
      }
    } else {
      const paths = idIndex.get(String(id));
      if (paths && paths.length > 0) {
        console.log(`   🗑️  ${paths.map((p) => path.basename(p)).join(", ")} (deleted on remote)`);
      }
      const deletedCount = await deleteEmailTemplateFilesById(idIndex, String(id));
      if (deletedCount > 0) {
        deletedLocalTemplates += deletedCount;
      } else {
        deletionEventsWithoutLocalFile++;
      }
    }
  }

  if (deleted.length > 0) {
    if (deletedLocalTemplates > 0) {
      console.log(`   ✅ Removed ${deletedLocalTemplates} local email template file(s).`);
    }
    const skippedDeletionEvents = deletionEventsWithoutLocalFile + deletionEventsUnknownToMetadata;
    if (skippedDeletionEvents > 0) {
      console.log(
        `   ℹ️  ${skippedDeletionEvents} remote deletion event(s) had no matching local file.`
      );
    }
  }

  const staleTemplatesRemoved = await cleanupStaleRemoteDeletedEmailTemplates(
    remoteCtx,
    metadataMap,
    rcModule
  );
  if (staleTemplatesRemoved > 0) {
    if (deleted.length === 0) {
      console.log(`🧹 Cleaning up stale email template files...`);
    }
    console.log(
      `   ✅ Removed ${staleTemplatesRemoved} stale email template file(s) from earlier remote deletions.`
    );
  }

  if (items.length === 0 && deleted.length === 0 && staleTemplatesRemoved === 0) {
    console.log(`No email template changes detected.`);
  }

  // Persist per-remote metadata after processing all templates
  if (
    remoteCtx &&
    rcModule &&
    metadataMap &&
    (items.length > 0 || deleted.length > 0 || staleTemplatesRemoved > 0)
  ) {
    await rcModule.writeMetadataMap(remoteCtx, metadataMap);
    logger.verbose(`[PULL] Updated metadata-map for remote "${remoteCtx.name}"`);
  }

  if (nextSyncToken) {
    await writeSyncToken(nextSyncToken, remoteCtx);
  }
}

export {
  buildEmailTemplateIdIndex,
  deleteEmailTemplateFilesById,
  saveEmailTemplateFile,
  pullEmailTemplateSync,
};
