import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';
import type { Dirent } from 'fs';
import * as Diff from 'diff';

import { getConfig } from '../lib/config.js';
import { leadCMSDataService } from '../lib/data-service.js';
import { isValidLocaleCode } from '../lib/locale-utils.js';
import { colorConsole, diffColors, statusColors } from '../lib/console-colors.js';
import { logger } from '../lib/logger.js';
import { pullCommentSync, pullLeadCMSComments, saveCommentsForEntity } from './pull-leadcms-comments.js';

import type { Comment, StoredComment } from '../lib/comment-types.js';
import type { CommentCreateItem, CommentUpdateItem } from '../lib/data-service.js';
import type { RemoteContext, MetadataMap } from '../lib/remote-context.js';

const config = getConfig();
const COMMENTS_DIR = path.resolve(config.commentsDir);
const DEFAULT_LANGUAGE = config.defaultLanguage;

type EditableComment = Omit<StoredComment, 'id'> & { id?: number };

type CommentOperationType = 'create' | 'update' | 'delete' | 'conflict';

interface LocalCommentFile {
  filePath: string;
  commentableType: string;
  commentableId: number;
  language: string;
  comments: EditableComment[];
}

interface LocalCommentItem {
  file: LocalCommentFile;
  filePath: string;
  locale: string;
  comment: EditableComment;
}

interface RemoteCommentItem extends Comment { }

interface CommentOperation {
  type: CommentOperationType;
  local?: LocalCommentItem;
  remote?: RemoteCommentItem;
  reason?: string;
}

interface CommentStatusOptions {
  showDelete?: boolean;
  targetId?: string;
  showDetailedPreview?: boolean;
  remoteContext?: RemoteContext;
}

interface PushCommentsOptions {
  force?: boolean;
  dryRun?: boolean;
  allowDelete?: boolean;
  targetId?: string;
  remoteContext?: RemoteContext;
}

export interface CommentStatusResult {
  operations: CommentOperation[];
  totalLocal: number;
  totalRemote: number;
}

function normalizeCommentableType(segment: string, fallback?: string): string {
  if (fallback) return fallback;
  if (!segment) return 'Content';
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

function normalizeTags(tags?: string[] | null): string[] {
  return [...(tags || [])].sort((a, b) => a.localeCompare(b));
}

function normalizeEditableFields(comment: Partial<EditableComment | RemoteCommentItem>, remote?: RemoteCommentItem) {
  return {
    body: comment.body ?? remote?.body ?? '',
    authorName: comment.authorName ?? remote?.authorName ?? '',
    language: comment.language ?? remote?.language ?? DEFAULT_LANGUAGE,
    status: comment.status ?? remote?.status ?? undefined,
    answerStatus: comment.answerStatus ?? remote?.answerStatus ?? undefined,
    translationKey: comment.translationKey ?? remote?.translationKey ?? undefined,
    tags: normalizeTags(comment.tags ?? remote?.tags),
    publishedAt: comment.publishedAt ?? remote?.publishedAt ?? undefined,
  };
}

function hasEditableDifferences(local: EditableComment, remote: RemoteCommentItem): boolean {
  const normalizedLocal = normalizeEditableFields(local, remote);
  const normalizedRemote = normalizeEditableFields(remote);
  return JSON.stringify(normalizedLocal) !== JSON.stringify(normalizedRemote);
}

function hasImmutableDifferences(local: EditableComment, remote: RemoteCommentItem): boolean {
  return (
    (local.parentId ?? null) !== (remote.parentId ?? null)
    || (local.commentableId ?? remote.commentableId) !== remote.commentableId
    || (local.commentableType ?? remote.commentableType) !== remote.commentableType
  );
}

function isRemoteNewer(local: EditableComment, remote: RemoteCommentItem, metadataMap?: MetadataMap): boolean {
  // When a metadata map is available, use the remote-specific updatedAt
  // for conflict detection instead of whatever is stored in the local file
  // (local file may carry the default remote's timestamp).
  let localUpdated = local.updatedAt;
  if (metadataMap && local.translationKey && local.language) {
    const entry = metadataMap.comments?.[local.language]?.[local.translationKey];
    if (entry?.updatedAt) {
      localUpdated = entry.updatedAt;
    }
  }
  if (!localUpdated || !remote.updatedAt) return false;
  const localTime = Date.parse(localUpdated);
  const remoteTime = Date.parse(remote.updatedAt);
  return Number.isFinite(localTime) && Number.isFinite(remoteTime) && remoteTime > localTime;
}

async function readLocalCommentFiles(): Promise<LocalCommentFile[]> {
  const files: LocalCommentFile[] = [];

  async function walk(dirPath: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }

      if (!entry.name.endsWith('.json') || entry.name.startsWith('.')) {
        continue;
      }

      const relativePath = path.relative(COMMENTS_DIR, fullPath);
      const segments = relativePath.split(path.sep);
      const fileName = segments[segments.length - 1];
      const commentableId = Number.parseInt(fileName.replace(/\.json$/i, ''), 10);
      if (Number.isNaN(commentableId)) {
        continue;
      }

      const hasLocale = segments.length >= 3 && isValidLocaleCode(segments[0]);
      const language = hasLocale ? segments[0] : DEFAULT_LANGUAGE;
      const typeSegment = hasLocale ? segments[1] : segments[0];
      const inferredType = normalizeCommentableType(typeSegment);

      let rawComments: any[] = [];
      try {
        const content = await fs.readFile(fullPath, 'utf8');
        const parsed = JSON.parse(content);
        if (!Array.isArray(parsed)) {
          logger.verbose(`[COMMENTS] Skipping non-array comment file: ${fullPath}`);
          continue;
        }
        rawComments = parsed;
      } catch (error: any) {
        logger.verbose(`[COMMENTS] Failed to parse ${fullPath}: ${error.message}`);
        continue;
      }

      const comments = rawComments.map((comment): EditableComment => ({
        ...comment,
        commentableId: comment.commentableId ?? commentableId,
        commentableType: comment.commentableType ?? inferredType,
        language: comment.language ?? language,
      }));

      files.push({
        filePath: fullPath,
        commentableType: inferredType,
        commentableId,
        language,
        comments,
      });
    }
  }

  await walk(COMMENTS_DIR);
  return files;
}

