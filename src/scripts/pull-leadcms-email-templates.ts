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

/**
 * Read the email-templates sync token.
 * When remoteCtx is provided, reads from the remote-specific state directory.
 */
async function readSyncToken(remoteCtx?: RemoteContext): Promise<{ token: string | undefined; migrated: boolean }> {
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
  const groupName = template.emailGroup?.name;
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
    } catch (err: any) {
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

async function deleteEmailTemplateFilesById(index: Map<string, string[]>, id: string): Promise<void> {
  const paths = index.get(id);
  if (!paths) return;

  for (const filePath of paths) {
    try {
      await fs.unlink(filePath);
    } catch {
      // ignore missing files
    }
  }

  index.delete(id);
}

export async function pullLeadCMSEmailTemplates(remoteCtx?: RemoteContext): Promise<void> {
  const { token: lastSyncToken } = await readSyncToken(remoteCtx);

  const { items, deleted, baseItems, nextSyncToken } = await pullEmailTemplateSync(lastSyncToken);

  // Load per-remote metadata for multi-remote support
  let metadataMap: MetadataMap | undefined;
  const rcModule = remoteCtx ? await import('../lib/remote-context.js') : undefined;
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
      const defaultCtx: import('../lib/remote-context.js').RemoteContext = {
        name: cfg.defaultRemote,
        url: cfg.remotes?.[cfg.defaultRemote]?.url || '',
        isDefault: true,
        stateDir: defaultStateDir,
      };
      defaultMetadataMap = await rcModule.readMetadataMap(defaultCtx);
    }
  }

  // The sync API returns emailGroup: null — resolve from the groups endpoint
  if (items.length > 0) {
    const emailGroups = await leadCMSDataService.getAllEmailGroups();
    const groupById = new Map(emailGroups.map(g => [Number(g.id), g]));

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

  const idIndex = (items.length > 0 || deleted.length > 0)
    ? await buildEmailTemplateIdIndex(EMAIL_TEMPLATES_DIR)
    : new Map<string, string[]>();

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
    const oldEntry = (remoteCtx && !remoteCtx.isDefault && rcModule && metadataMap && idStr)
      ? rcModule.findEmailTemplateByRemoteId(metadataMap, idStr)
      : undefined;

    // Update per-remote metadata with this template's data
    if (remoteCtx && rcModule && metadataMap && template.name && template.language) {
      if (template.id != null) {
        rcModule.setEmailTemplateRemoteId(metadataMap, template.language || defaultLanguage, template.name, template.id);
      }
      rcModule.setMetadataForEmailTemplate(metadataMap, template.language || defaultLanguage, template.name, {
        createdAt: template.createdAt,
        updatedAt: template.updatedAt ?? undefined,
      });
    }

    // For non-default remotes, replace server-generated fields with the
    // defaultRemote's values so frontmatter always reflects prod ids/dates.
    // The current remote's values are already stored in its per-remote maps.
    let templateToSave = template;
    if (remoteCtx && !remoteCtx.isDefault) {
      const { id, createdAt, updatedAt, ...rest } = template;
      const lang = template.language || defaultLanguage;
      const name = template.name || '';
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
      if (oldEntry && (oldEntry.name !== template.name || oldEntry.language !== (template.language || defaultLanguage))) {
        const oldTemplate = { ...template, name: oldEntry.name, language: oldEntry.language } as EmailTemplateRemoteData;
        const oldPath = getEmailTemplateFilePath(oldTemplate);
        console.log(`   🗑️  Removing old email template file: ${path.basename(oldPath)} (name or language changed)`);
        try { await fs.unlink(oldPath); } catch { /* ignore */ }
      }
    } else if (idStr != null) {
      const oldPaths = idIndex.get(idStr);
      if (oldPaths && oldPaths.length > 0 && !oldPaths.some(p => p === filePath)) {
        console.log(`   🗑️  Removing old email template file: ${oldPaths.map(p => path.basename(p)).join(', ')} (name or language changed)`);
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
          console.warn(`⚠️  Conflict in: ${template.name || template.id} (${mergeResult.conflictCount} conflict(s))`);
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

  if (hasBaseItems && items.length > 0) {
    console.log(`\n📊 Email templates sync summary:`);
    if (newCount > 0) console.log(`   ✨ New: ${newCount}`);
    if (overwrittenCount > 0) console.log(`   📝 Updated (no local changes): ${overwrittenCount}`);
    if (mergedCount > 0) console.log(`   🔀 Auto-merged: ${mergedCount}`);
    if (conflictCount > 0) console.log(`   ⚠️  Conflicts (need manual resolution): ${conflictCount}`);
  }

  if (deleted.length > 0) {
    console.log(`🗑️  Removing deleted email templates (${deleted.length})...`);
  }
  for (const id of deleted) {
    if (remoteCtx && !remoteCtx.isDefault && rcModule && metadataMap) {
      // Non-default remote: resolve ID → name via metadata.
      const entry = rcModule.findEmailTemplateByRemoteId(metadataMap, id);
      if (entry) {
        const oldTemplate = { name: entry.name, language: entry.language } as EmailTemplateRemoteData;
        const filePath = getEmailTemplateFilePath(oldTemplate);
        console.log(`   🗑️  ${path.basename(filePath)} (deleted on remote)`);
        try { await fs.unlink(filePath); } catch { /* ignore */ }
        // Clean up metadata entry
        if (metadataMap.emailTemplates?.[entry.language]?.[entry.name]) {
          delete metadataMap.emailTemplates[entry.language][entry.name];
        }
      }
    } else {
      const paths = idIndex.get(String(id));
      if (paths && paths.length > 0) {
        console.log(`   🗑️  ${paths.map(p => path.basename(p)).join(', ')} (deleted on remote)`);
      }
      await deleteEmailTemplateFilesById(idIndex, String(id));
    }
  }

  // Persist per-remote metadata after processing all templates
  if (remoteCtx && rcModule && metadataMap && (items.length > 0 || deleted.length > 0)) {
    await rcModule.writeMetadataMap(remoteCtx, metadataMap);
    logger.verbose(`[PULL] Updated metadata-map for remote "${remoteCtx.name}"`);
  }

  if (nextSyncToken) {
    await writeSyncToken(nextSyncToken, remoteCtx);
  }
}

export { buildEmailTemplateIdIndex, deleteEmailTemplateFilesById, saveEmailTemplateFile, pullEmailTemplateSync };
