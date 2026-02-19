import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import {
  EMAIL_TEMPLATES_DIR,
  defaultLanguage,
} from "./leadcms-helpers.js";
import {
  parseEmailTemplateFileContent,
  transformEmailTemplateRemoteToLocalFormat,
  formatEmailTemplateForApi,
} from "../lib/email-template-transformation.js";
import { hasContentDifferences } from "../lib/content-transformation.js";
import { leadCMSDataService } from "../lib/data-service.js";
import { colorConsole, statusColors } from "../lib/console-colors.js";
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
      operations.push({
        type: 'conflict',
        local,
        remote: match,
        reason: 'Remote email template updated after local changes',
      });
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
  const { operations } = await buildEmailTemplateStatus(options);

  colorConsole.important('\n📊 LeadCMS Status');
  colorConsole.log('');

  const syncableChanges = operations.length;
  if (syncableChanges === 0) {
    colorConsole.success('✅ No changes detected. Everything is in sync!');
    return;
  }

  console.log(`Changes to be synced (${syncableChanges} files):`);
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

  for (const op of createOps) {
    const groupLabel = (op.local?.groupFolder || 'ungrouped').padEnd(12);
    const localeLabel = `[${op.local?.locale || defaultLanguage}]`.padEnd(6);
    const nameLabel = op.local?.metadata?.name || 'unknown';
    colorConsole.log(`        ${statusColors.created('new file:')}   ${groupLabel} ${localeLabel} ${colorConsole.highlight(nameLabel)}`);
  }

  for (const op of updateOps) {
    const groupLabel = (op.local?.groupFolder || 'ungrouped').padEnd(12);
    const localeLabel = `[${op.local?.locale || defaultLanguage}]`.padEnd(6);
    const nameLabel = op.local?.metadata?.name || op.remote?.name || 'unknown';
    const idLabel = op.remote?.id ? `(ID: ${op.remote.id})` : '';
    colorConsole.log(`        ${statusColors.modified('modified:')}   ${groupLabel} ${localeLabel} ${colorConsole.highlight(nameLabel)} ${colorConsole.gray(idLabel)}`);
  }

  for (const op of conflictOps) {
    const groupLabel = (op.local?.groupFolder || getRemoteGroupLabel(op.remote || {})).padEnd(12);
    const localeLabel = `[${op.local?.locale || op.remote?.language || defaultLanguage}]`.padEnd(6);
    const nameLabel = op.local?.metadata?.name || op.remote?.name || 'unknown';
    const reason = op.reason ? `(${op.reason})` : '';
    colorConsole.log(`        ${statusColors.conflict('conflict:')}   ${groupLabel} ${localeLabel} ${colorConsole.highlight(nameLabel)} ${colorConsole.gray(reason)}`);
  }

  for (const op of deleteOps) {
    const groupLabel = getRemoteGroupLabel(op.remote || {}).padEnd(12);
    const localeLabel = `[${op.remote?.language || defaultLanguage}]`.padEnd(6);
    const nameLabel = op.remote?.name || 'unknown';
    const idLabel = op.remote?.id ? `(ID: ${op.remote.id})` : '';
    colorConsole.log(`        ${statusColors.conflict('deleted:')}    ${groupLabel} ${localeLabel} ${colorConsole.highlight(nameLabel)} ${colorConsole.gray(idLabel)}`);
  }

  const summary = operations.reduce(
    (acc, op) => {
      acc[op.type] += 1;
      return acc;
    },
    { create: 0, update: 0, delete: 0, conflict: 0, skip: 0 }
  );

  console.log(`\n📊 Email Templates Status:`);
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
  const { force, dryRun, allowDelete } = options;

  const localTemplates = await readLocalEmailTemplates();
  const remoteTemplates = await leadCMSDataService.getAllEmailTemplates();
  const emailGroups = await leadCMSDataService.getAllEmailGroups();

  const groupIndex = buildGroupIndex(emailGroups);

  // Auto-create missing email groups (like content type auto-creation)
  await createMissingEmailGroups(localTemplates, groupIndex, dryRun);

  for (const local of localTemplates) {
    const resolvedGroupId = resolveEmailGroupId(local, groupIndex);
    if (resolvedGroupId != null) {
      local.metadata.emailGroupId = resolvedGroupId;
    }

    const match = getRemoteMatch(local, remoteTemplates);

    const localUpdated = local.metadata.updatedAt ? new Date(local.metadata.updatedAt) : new Date(0);
    const remoteUpdated = match?.updatedAt ? new Date(match.updatedAt) : new Date(0);

    if (match && !force && remoteUpdated > localUpdated) {
      console.warn(`⚠️  Remote email template updated after local changes: ${local.metadata.name || match.id}`);
      continue;
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

      await leadCMSDataService.createEmailTemplate(payload);
      console.log(`✅ Created email template: ${payload.name}`);
      continue;
    }

    const hasChanges = await hasTemplateChanges(local, match);
    if (!hasChanges) {
      continue;
    }

    if (dryRun) {
      console.log(`🟡 [DRY RUN] Update email template: ${payload.name} (ID ${match.id})`);
      continue;
    }

    await leadCMSDataService.updateEmailTemplate(Number(match.id), payload);
    console.log(`✅ Updated email template: ${payload.name}`);
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