function flattenLocalComments(files: LocalCommentFile[]): LocalCommentItem[] {
  return files.flatMap(file => file.comments.map(comment => ({
    file,
    filePath: file.filePath,
    locale: comment.language || file.language,
    comment,
  })));
}

function filterOperationsByTargetId(operations: CommentOperation[], targetId?: string): CommentOperation[] {
  if (!targetId) return operations;
  return operations.filter(op => {
    const localId = op.local?.comment.id != null ? String(op.local.comment.id) : undefined;
    const remoteId = op.remote?.id != null ? String(op.remote.id) : undefined;
    return localId === targetId || remoteId === targetId;
  });
}

function buildCreatePayload(local: LocalCommentItem): CommentCreateItem {
  return filterUndefinedValues({
    parentId: local.comment.parentId ?? null,
    authorName: local.comment.authorName,
    authorEmail: local.comment.authorEmail,
    body: local.comment.body,
    status: local.comment.status,
    commentableId: local.comment.commentableId,
    commentableType: local.comment.commentableType,
    language: local.comment.language,
    translationKey: local.comment.translationKey,
    tags: local.comment.tags,
    contactId: local.comment.contactId,
    source: local.comment.source,
    publishedAt: local.comment.publishedAt,
  }) as CommentCreateItem;
}

function buildUpdatePayload(local: LocalCommentItem, remote: RemoteCommentItem): CommentUpdateItem {
  const normalized = normalizeEditableFields(local.comment, remote);
  return filterUndefinedValues({
    body: normalized.body,
    authorName: normalized.authorName,
    language: normalized.language,
    status: normalized.status,
    answerStatus: normalized.answerStatus,
    translationKey: normalized.translationKey,
    tags: normalized.tags.length > 0 ? normalized.tags : local.comment.tags ?? remote.tags,
    publishedAt: normalized.publishedAt,
  }) as CommentUpdateItem;
}

function filterUndefinedValues<T extends Record<string, any>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined)
  ) as T;
}

async function fetchRemoteComments(): Promise<RemoteCommentItem[]> {
  const result = await pullCommentSync(undefined);
  return result.items as RemoteCommentItem[];
}

