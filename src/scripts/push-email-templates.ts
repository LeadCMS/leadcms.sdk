import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import * as Diff from "diff";
import {
  EMAIL_TEMPLATES_DIR,
  defaultLanguage,
} from "./leadcms-helpers.js";
import {
  parseEmailTemplateFileContent,
  transformEmailTemplateRemoteToLocalFormat,
  formatEmailTemplateForApi,
  type EmailTemplateRemoteData,
} from "../lib/email-template-transformation.js";
import { hasContentDifferences, normalizeContentForComparison } from "../lib/content-transformation.js";
import { threeWayMerge, isLocallyModified } from "../lib/content-merge.js";
import { leadCMSDataService } from "../lib/data-service.js";
import { fetchEmailTemplateSync } from "./fetch-leadcms-email-templates.js";
import { colorConsole, statusColors, diffColors } from "../lib/console-colors.js";
import { logger } from "../lib/logger.js";

interface LocalEmailTemplateItem {
  filePath: string;
  locale: string;
  groupFolder: string;
  metadata: Record<string, any>;
  body: string;
}

interface RemoteEmailTemplateItem {
  id?: number;
  name?: string;
  subject?: string;
  bodyTemplate?: string;
  fromEmail?: string;
  fromName?: string;
  language?: string;
  translationKey?: string | null;
  emailGroupId?: number | null;
  createdAt?: string;
  updatedAt?: string | null;
  emailGroup?: Record<string, any> | null;
}

interface EmailGroupItem {
  id?: number;
  name?: string;
  language?: string;
}

interface PushOptions {
  force?: boolean;
  dryRun?: boolean;
  allowDelete?: boolean;
}

interface StatusOptions {
  showDelete?: boolean;
  targetId?: string;
  showDetailedPreview?: boolean;
}

interface EmailTemplateOperation {
  type: 'create' | 'update' | 'delete' | 'conflict';
  local?: LocalEmailTemplateItem;
  remote?: RemoteEmailTemplateItem;
  reason?: string;
}

function slugifySegment(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function isLocaleDirectory(dirPath: string, parentDir: string): Promise<boolean> {
  if (parentDir !== EMAIL_TEMPLATES_DIR) {
    return false;
  }

  const dirName = path.basename(dirPath);
  return /^[a-z]{2}(-[A-Z]{2})?$/.test(dirName);
}

async function readLocalEmailTemplates(): Promise<LocalEmailTemplateItem[]> {
  const localTemplates: LocalEmailTemplateItem[] = [];

  async function walkDirectory(dir: string, locale: string = defaultLanguage, baseDir: string = EMAIL_TEMPLATES_DIR): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name !== defaultLanguage && await isLocaleDirectory(fullPath, dir)) {
          await walkDirectory(fullPath, entry.name, fullPath);
        } else {
          await walkDirectory(fullPath, locale, baseDir);
        }
      } else if (entry.isFile() && entry.name.endsWith('.html')) {
        const content = await fs.readFile(fullPath, 'utf8');
        const parsed = parseEmailTemplateFileContent(content);

        const relativePath = path.relative(baseDir, fullPath);
        const relativeDir = path.dirname(relativePath);
        const groupFolder = relativeDir === '.' ? 'ungrouped' : relativeDir.split(path.sep)[0];

        const baseName = path.basename(fullPath, '.html');
        const metadata = { ...parsed.metadata };

        if (!metadata.name) {
          metadata.name = baseName;
        }

        if (!metadata.language) {
          metadata.language = locale;
        }

        localTemplates.push({
          filePath: fullPath,
          locale,
          groupFolder,
          metadata,
          body: parsed.body,
        });
      }
    }
  }

  try {
    await walkDirectory(EMAIL_TEMPLATES_DIR);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  return localTemplates;
}

function normalizeGroupKey(name: string): string {
  return slugifySegment(name);
}

