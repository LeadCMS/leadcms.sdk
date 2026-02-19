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

async function writeSyncToken(token: string): Promise<void> {
  await fs.mkdir(path.dirname(SYNC_TOKEN_PATH), { recursive: true });
  await fs.writeFile(SYNC_TOKEN_PATH, token, "utf8");
}

async function fetchEmailTemplateSync(syncToken?: string): Promise<EmailTemplateSyncResult> {
  if (!leadCMSUrl) {
    throw new Error("LeadCMS URL is not configured.");
  }

  if (!leadCMSApiKey) {
    throw new Error("LeadCMS API key is required to fetch email templates.");
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

function slugifySegment(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getGroupFolderName(template: EmailTemplateRemoteData): string {
  const groupName = template.emailGroup?.name;
  if (groupName) {
    const slug = slugifySegment(groupName);
    return slug || groupName;
  }

  return "ungrouped";
}

function getTemplateFileName(template: EmailTemplateRemoteData): string {
  const name = template.name || "template";
  const slug = slugifySegment(name);
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

export async function fetchLeadCMSEmailTemplates(): Promise<void> {
  const lastSyncToken = await readFileOrUndefined(SYNC_TOKEN_PATH);

  const { items, deleted, baseItems, nextSyncToken } = await fetchEmailTemplateSync(lastSyncToken);

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

    let localContent: string | null = null;
    try {
      localContent = await fs.readFile(filePath, "utf8");
    } catch {
      // file does not exist
    }

    if (idStr != null) {
      await deleteEmailTemplateFilesById(idIndex, idStr);
    }

    const baseTemplate = idStr ? baseItems[idStr] : undefined;

    if (localContent && baseTemplate && hasBaseItems) {
      const baseTransformed = transformEmailTemplateRemoteToLocalFormat(baseTemplate);
      const remoteTransformed = transformEmailTemplateRemoteToLocalFormat(template);

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
      await saveEmailTemplateFile(template);
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

  for (const id of deleted) {
    await deleteEmailTemplateFilesById(idIndex, String(id));
  }

  if (nextSyncToken) {
    await writeSyncToken(nextSyncToken);
  }
}

export { buildEmailTemplateIdIndex, deleteEmailTemplateFilesById, saveEmailTemplateFile, fetchEmailTemplateSync };