async function updateLocalFileFromResponse(
  local: LocalCommentItem,
  remote: RemoteCommentItem,
  remoteCtx?: RemoteContext,
): Promise<void> {
  // Update per-remote metadata
  if (remoteCtx) {
    try {
      const rc = await import('../lib/remote-context.js');
      const metaMap = await rc.readMetadataMap(remoteCtx);
      if (remote.id != null && remote.translationKey && remote.language) {
        rc.setCommentRemoteId(metaMap, remote.language, remote.translationKey, remote.id);
        rc.setMetadataForComment(metaMap, remote.language, remote.translationKey, {
          createdAt: remote.createdAt,
          updatedAt: remote.updatedAt ?? undefined,
        });
      }
      await rc.writeMetadataMap(remoteCtx, metaMap);
    } catch (error: any) {
      console.warn(`Failed to update remote metadata for comment ${remote.id}:`, error.message);
    }
  }

  // Only update local file for default remote or single-remote mode
  if (remoteCtx && !remoteCtx.isDefault) {
    return;
  }

  Object.assign(local.comment, {
    ...local.comment,
    id: remote.id,
    parentId: remote.parentId ?? null,
    authorName: remote.authorName,
    authorEmail: undefined,
    body: remote.body,
    status: remote.status,
    answerStatus: remote.answerStatus,
    createdAt: remote.createdAt,
    updatedAt: remote.updatedAt,
    publishedAt: remote.publishedAt,
    commentableId: remote.commentableId,
    commentableType: remote.commentableType,
    language: remote.language,
    translationKey: remote.translationKey,
    contactId: remote.contactId,
    source: remote.source,
    tags: remote.tags,
    avatarUrl: remote.avatarUrl,
  });

  await saveCommentsForEntity(
    local.comment.commentableType,
    local.comment.commentableId,
    local.comment.language,
    local.file.comments as StoredComment[]
  );
}

export async function buildCommentStatus(options: CommentStatusOptions = {}): Promise<CommentStatusResult> {
  const { showDelete, targetId, remoteContext: remoteCtx } = options;
  const localFiles = await readLocalCommentFiles();
  const localComments = flattenLocalComments(localFiles);
  const remoteComments = await fetchRemoteComments();
  const remoteById = new Map(remoteComments.map(comment => [comment.id, comment]));

  // Build translationKey-based lookup for remote comments
  const remoteByKey = new Map<string, RemoteCommentItem>();
  for (const rc of remoteComments) {
    if (rc.translationKey && rc.language) {
      remoteByKey.set(`${rc.language}/${rc.translationKey}`, rc);
    }
  }

  // Load per-remote metadata map for matching
  let metadataMap: MetadataMap | undefined;
  if (remoteCtx) {
    const rcMod = await import('../lib/remote-context.js');
    metadataMap = await rcMod.readMetadataMap(remoteCtx);
  }

  const operations: CommentOperation[] = [];

  for (const local of localComments) {
    // Determine the remote ID for this comment:
    // 1. If metadata map is available, look up by language+translationKey
    // 2. Otherwise fall back to the local file's id field
    let effectiveRemoteId: number | undefined;

    if (metadataMap && local.comment.translationKey && local.comment.language) {
      const metaId = metadataMap.comments?.[local.comment.language]?.[local.comment.translationKey]?.id;
      if (metaId != null) {
        effectiveRemoteId = Number(metaId);
      }
    }

    // Fall back to local id when no metadata map or no entry found
    if (effectiveRemoteId == null && local.comment.id != null) {
      effectiveRemoteId = local.comment.id;
    }

    if (effectiveRemoteId == null) {
      // Also try matching by translationKey in remote comments
      if (local.comment.translationKey && local.comment.language) {
        const key = `${local.comment.language}/${local.comment.translationKey}`;
        const remoteMatch = remoteByKey.get(key);
        if (remoteMatch) {
          effectiveRemoteId = remoteMatch.id;
        }
      }
    }

    if (effectiveRemoteId == null) {
      operations.push({ type: 'create', local });
      continue;
    }

    const remote = remoteById.get(effectiveRemoteId);
    if (!remote) {
      operations.push({
        type: 'conflict',
        local,
        reason: 'Remote comment not found for local ID',
      });
      continue;
    }

    if (hasImmutableDifferences(local.comment, remote)) {
      operations.push({
        type: 'conflict',
        local,
        remote,
        reason: 'Cannot change parent or target entity of an existing comment',
      });
      continue;
    }

    if (hasEditableDifferences(local.comment, remote)) {
      if (isRemoteNewer(local.comment, remote, metadataMap)) {
        operations.push({
          type: 'conflict',
          local,
          remote,
          reason: 'Remote comment changed after the last pull',
        });
      } else {
        operations.push({ type: 'update', local, remote });
      }
    }
  }

  if (showDelete) {
    // Collect all known remote IDs — both from local file IDs and metadata map
    const knownRemoteIds = new Set<number>();
    for (const item of localComments) {
      if (item.comment.id != null) knownRemoteIds.add(item.comment.id);
      if (metadataMap && item.comment.translationKey && item.comment.language) {
        const metaId = metadataMap.comments?.[item.comment.language]?.[item.comment.translationKey]?.id;
        if (metaId != null) knownRemoteIds.add(Number(metaId));
      }
    }

    for (const remote of remoteComments) {
      if (!knownRemoteIds.has(remote.id)) {
        operations.push({ type: 'delete', remote });
      }
    }
  }

  return {
    operations: filterOperationsByTargetId(operations, targetId),
    totalLocal: localComments.length,
    totalRemote: remoteComments.length,
  };
}