function resolveEmailGroupId(
  template: LocalEmailTemplateItem,
  groupIndex: Map<string, EmailGroupItem[]>
): number | null {
  // 1. If metadata already has a numeric emailGroupId, use it directly
  const existing = template.metadata.emailGroupId;
  if (existing != null) {
    return Number(existing);
  }

  // 2. If metadata has a groupName, look it up in the index
  const groupName = template.metadata.groupName;
  if (groupName) {
    const groupKey = normalizeGroupKey(groupName);
    if (groupKey) {
      const candidates = groupIndex.get(groupKey) || [];
      const localeMatch = candidates.find(group => group.language === template.locale);
      const match = localeMatch || candidates[0];
      if (match?.id != null) {
        return Number(match.id);
      }
    }
    return null;
  }

  // 3. Fall back to folder name
  const groupKey = normalizeGroupKey(template.groupFolder);
  if (!groupKey) {
    return null;
  }

  const candidates = groupIndex.get(groupKey) || [];
  const localeMatch = candidates.find(group => group.language === template.locale);
  const match = localeMatch || candidates[0];

  return match?.id != null ? Number(match.id) : null;
}

function buildGroupIndex(groups: EmailGroupItem[]): Map<string, EmailGroupItem[]> {
  const index = new Map<string, EmailGroupItem[]>();

  for (const group of groups) {
    const name = group.name || '';
    const key = normalizeGroupKey(name);
    if (!key) {
      continue;
    }
    const existing = index.get(key) || [];
    existing.push(group);
    index.set(key, existing);
  }

  return index;
}

/**
 * Resolve the effective group name for a template:
 * 1. metadata.groupName (from frontmatter)
 * 2. groupFolder (from directory structure)
 * 3. null if ungrouped
 */
function getEffectiveGroupName(template: LocalEmailTemplateItem): string | null {
  if (template.metadata.groupName) {
    return template.metadata.groupName;
  }
  if (template.groupFolder && template.groupFolder !== 'ungrouped') {
    return template.groupFolder;
  }
  return null;
}

/**
 * Find email groups that are referenced by local templates but don't exist remotely.
 * Creates them automatically (like content type auto-creation).
 */
async function createMissingEmailGroups(
  localTemplates: LocalEmailTemplateItem[],
  groupIndex: Map<string, EmailGroupItem[]>,
  dryRun: boolean = false
): Promise<EmailGroupItem[]> {
  // Collect unique missing group names from local templates
  const missingGroups = new Map<string, { name: string; language: string }>();

  for (const template of localTemplates) {
    const groupName = getEffectiveGroupName(template);
    if (!groupName) continue;

    const groupKey = normalizeGroupKey(groupName);
    if (!groupKey) continue;

    if (groupIndex.has(groupKey)) continue;
    if (missingGroups.has(groupKey)) continue;

    missingGroups.set(groupKey, {
      name: groupName,
      language: template.locale || defaultLanguage,
    });
  }

  if (missingGroups.size === 0) return [];

  const created: EmailGroupItem[] = [];

  colorConsole.warn(`\n⚠️  Missing email groups in remote LeadCMS: ${[...missingGroups.values()].map(g => colorConsole.highlight(g.name)).join(', ')}`);

  for (const [key, { name, language }] of missingGroups) {
    if (dryRun) {
      colorConsole.progress(`🟡 [DRY RUN] Would create email group: ${colorConsole.highlight(name)} (${language})`);
      continue;
    }

    try {
      const newGroup = await leadCMSDataService.createEmailGroup({ name, language });
      colorConsole.success(`✅ Created email group: ${colorConsole.highlight(name)} (ID: ${newGroup.id})`);
      created.push(newGroup);

      // Add to the index so subsequent templates can resolve
      const existing = groupIndex.get(key) || [];
      existing.push(newGroup);
      groupIndex.set(key, existing);
    } catch (error: any) {
      colorConsole.error(`❌ Failed to create email group '${name}': ${error.message}`);
    }
  }

  return created;
}

function getRemoteMatch(
  local: LocalEmailTemplateItem,
  remoteTemplates: RemoteEmailTemplateItem[]
): RemoteEmailTemplateItem | undefined {
  const localId = local.metadata.id != null ? Number(local.metadata.id) : undefined;
  if (localId != null) {
    return remoteTemplates.find(template => template.id === localId);
  }

  const name = local.metadata.name;
  const emailGroupId = local.metadata.emailGroupId;
  const language = local.metadata.language || local.locale;

  return remoteTemplates.find(template =>
    template.name === name &&
    (template.language || defaultLanguage) === language &&
    template.emailGroupId === emailGroupId
  );
}

function filterUndefinedValues(obj: Record<string, any>): Record<string, any> {
  const output: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      output[key] = value;
    }
  }
  return output;
}

