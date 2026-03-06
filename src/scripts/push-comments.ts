import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import type { Dirent } from 'fs';
import * as Diff from 'diff';

import { getConfig } from '../lib/config.js';
import { leadCMSDataService } from '../lib/data-service.js';
import { isValidLocaleCode } from '../lib/locale-utils.js';
import { colorConsole, diffColors, statusColors } from '../lib/console-colors.js';
import { logger } from '../lib/logger.js';
import { fetchCommentSync, saveCommentsForEntity } from './fetch-leadcms-comments.js';

import type { Comment, StoredComment } from '../lib/comment-types.js';
import type { CommentCreateItem, CommentUpdateItem } from '../lib/data-service.js';

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
}

interface PushCommentsOptions {
  force?: boolean;
  dryRun?: boolean;
  allowDelete?: boolean;
  targetId?: string;
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
    authorEmail: comment.authorEmail ?? remote?.authorEmail ?? '',
    language: comment.language ?? remote?.language ?? DEFAULT_LANGUAGE,
    status: comment.status ?? remote?.status ?? undefined,
    answerStatus: comment.answerStatus ?? remote?.answerStatus ?? undefined,
    translationKey: comment.translationKey ?? remote?.translationKey ?? undefined,
    tags: normalizeTags(comment.tags ?? remote?.tags),
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

function isRemoteNewer(local: EditableComment, remote: RemoteCommentItem): boolean {
  if (!local.updatedAt || !remote.updatedAt) return false;
  const localTime = Date.parse(local.updatedAt);
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
  }) as CommentCreateItem;
}

function buildUpdatePayload(local: LocalCommentItem, remote: RemoteCommentItem): CommentUpdateItem {
  const normalized = normalizeEditableFields(local.comment, remote);
  return filterUndefinedValues({
    body: normalized.body,
    authorName: normalized.authorName,
    authorEmail: normalized.authorEmail,
    language: normalized.language,
    status: normalized.status,
    answerStatus: normalized.answerStatus,
    translationKey: normalized.translationKey,
    tags: normalized.tags.length > 0 ? normalized.tags : local.comment.tags ?? remote.tags,
  }) as CommentUpdateItem;
}

function filterUndefinedValues<T extends Record<string, any>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined)
  ) as T;
}

async function fetchRemoteComments(): Promise<RemoteCommentItem[]> {
  const result = await fetchCommentSync(undefined);
  return result.items as RemoteCommentItem[];
}

async function updateLocalFileFromResponse(local: LocalCommentItem, remote: RemoteCommentItem): Promise<void> {
  Object.assign(local.comment, {
    ...local.comment,
    id: remote.id,
    parentId: remote.parentId ?? null,
    authorName: remote.authorName,
    authorEmail: remote.authorEmail,
    body: remote.body,
    status: remote.status,
    answerStatus: remote.answerStatus,
    createdAt: remote.createdAt,
    updatedAt: remote.updatedAt,
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
  const { showDelete, targetId } = options;
  const localFiles = await readLocalCommentFiles();
  const localComments = flattenLocalComments(localFiles);
  const remoteComments = await fetchRemoteComments();
  const remoteById = new Map(remoteComments.map(comment => [comment.id, comment]));
  const operations: CommentOperation[] = [];

  for (const local of localComments) {
    const localId = local.comment.id;
    if (localId == null) {
      operations.push({ type: 'create', local });
      continue;
    }

    const remote = remoteById.get(localId);
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
      if (isRemoteNewer(local.comment, remote)) {
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
    const localIds = new Set(
      localComments
        .map(item => item.comment.id)
        .filter((id): id is number => id != null)
    );

    for (const remote of remoteComments) {
      if (!localIds.has(remote.id)) {
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
      ['authorEmail', remote.authorEmail, local.authorEmail],
      ['language', remote.language, local.language],
      ['status', remote.status, local.status],
      ['answerStatus', remote.answerStatus, local.answerStatus],
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

export async function pushComments(options: PushCommentsOptions = {}): Promise<void> {
  if (!leadCMSDataService.isApiKeyConfigured()) {
    console.log('⏭️  Comments require authentication — no API key configured, skipping');
    return;
  }

  const { force, dryRun, allowDelete, targetId } = options;
  const status = await buildCommentStatus({ showDelete: allowDelete, targetId });

  for (const operation of status.operations) {
    if (operation.type === 'conflict' && !force) {
      const label = operation.local?.comment.id ?? operation.remote?.id ?? 'unknown';
      console.warn(`⚠️  Skipping comment ${label}: ${operation.reason || 'Conflict detected'}`);
      continue;
    }

    if (operation.type === 'create' && operation.local) {
      const payload = buildCreatePayload(operation.local);
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
      await updateLocalFileFromResponse(operation.local, created);
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
      await updateLocalFileFromResponse(operation.local, updated);
      continue;
    }

    if (operation.type === 'conflict' && force && operation.local) {
      const localId = operation.local.comment.id;
      if (localId == null) {
        continue;
      }

      const remote = operation.remote;
      if (!remote || hasImmutableDifferences(operation.local.comment, remote)) {
        console.warn(`⚠️  Cannot force-push immutable changes for comment ${localId}`);
        continue;
      }

      const payload = buildUpdatePayload(operation.local, remote);
      if (dryRun) {
        console.log(`🟡 [DRY RUN] Force update comment ${localId}`);
        continue;
      }

      const updated = await leadCMSDataService.updateComment(localId, payload);
      console.log(`✅ Force-updated comment ${updated.id}`);
      await updateLocalFileFromResponse(operation.local, updated);
      continue;
    }

    if (operation.type === 'delete' && allowDelete && operation.remote) {
      if (dryRun) {
        console.log(`🟡 [DRY RUN] Delete remote comment ${operation.remote.id}`);
        continue;
      }

      await leadCMSDataService.deleteComment(operation.remote.id);
      console.log(`✅ Deleted remote comment ${operation.remote.id}`);
    }
  }
}

export type { CommentOperation, LocalCommentItem, RemoteCommentItem, PushCommentsOptions, CommentStatusOptions };