export async function statusComments(options: CommentStatusOptions = {}): Promise<void> {
  const { showDetailedPreview, targetId } = options;
  const result = await buildCommentStatus(options);
  const operations = result.operations;

  function printCommentPreview(op: CommentOperation): void {
    if (!showDetailedPreview && !targetId) return;

    const local = op.local?.comment;
    const remote = op.remote;

    if (op.type === 'delete' && remote) {
      colorConsole.info('          Comment preview:');
      colorConsole.log(`          ${colorConsole.gray('Remote body:')} ${remote.body}`);
      colorConsole.log('');
      return;
    }

    if (op.type === 'create' && local) {
      colorConsole.info('          Comment preview:');
      colorConsole.log(`          ${colorConsole.gray('Author:')} ${local.authorName || 'Unknown'} <${local.authorEmail || 'no-email'}>`);
      if (local.status) {
        colorConsole.log(`          ${colorConsole.gray('Status:')} ${local.status}`);
      }
      if (local.answerStatus) {
        colorConsole.log(`          ${colorConsole.gray('Answer status:')} ${local.answerStatus}`);
      }
      colorConsole.log(`          ${colorConsole.gray('Body:')} ${local.body}`);
      colorConsole.log('');
      return;
    }

    if (!local || !remote) return;

    colorConsole.info('          Comment diff preview:');

    const fieldDiffs: Array<[string, string | undefined, string | undefined]> = [
      ['authorName', remote.authorName, local.authorName],
      ['language', remote.language, local.language],
      ['status', remote.status, local.status],
      ['answerStatus', remote.answerStatus, local.answerStatus],
      ['publishedAt', remote.publishedAt ?? undefined, local.publishedAt ?? undefined],
      ['translationKey', remote.translationKey ?? undefined, local.translationKey ?? undefined],
      ['tags', JSON.stringify(normalizeTags(remote.tags)), JSON.stringify(normalizeTags(local.tags))],
    ];

    for (const [field, before, after] of fieldDiffs) {
      if ((before ?? '') !== (after ?? '')) {
        colorConsole.log(`          ${colorConsole.gray(`${field}:`)} ${colorConsole.red(before ?? '∅')} ${colorConsole.gray('->')} ${colorConsole.green(after ?? '∅')}`);
      }
    }

    if (remote.body !== local.body) {
      const diff = Diff.diffLines(remote.body || '', local.body || '');
      let previewLines = 0;
      const maxPreviewLines = 6;

      for (const part of diff) {
        const lines = part.value.split('\n').filter(line => line.trim() !== '');
        for (const line of lines) {
          if (previewLines >= maxPreviewLines) break;
          if (part.added) {
            colorConsole.log(`          ${diffColors.added(`+ ${line}`)}`);
            previewLines++;
          } else if (part.removed) {
            colorConsole.log(`          ${diffColors.removed(`- ${line}`)}`);
            previewLines++;
          }
        }
        if (previewLines >= maxPreviewLines) break;
      }
    }

    colorConsole.log('');
  }

  if (operations.length === 0) {
    console.log('✅ Comments are in sync');
    return;
  }

  colorConsole.important('\n💬 Comment Status');
  for (const op of operations) {
    const local = op.local?.comment;
    const remote = op.remote;
    const commentId = local?.id ?? remote?.id ?? 'new';
    const locale = local?.language ?? remote?.language ?? DEFAULT_LANGUAGE;
    const commentableType = local?.commentableType ?? remote?.commentableType ?? 'Unknown';
    const commentableId = local?.commentableId ?? remote?.commentableId ?? 'unknown';

    const line = `${commentableType}#${commentableId} [${locale}] comment ${commentId}`;

    switch (op.type) {
      case 'create':
        colorConsole.log(`   ${statusColors.created('new:      ')} ${line}`);
        printCommentPreview(op);
        break;
      case 'update':
        colorConsole.log(`   ${statusColors.modified('modified: ')} ${line}`);
        printCommentPreview(op);
        break;
      case 'delete':
        colorConsole.log(`   ${statusColors.conflict('deleted:  ')} ${line}`);
        printCommentPreview(op);
        break;
      case 'conflict':
        colorConsole.log(`   ${statusColors.conflict('conflict: ')} ${line}`);
        if (op.reason) {
          colorConsole.log(`              ${colorConsole.gray(op.reason)}`);
        }
        printCommentPreview(op);
        break;
    }
  }

  console.log('');
}