async function hasTemplateChanges(local: LocalEmailTemplateItem, remote: RemoteEmailTemplateItem): Promise<boolean> {
  const localContent = await fs.readFile(local.filePath, 'utf8');
  const remoteTransformed = transformEmailTemplateRemoteToLocalFormat(remote);
  return hasContentDifferences(localContent, remoteTransformed);
}

/**
 * Update a local email template file with data from the API response.
 * Ensures updatedAt, id, and other metadata stay in sync after push.
 */
async function updateLocalFileFromResponse(
  local: LocalEmailTemplateItem,
  response: RemoteEmailTemplateItem,
  emailGroups: EmailGroupItem[]
): Promise<void> {
  try {
    // Enrich the response with group name if missing
    if (response.emailGroupId != null && !response.emailGroup?.name) {
      const group = emailGroups.find(g => Number(g.id) === Number(response.emailGroupId));
      if (group) {
        response.emailGroup = { id: group.id, name: group.name, language: group.language };
      }
    }

    const transformed = transformEmailTemplateRemoteToLocalFormat(response);
    await fs.writeFile(local.filePath, transformed, 'utf8');
    logger.verbose(`[PUSH] Updated local file: ${local.filePath}`);
  } catch (error: any) {
    logger.verbose(`[PUSH] Failed to update local file ${local.filePath}: ${error.message}`);
  }
}

/**
 * Enrich remote templates with email group data.
 * The list/sync APIs often return emailGroup: null even when emailGroupId is set.
 */
function enrichRemoteTemplatesWithGroups(
  remoteTemplates: RemoteEmailTemplateItem[],
  emailGroups: EmailGroupItem[]
): void {
  const groupById = new Map(emailGroups.map(g => [Number(g.id), g]));
  for (const template of remoteTemplates) {
    if (template.emailGroupId != null && !template.emailGroup?.name) {
      const group = groupById.get(Number(template.emailGroupId));
      if (group) {
        template.emailGroup = { id: group.id, name: group.name, language: group.language };
      }
    }
  }
}

interface AutoMergeResult {
  canMerge: boolean;
  merged?: string;
  hasConflicts?: boolean;
  conflictCount?: number;
  localUnmodified?: boolean;
}

/**
 * Fetch base items from the sync endpoint for three-way merge.
 * Base items represent the server's state at the time of the last pull sync token.
 * Returns an empty record if no sync token exists or the fetch fails.
 */
async function fetchBaseItemsForMerge(
  emailGroups: EmailGroupItem[]
): Promise<Record<string, EmailTemplateRemoteData>> {
  try {
    const syncTokenPath = path.join(EMAIL_TEMPLATES_DIR, '.sync-token');
    let syncToken: string | undefined;
    try {
      syncToken = (await fs.readFile(syncTokenPath, 'utf8')).trim() || undefined;
    } catch {
      return {};
    }

    if (!syncToken) return {};

    const { baseItems } = await fetchEmailTemplateSync(syncToken);

    // Enrich base items with email group data
    const groupById = new Map(emailGroups.map(g => [Number(g.id), g]));
    for (const base of Object.values(baseItems)) {
      if (base.emailGroupId != null && !base.emailGroup) {
        const group = groupById.get(Number(base.emailGroupId));
        if (group) {
          base.emailGroup = { id: group.id, name: group.name, language: group.language };
        }
      }
    }

    return baseItems;
  } catch (error: any) {
    logger.verbose(`[PUSH] Could not fetch base items for merge: ${error.message}`);
    return {};
  }
}

/**
 * Attempt a three-way merge between base (from last pull), local (current file),
 * and remote (current server state).
 *
 * Returns { canMerge: false } if no base version is available.
 * Returns { canMerge: true, localUnmodified: true } if local hasn't changed since last pull.
 * Returns { canMerge: true, merged, hasConflicts, conflictCount } with merge result.
 */