async function promptForLine(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer.trim()));
  });
}

async function resolveAuthorEmails(
  createOps: CommentOperation[],
  currentUserEmail: string | undefined,
): Promise<Map<CommentOperation, string>> {
  const emailMap = new Map<CommentOperation, string>();
  const opsNeedingEmail = createOps.filter(op => op.local && !op.local.comment.authorEmail);
  if (opsNeedingEmail.length === 0) {
    // All create ops already have authorEmail from the local file
    for (const op of createOps) {
      if (op.local?.comment.authorEmail) {
        emailMap.set(op, op.local.comment.authorEmail);
      }
    }
    return emailMap;
  }

  // Also pre-set any ops that already have authorEmail
  for (const op of createOps) {
    if (op.local?.comment.authorEmail) {
      emailMap.set(op, op.local.comment.authorEmail);
    }
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    const defaultEmail = currentUserEmail || '';
    const defaultHint = defaultEmail ? ` [${defaultEmail}]` : '';

    const emailInput = await promptForLine(
      rl,
      `📧 Author email for new comments${defaultHint}: `,
    );
    const chosenEmail = emailInput || defaultEmail;
    if (!chosenEmail) {
      console.warn('⚠️  No author email provided — new comments without authorEmail will be skipped');
      return emailMap;
    }

    if (opsNeedingEmail.length === 1) {
      emailMap.set(opsNeedingEmail[0], chosenEmail);
      return emailMap;
    }

    const applyAll = await promptForLine(
      rl,
      `Apply "${chosenEmail}" to all ${opsNeedingEmail.length} new comments? [Y/n]: `,
    );

    if (!applyAll || applyAll.toLowerCase() === 'y' || applyAll.toLowerCase() === 'yes') {
      for (const op of opsNeedingEmail) {
        emailMap.set(op, chosenEmail);
      }
      return emailMap;
    }

    // Per-comment email entry
    let lastEmail = chosenEmail;
    for (const op of opsNeedingEmail) {
      const local = op.local!.comment;
      const label = `${local.commentableType}#${local.commentableId} [${local.language || 'en'}]`;
      const perHint = lastEmail ? ` [${lastEmail}]` : '';
      const perInput = await promptForLine(rl, `📧 Email for ${label}${perHint}: `);
      lastEmail = perInput || lastEmail;
      if (lastEmail) {
        emailMap.set(op, lastEmail);
      }
    }

    return emailMap;
  } finally {
    rl.close();
  }
}

export async function pushComments(options: PushCommentsOptions = {}): Promise<void> {
  if (!leadCMSDataService.isApiKeyConfigured()) {
    console.log('⏭️  Comments require authentication — no API key configured, skipping');
    return;
  }

  const { force, dryRun, allowDelete, targetId, remoteContext: remoteCtx } = options;
  const status = await buildCommentStatus({ showDelete: allowDelete, targetId, remoteContext: remoteCtx });
  let didMutate = false;

  // Resolve author emails for new comments before processing
  const createOps = status.operations.filter(op => op.type === 'create' && op.local);
  let authorEmails = new Map<CommentOperation, string>();
  if (createOps.length > 0 && !dryRun) {
    let currentUserEmail: string | undefined;
    try {
      const { resolveIdentity } = await import('./leadcms-helpers.js');
      const identity = await resolveIdentity();
      currentUserEmail = identity?.email;
    } catch {
      // Identity resolution is best-effort
    }
    authorEmails = await resolveAuthorEmails(createOps, currentUserEmail);
  }

  for (const operation of status.operations) {
    if (operation.type === 'conflict' && !force) {
      const label = operation.local?.comment.id ?? operation.remote?.id ?? 'unknown';
      console.warn(`⚠️  Skipping comment ${label}: ${operation.reason || 'Conflict detected'}`);
      continue;
    }

    if (operation.type === 'create' && operation.local) {
      const payload = buildCreatePayload(operation.local);

      // Apply resolved authorEmail if the local file didn't have one
      if (!payload.authorEmail) {
        const resolved = authorEmails.get(operation);
        if (resolved) {
          payload.authorEmail = resolved;
        }
      }

      if (!payload.body || !payload.authorEmail || !payload.commentableType) {
        console.warn(`⚠️  Skipping ${operation.local.filePath} - missing required fields for new comment`);
        continue;
      }

      if (dryRun) {
        console.log(`🟡 [DRY RUN] Create comment in ${payload.commentableType}#${payload.commentableId}`);
        continue;
      }

      const created = await leadCMSDataService.createComment(payload);
      console.log(`✅ Created comment ${created.id} in ${created.commentableType}#${created.commentableId}`);
      await updateLocalFileFromResponse(operation.local, created, remoteCtx);
      didMutate = true;
      continue;
    }

    if (operation.type === 'update' && operation.local && operation.remote) {
      const payload = buildUpdatePayload(operation.local, operation.remote);
      if (dryRun) {
        console.log(`🟡 [DRY RUN] Update comment ${operation.remote.id}`);
        continue;
      }

      const updated = await leadCMSDataService.updateComment(operation.remote.id, payload);
      console.log(`✅ Updated comment ${updated.id}`);
      await updateLocalFileFromResponse(operation.local, updated, remoteCtx);
      didMutate = true;
      continue;
    }

    if (operation.type === 'conflict' && force && operation.local) {
      // Look up the remote ID for this comment — it might differ from local.comment.id
      // when working with a non-default remote
      let remoteId: number | undefined;
      if (remoteCtx) {
        const rcMod = await import('../lib/remote-context.js');
        const metaMap = await rcMod.readMetadataMap(remoteCtx);
        const lang = operation.local.comment.language;
        const tk = operation.local.comment.translationKey;
        if (lang && tk) {
          const metaId = metaMap.comments?.[lang]?.[tk]?.id;
          if (metaId != null) remoteId = Number(metaId);
        }
      }
      if (remoteId == null) remoteId = operation.local.comment.id ?? undefined;
      if (remoteId == null) {
        continue;
      }

      const remote = operation.remote;
      if (!remote || hasImmutableDifferences(operation.local.comment, remote)) {
        console.warn(`⚠️  Cannot force-push immutable changes for comment ${remoteId}`);
        continue;
      }

      const payload = buildUpdatePayload(operation.local, remote);
      if (dryRun) {
        console.log(`🟡 [DRY RUN] Force update comment ${remoteId}`);
        continue;
      }

      const updated = await leadCMSDataService.updateComment(remoteId, payload);
      console.log(`✅ Force-updated comment ${updated.id}`);
      await updateLocalFileFromResponse(operation.local, updated, remoteCtx);
      didMutate = true;
      continue;
    }

    if (operation.type === 'delete' && allowDelete && operation.remote) {
      if (dryRun) {
        console.log(`🟡 [DRY RUN] Delete remote comment ${operation.remote.id}`);
        continue;
      }

      await leadCMSDataService.deleteComment(operation.remote.id);
      console.log(`✅ Deleted remote comment ${operation.remote.id}`);
      didMutate = true;
    }
  }

  if (!dryRun && didMutate) {
    console.log('🔄 Refreshing local comments anonymously...');
    await pullLeadCMSComments(remoteCtx);
  }
}

export type { CommentOperation, LocalCommentItem, RemoteCommentItem, PushCommentsOptions, CommentStatusOptions };