async function attemptAutoMerge(
  local: LocalEmailTemplateItem,
  remote: RemoteEmailTemplateItem,
  baseItems: Record<string, EmailTemplateRemoteData>
): Promise<AutoMergeResult> {
  const remoteId = remote.id != null ? String(remote.id) : undefined;
  if (!remoteId) return { canMerge: false };

  const baseItem = baseItems[remoteId];
  if (!baseItem) return { canMerge: false };

  const baseTransformed = transformEmailTemplateRemoteToLocalFormat(baseItem);

  let localContent: string;
  try {
    localContent = await fs.readFile(local.filePath, 'utf8');
  } catch {
    return { canMerge: false };
  }

  const remoteTransformed = transformEmailTemplateRemoteToLocalFormat(remote as unknown as EmailTemplateRemoteData);

  if (!isLocallyModified(baseTransformed, localContent)) {
    // Local file is identical to what was pulled — no local edits to merge
    return { canMerge: true, localUnmodified: true, merged: remoteTransformed };
  }

  const mergeResult = threeWayMerge(baseTransformed, localContent, remoteTransformed);
  return {
    canMerge: true,
    merged: mergeResult.merged,
    hasConflicts: mergeResult.hasConflicts,
    conflictCount: mergeResult.conflictCount,
  };
}

export interface EmailTemplateStatusResult {
  operations: EmailTemplateOperation[];
  totalLocal: number;
  totalRemote: number;
}

async function buildEmailTemplateStatus(options: StatusOptions = {}): Promise<EmailTemplateStatusResult> {
  const { showDelete } = options;
  const operations: EmailTemplateOperation[] = [];

  const localTemplates = await readLocalEmailTemplates();
  const remoteTemplates = await leadCMSDataService.getAllEmailTemplates();
  const emailGroups = await leadCMSDataService.getAllEmailGroups();
  const groupIndex = buildGroupIndex(emailGroups);

  // Enrich remote templates with group names for accurate comparison
  enrichRemoteTemplatesWithGroups(remoteTemplates, emailGroups);

  // Fetch base items for three-way auto-merge detection
  const baseItems = await fetchBaseItemsForMerge(emailGroups);

  for (const local of localTemplates) {
    const resolvedGroupId = resolveEmailGroupId(local, groupIndex);
    if (resolvedGroupId != null) {
      local.metadata.emailGroupId = resolvedGroupId;
    } else {
      const groupName = getEffectiveGroupName(local);
      if (groupName) {
        operations.push({
          type: 'conflict',
          local,
          reason: `Email group '${groupName}' not found remotely (will be created on push)`,
        });
        continue;
      }
    }

    const match = getRemoteMatch(local, remoteTemplates);

    const payload = filterUndefinedValues(formatEmailTemplateForApi({
      metadata: local.metadata,
      body: local.body,
    }));

    const requiredFields = ['name', 'subject', 'fromEmail', 'fromName', 'language', 'emailGroupId'];
    const missingFields = requiredFields.filter(field => payload[field] === undefined || payload[field] === null || payload[field] === '');
    if (missingFields.length > 0) {
      operations.push({
        type: 'conflict',
        local,
        reason: `Missing required fields: ${missingFields.join(', ')}`,
      });
      continue;
    }

    if (!match) {
      operations.push({ type: 'create', local });
      continue;
    }

    const localUpdated = local.metadata.updatedAt ? new Date(local.metadata.updatedAt) : new Date(0);
    const remoteUpdated = match?.updatedAt ? new Date(match.updatedAt) : new Date(0);

    if (remoteUpdated > localUpdated) {
      // Attempt three-way auto-merge instead of immediately flagging as conflict
      const mergeAttempt = await attemptAutoMerge(local, match, baseItems);

      if (mergeAttempt.canMerge && mergeAttempt.localUnmodified) {
        // Local hasn't changed since last pull — nothing to push
        continue;
      } else if (mergeAttempt.canMerge && !mergeAttempt.hasConflicts) {
        // Auto-merge would succeed — show as update
        operations.push({ type: 'update', local, remote: match, reason: 'auto-merged' });
      } else if (mergeAttempt.canMerge && mergeAttempt.hasConflicts) {
        operations.push({
          type: 'conflict',
          local,
          remote: match,
          reason: `Auto-merge has ${mergeAttempt.conflictCount} conflict(s) — resolve manually`,
        });
      } else {
        operations.push({
          type: 'conflict',
          local,
          remote: match,
          reason: 'Remote email template updated after local changes',
        });
      }
      continue;
    }

    const hasChanges = await hasTemplateChanges(local, match);
    if (hasChanges) {
      operations.push({ type: 'update', local, remote: match });
    }
  }

  if (showDelete) {
    const localIds = new Set(
      localTemplates
        .map(template => template.metadata.id)
        .filter(id => id != null)
        .map(id => Number(id))
    );

    for (const remote of remoteTemplates) {
      if (remote.id == null) {
        continue;
      }

      if (!localIds.has(Number(remote.id))) {
        operations.push({ type: 'delete', remote });
      }
    }
  }

  return {
    operations,
    totalLocal: localTemplates.length,
    totalRemote: remoteTemplates.length,
  };
}

function getRemoteGroupLabel(remote: RemoteEmailTemplateItem): string {
  if (remote.emailGroup?.name) {
    return slugifySegment(remote.emailGroup.name) || remote.emailGroup.name;
  }
  return 'ungrouped';
}

export async function statusEmailTemplates(options: StatusOptions = {}): Promise<void> {
  if (!leadCMSDataService.isApiKeyConfigured()) {
    console.log('\n📊 LeadCMS Email Template Status');
    console.log('');
    console.log('⏭️  Email templates require authentication — no API key configured, skipping');
    return;
  }

  const { targetId, showDetailedPreview } = options;
  const result = await buildEmailTemplateStatus(options);
  let { operations } = result;

  // Filter by target ID if specified
  if (targetId) {
    operations = operations.filter(op => {
      const localId = op.local?.metadata?.id?.toString();
      const remoteId = op.remote?.id?.toString();
      return localId === targetId || remoteId === targetId;
    });

    if (operations.length === 0) {
      colorConsole.important('\n📊 LeadCMS Email Template Status');
      colorConsole.log('');
      colorConsole.log(`❌ No email template found with ID ${targetId}`);
      return;
    }
  }

  colorConsole.important('\n📊 LeadCMS Email Template Status');
  colorConsole.log('');

  const syncableChanges = operations.length;
  if (syncableChanges === 0) {
    colorConsole.success('✅ No changes detected. Email templates are in sync!');
    return;
  }

  const label = targetId ? `Status for template ID ${targetId}:` : `Changes to be synced (${syncableChanges} files):`;
  console.log(label);
  console.log('');

  const sortOps = (ops: EmailTemplateOperation[]) => {
    return ops.sort((a, b) => {
      const aLocale = a.local?.locale || a.remote?.language || defaultLanguage;
      const bLocale = b.local?.locale || b.remote?.language || defaultLanguage;
      if (aLocale !== bLocale) {
        return aLocale.localeCompare(bLocale);
      }
      const aName = a.local?.metadata?.name || a.remote?.name || '';
      const bName = b.local?.metadata?.name || b.remote?.name || '';
      return aName.localeCompare(bName);
    });
  };

  const createOps = sortOps(operations.filter(op => op.type === 'create'));
  const updateOps = sortOps(operations.filter(op => op.type === 'update'));
  const conflictOps = sortOps(operations.filter(op => op.type === 'conflict'));
  const deleteOps = sortOps(operations.filter(op => op.type === 'delete'));

  async function printDiffPreview(op: EmailTemplateOperation): Promise<void> {
    if (!showDetailedPreview && !targetId) return;
    if (!op.local?.filePath) return;

    try {
      const localContent = await fs.readFile(op.local.filePath, 'utf8');
      const remoteTransformed = op.remote
        ? transformEmailTemplateRemoteToLocalFormat(op.remote)
        : '';

      if (!hasContentDifferences(localContent, remoteTransformed)) {
        colorConsole.log('          No content changes detected');
        colorConsole.log('');
        return;
      }

      // Normalize both sides so timestamp precision differences don't appear in the diff
      const normalizedLocal = normalizeContentForComparison(localContent);
      const normalizedRemote = normalizeContentForComparison(remoteTransformed);
      const diff = Diff.diffLines(normalizedRemote, normalizedLocal);
      let addedLines = 0;
      let removedLines = 0;

      colorConsole.info('          Content diff preview:');
      let previewLines = 0;
      const maxPreviewLines = 10;

      for (const part of diff) {
        const lines = part.value.split('\n').filter((line: string) => line.trim() !== '');

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
      colorConsole.log('');
    } catch (error: any) {
      logger.verbose(`[DIFF] Failed to generate diff for ${op.local?.metadata?.name}: ${error.message}`);
    }
  }

  for (const op of createOps) {
    const groupLabel = (op.local?.groupFolder || 'ungrouped').padEnd(12);
    const localeLabel = `[${op.local?.locale || defaultLanguage}]`.padEnd(6);
    const nameLabel = op.local?.metadata?.name || 'unknown';
    colorConsole.log(`        ${statusColors.created('new file:')}   ${groupLabel} ${localeLabel} ${colorConsole.highlight(nameLabel)}`);
    await printDiffPreview(op);
  }

  for (const op of updateOps) {
    const groupLabel = (op.local?.groupFolder || 'ungrouped').padEnd(12);
    const localeLabel = `[${op.local?.locale || defaultLanguage}]`.padEnd(6);
    const nameLabel = op.local?.metadata?.name || op.remote?.name || 'unknown';
    const idLabel = op.remote?.id ? `(ID: ${op.remote.id})` : '';
    const mergeHint = op.reason === 'auto-merged' ? colorConsole.gray('(auto-merged) ') : '';
    colorConsole.log(`        ${statusColors.modified('modified:')}   ${groupLabel} ${localeLabel} ${colorConsole.highlight(nameLabel)} ${mergeHint}${colorConsole.gray(idLabel)}`);
    await printDiffPreview(op);
  }

  for (const op of conflictOps) {
    const groupLabel = (op.local?.groupFolder || getRemoteGroupLabel(op.remote || {})).padEnd(12);
    const localeLabel = `[${op.local?.locale || op.remote?.language || defaultLanguage}]`.padEnd(6);
    const nameLabel = op.local?.metadata?.name || op.remote?.name || 'unknown';
    const reason = op.reason ? `(${op.reason})` : '';
    colorConsole.log(`        ${statusColors.conflict('conflict:')}   ${groupLabel} ${localeLabel} ${colorConsole.highlight(nameLabel)} ${colorConsole.gray(reason)}`);
    await printDiffPreview(op);
  }

  for (const op of deleteOps) {
    const groupLabel = getRemoteGroupLabel(op.remote || {}).padEnd(12);
    const localeLabel = `[${op.remote?.language || defaultLanguage}]`.padEnd(6);
    const nameLabel = op.remote?.name || 'unknown';
    const idLabel = op.remote?.id ? `(ID: ${op.remote.id})` : '';
    colorConsole.log(`        ${statusColors.conflict('deleted:')}    ${groupLabel} ${localeLabel} ${colorConsole.highlight(nameLabel)} ${colorConsole.gray(idLabel)}`);
    await printDiffPreview(op);
  }

  const summary = operations.reduce(
    (acc, op) => {
      acc[op.type] += 1;
      return acc;
    },
    { create: 0, update: 0, delete: 0, conflict: 0, skip: 0 }
  );

  console.log(`\n📊 Email Templates Summary:`);
  if (summary.create === 0 && summary.update === 0 && summary.conflict === 0 && summary.delete === 0) {
    console.log(`\n✅ No changes detected. Email templates are in sync!`);
    return;
  }

  if (summary.create > 0) console.log(`   ✨ New: ${summary.create}`);
  if (summary.update > 0) console.log(`   📝 Updated: ${summary.update}`);
  if (summary.conflict > 0) console.log(`   ⚠️  Conflicts: ${summary.conflict}`);
  if (summary.delete > 0) console.log(`   🗑️  Deletes: ${summary.delete}`);
  if (summary.skip > 0) console.log(`   ✓ Unchanged: ${summary.skip}`);

  if (summary.conflict > 0) {
    const conflicts = operations.filter(op => op.type === 'conflict');
    for (const conflict of conflicts) {
      console.warn(`   - ${conflict.local?.metadata?.name || conflict.remote?.id}: ${conflict.reason || 'Conflict'}`);
    }
  }
}

// Export for unified status renderer
export { buildEmailTemplateStatus, getRemoteGroupLabel };
export type { EmailTemplateOperation, LocalEmailTemplateItem, RemoteEmailTemplateItem };

export async function pushEmailTemplates(options: PushOptions = {}): Promise<void> {
  if (!leadCMSDataService.isApiKeyConfigured()) {
    console.log('⏭️  Email templates require authentication — no API key configured, skipping');
    return;
  }

  const { force, dryRun, allowDelete } = options;

  const localTemplates = await readLocalEmailTemplates();
  const remoteTemplates = await leadCMSDataService.getAllEmailTemplates();
  const emailGroups = await leadCMSDataService.getAllEmailGroups();

  const groupIndex = buildGroupIndex(emailGroups);

  // Enrich remote templates with group names for accurate comparison
  enrichRemoteTemplatesWithGroups(remoteTemplates, emailGroups);

  // Auto-create missing email groups (like content type auto-creation)
  await createMissingEmailGroups(localTemplates, groupIndex, dryRun);

  // Fetch base items for three-way auto-merge
  const baseItems = await fetchBaseItemsForMerge(emailGroups);

  for (const local of localTemplates) {
    const resolvedGroupId = resolveEmailGroupId(local, groupIndex);
    if (resolvedGroupId != null) {
      local.metadata.emailGroupId = resolvedGroupId;
    }

    const match = getRemoteMatch(local, remoteTemplates);

    const localUpdated = local.metadata.updatedAt ? new Date(local.metadata.updatedAt) : new Date(0);
    const remoteUpdated = match?.updatedAt ? new Date(match.updatedAt) : new Date(0);

    let autoMerged = false;

    if (match && !force && remoteUpdated > localUpdated) {
      // Attempt three-way auto-merge instead of immediately skipping as conflict
      const mergeAttempt = await attemptAutoMerge(local, match, baseItems);

      if (mergeAttempt.canMerge && mergeAttempt.localUnmodified) {
        // Local hasn't changed since last pull — nothing to push
        logger.verbose(`[PUSH] Skipping ${local.metadata.name} — no local changes to push`);
        continue;
      } else if (mergeAttempt.canMerge && !mergeAttempt.hasConflicts) {
        // Auto-merge succeeded — update local data from merged content
        const parsed = parseEmailTemplateFileContent(mergeAttempt.merged!);
        local.metadata = { ...parsed.metadata, emailGroupId: local.metadata.emailGroupId };
        local.body = parsed.body;
        autoMerged = true;
      } else if (mergeAttempt.canMerge && mergeAttempt.hasConflicts) {
        console.warn(`⚠️  Auto-merge has ${mergeAttempt.conflictCount} conflict(s): ${local.metadata.name || match.id} — skipping (use --force to override)`);
        continue;
      } else {
        console.warn(`⚠️  Remote email template updated after local changes: ${local.metadata.name || match.id}`);
        continue;
      }
    }

    const payload = filterUndefinedValues(formatEmailTemplateForApi({
      metadata: local.metadata,
      body: local.body,
    }));

    const requiredFields = ['name', 'subject', 'fromEmail', 'fromName', 'language', 'emailGroupId'];
    const missingFields = requiredFields.filter(field => payload[field] === undefined || payload[field] === null || payload[field] === '');
    if (missingFields.length > 0) {
      console.warn(`⚠️  Skipping ${local.filePath} - missing required fields: ${missingFields.join(', ')}`);
      continue;
    }

    if (!match) {
      if (dryRun) {
        console.log(`🟡 [DRY RUN] Create email template: ${payload.name}`);
        continue;
      }

      const created = await leadCMSDataService.createEmailTemplate(payload);
      console.log(`✅ Created email template: ${payload.name}`);
      await updateLocalFileFromResponse(local, created, emailGroups);
      continue;
    }

    // Only check hasChanges for non-merged items (merged content is known to differ)
    if (!autoMerged) {
      const hasChanges = await hasTemplateChanges(local, match);
      if (!hasChanges) {
        continue;
      }
    }

    if (dryRun) {
      const label = autoMerged ? '[DRY RUN] Auto-merge + update' : '[DRY RUN] Update';
      console.log(`🟡 ${label} email template: ${payload.name} (ID ${match.id})`);
      continue;
    }

    const updated = await leadCMSDataService.updateEmailTemplate(Number(match.id), payload);
    const label = autoMerged ? '🔀 Auto-merged and updated' : '✅ Updated';
    console.log(`${label} email template: ${payload.name}`);
    await updateLocalFileFromResponse(local, updated, emailGroups);
  }

  if (!allowDelete) {
    return;
  }

  const localIds = new Set(localTemplates.map(template => template.metadata.id).filter(id => id != null).map(id => Number(id)));
  for (const remote of remoteTemplates) {
    if (remote.id == null) {
      continue;
    }

    if (!localIds.has(Number(remote.id))) {
      if (dryRun) {
        console.log(`🟡 [DRY RUN] Delete email template: ${remote.name || remote.id}`);
        continue;
      }

      await leadCMSDataService.deleteEmailTemplate(Number(remote.id));
      console.log(`🗑️  Deleted email template: ${remote.name || remote.id}`);
    }
  }
}
