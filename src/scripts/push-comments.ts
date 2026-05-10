import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';
import type { Dirent } from 'fs';
import * as Diff from 'diff';

import { getConfig } from '../lib/config.js';
import { leadCMSDataService } from '../lib/data-service.js';
import { compareVersions } from '../lib/auth.js';
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

function normalizeEditableFields(
  comment: Partial<EditableComment | RemoteCommentItem>,
  remote?: RemoteCommentItem,
  canReparent: boolean = true,
) {
  const base: Record<string, any> = {
    body: comment.body ?? remote?.body ?? '',
    authorName: comment.authorName ?? remote?.authorName ?? '',
    language: comment.language ?? remote?.language ?? DEFAULT_LANGUAGE,
    status: comment.status ?? remote?.status ?? undefined,
    answerStatus: comment.answerStatus ?? remote?.answerStatus ?? undefined,
    translationKey: comment.translationKey ?? remote?.translationKey ?? undefined,
    tags: normalizeTags(comment.tags ?? remote?.tags),
    publishedAt: comment.publishedAt ?? remote?.publishedAt ?? undefined,
  };
  // Reparenting fields are only sent/compared when the server supports them
  // (LeadCMS >= 1.5.16-pre). On older servers, parentId and commentableId are
  // immutable via the API, so including them in diffs would produce false
  // updates/conflicts after local file relocations.
  if (canReparent) {
    base.parentId = comment.parentId ?? remote?.parentId ?? undefined;
    base.commentableId = comment.commentableId ?? remote?.commentableId ?? undefined;
  }
  return base;
}

function hasEditableDifferences(
  local: EditableComment,
  remote: RemoteCommentItem,
  canReparent: boolean = true,
): boolean {
  const normalizedLocal = normalizeEditableFields(local, remote, canReparent);
  const normalizedRemote = normalizeEditableFields(remote, undefined, canReparent);
  return JSON.stringify(normalizedLocal) !== JSON.stringify(normalizedRemote);
}

// Detect whether local comments have parentId/commentableId values that
// differ from their remote counterpart — used to warn users on older servers
// that their reparenting changes won't sync.
function hasReparentingIntent(local: EditableComment, remote: RemoteCommentItem): boolean {
  const localParent = local.parentId ?? null;
  const remoteParent = remote.parentId ?? null;
  if (localParent !== remoteParent) return true;
  const localCommentable = local.commentableId ?? null;
  const remoteCommentable = remote.commentableId ?? null;
  return localCommentable !== remoteCommentable;
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

function buildUpdatePayload(
  local: LocalCommentItem,
  remote: RemoteCommentItem,
  canReparent: boolean = true,
): CommentUpdateItem {
  const normalized = normalizeEditableFields(local.comment, remote, canReparent);
  const payload: Record<string, any> = {
    body: normalized.body,
    authorName: normalized.authorName,
    language: normalized.language,
    status: normalized.status,
    answerStatus: normalized.answerStatus,
    translationKey: normalized.translationKey,
    tags: normalized.tags.length > 0 ? normalized.tags : local.comment.tags ?? remote.tags,
    publishedAt: normalized.publishedAt,
  };
  if (canReparent) {
    payload.parentId = normalized.parentId;
    payload.commentableId = normalized.commentableId;
  }
  return filterUndefinedValues(payload) as CommentUpdateItem;
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

  const isNonDefaultRemote = !!(remoteCtx && !remoteCtx.isDefault);

  if (isNonDefaultRemote) {
    // On non-default remotes we intentionally do NOT write id/createdAt/updatedAt
    // into the local file — those fields belong to the default remote. We also
    // intentionally KEEP authorEmail: the same local entry still needs to be
    // CREATE-able on the default remote later, and create requires authorEmail.
    // The anonymous pull that runs after the default-remote push is what
    // finally strips authorEmail (pull replaces the local entry entirely and
    // authorEmail is not part of StoredComment).
    //
    // We only stamp translationKey (and refresh parentId/authorName/language)
    // so the post-push anonymous pull can merge by translationKey instead of
    // creating a duplicate row.
    Object.assign(local.comment, {
      ...local.comment,
      parentId: remote.parentId ?? null,
      authorName: remote.authorName,
      language: remote.language,
      translationKey: remote.translationKey ?? local.comment.translationKey,
    });
  } else {
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
  }

  await saveCommentsForEntity(
    local.comment.commentableType,
    local.comment.commentableId,
    local.comment.language,
    local.file.comments as StoredComment[]
  );
}

// Minimum LeadCMS server version that supports updating parentId and
// commentableId via PATCH /api/comments/{id} (i.e. reparenting comments).
const REPARENT_MIN_VERSION = '1.5.16-pre';

/**
 * Check whether the configured LeadCMS server supports reparenting comments
 * (updating `parentId` and/or `commentableId`). Returns `{ supported, version }`
 * where `version` is `null` if the version endpoint is unreachable.
 *
 * When the version can't be determined, we default to "supported" so pushes
 * aren't silently crippled on healthy servers; the server itself will reject
 * the request if it really doesn't support the fields.
 */
async function checkReparentingSupport(): Promise<{ supported: boolean; version: string | null }> {
  let version: string | null = null;
  try {
    version = await leadCMSDataService.getServerVersion();
  } catch {
    version = null;
  }
  if (!version) return { supported: true, version: null };
  return {
    supported: compareVersions(version, REPARENT_MIN_VERSION) >= 0,
    version,
  };
}

export async function buildCommentStatus(options: CommentStatusOptions = {}): Promise<CommentStatusResult> {
  const { showDelete, targetId, remoteContext: remoteCtx } = options;
  const localFiles = await readLocalCommentFiles();
  const localComments = flattenLocalComments(localFiles);
  const remoteComments = await fetchRemoteComments();
  const remoteById = new Map(remoteComments.map(comment => [comment.id, comment]));

  // Feature-gate reparenting (parentId/commentableId updates) on server version.
  const { supported: canReparent, version: serverVersion } = await checkReparentingSupport();

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

    if (hasEditableDifferences(local.comment, remote, canReparent)) {
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

    // On older servers, detect local parentId/commentableId edits that will
    // not sync so the user isn't left wondering why their reparenting is
    // silently dropped.
    if (!canReparent && hasReparentingIntent(local.comment, remote)) {
      const commentableType = local.comment.commentableType ?? 'Content';
      const separator = commentableType === 'Content' ? ' #' : '#';
      const label = `${commentableType}${separator}${local.comment.commentableId} comment ${remote.id}`;
      const versionSuffix = serverVersion ? ` (server ${serverVersion})` : '';
      console.warn(
        `⚠️  Skipping parentId/commentableId change for ${label}: LeadCMS ${REPARENT_MIN_VERSION} or later required to reparent comments${versionSuffix}.`,
      );
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

/**
 * Build a best-effort `Content` id -> slug map for the given comment
 * operations. Tries local content files first (no network), then falls back
 * to the remote data service for any still-unresolved ids. Any failure in
 * either source is silently ignored — slug display is a nicety, not a hard
 * requirement — and the label falls back to the numeric id.
 */
async function buildContentSlugMap(operations: CommentOperation[]): Promise<Map<number, string>> {
  const slugById = new Map<number, string>();

  const contentIds = new Set<number>();
  for (const op of operations) {
    const type = op.local?.comment.commentableType ?? op.remote?.commentableType;
    if (type !== 'Content') continue;
    const id = op.local?.comment.commentableId ?? op.remote?.commentableId;
    if (typeof id === 'number' && Number.isFinite(id)) {
      contentIds.add(id);
    }
  }
  if (contentIds.size === 0) return slugById;

  // 1. Local content (fast, offline)
  try {
    const { readLocalContent } = await import('./push-leadcms-content.js');
    const localContent = await readLocalContent();
    for (const item of localContent) {
      const rawId = (item as any).id;
      const numericId = typeof rawId === 'number' ? rawId : Number(rawId);
      if (Number.isFinite(numericId) && item.slug && !slugById.has(numericId)) {
        slugById.set(numericId, item.slug);
      }
    }
  } catch {
    // Local content is best-effort; fall through to remote lookup.
  }

  // 2. Remote lookup for any ids still unresolved
  const missing = [...contentIds].filter(id => !slugById.has(id));
  if (missing.length === 0) return slugById;

  try {
    for (const id of missing) {
      const content = await leadCMSDataService.getContentById(id);
      if (content?.slug) {
        slugById.set(id, content.slug);
      }
    }
  } catch {
    // Remote lookup failures are non-fatal.
  }

  return slugById;
}

/**
 * Extract a concise, human-readable message from a failed comment API call.
 * Highlights 404 "entity not found" responses (returned by the server when
 * the targeted commentableType/commentableId pair doesn't exist) so the user
 * can see why the comment couldn't be saved without having to read raw
 * axios error objects.
 */
function formatCommentApiError(error: any): { message: string; isNotFound: boolean } {
  const status: number | undefined = error?.response?.status ?? error?.status;
  const data: any = error?.response?.data;
  const isNotFound = status === 404;

  if (isNotFound && data && typeof data === 'object') {
    const { entityType, entityUid, title, detail } = data;
    if (entityType && entityUid != null) {
      return {
        message: `404 Not Found — ${entityType}#${entityUid} does not exist on the server`,
        isNotFound,
      };
    }
    if (title || detail) {
      return { message: `404 Not Found — ${detail || title}`, isNotFound };
    }
  }

  if (status && data && typeof data === 'object') {
    const detail = data.detail || data.title;
    if (detail) return { message: `${status} ${detail}`, isNotFound };
  }

  const msg = error?.message || String(error);
  return { message: status ? `${status} ${msg}` : msg, isNotFound };
}

export async function statusComments(options: CommentStatusOptions = {}): Promise<void> {
  const { showDetailedPreview, targetId } = options;
  const result = await buildCommentStatus(options);
  const operations = result.operations;

  // Build a best-effort map of Content id -> slug so the status output can
  // show "Content #<slug> comment N" instead of the opaque numeric id.
  const contentSlugById = await buildContentSlugMap(operations);

  function formatCommentableLabel(type: string, id: number | string): string {
    if (type === 'Content' && typeof id === 'number') {
      const slug = contentSlugById.get(id);
      if (slug) return `${type} #${id} (${slug})`;
    }
    const separator = type === 'Content' ? ' #' : '#';
    return `${type}${separator}${id}`;
  }

  function formatInlineCommentPreview(body: string | undefined, maxLength = 48): string {
    const normalized = (body || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
  }

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
    const commentRef = op.type === 'create' ? '' : ` comment ${commentId}`;
    const createPreview = op.type === 'create' ? formatInlineCommentPreview(local?.body) : '';
    const previewSuffix = createPreview ? ` - ${JSON.stringify(createPreview)}` : '';
    const line = `${formatCommentableLabel(commentableType, commentableId)} [${locale}]${commentRef}${previewSuffix}`;

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
  const { supported: canReparent } = await checkReparentingSupport();
  let didMutate = false;
  let failureCount = 0;

  // Resolve Content id -> slug for user-facing messages (best-effort, offline-first).
  const contentSlugById = await buildContentSlugMap(status.operations);
  const formatCommentable = (type: string | undefined, id: number | string | null | undefined): string => {
    const t = type ?? 'Unknown';
    const separator = t === 'Content' ? ' #' : '#';
    if (id == null) return `${t}${separator}unknown`;
    if (t === 'Content' && typeof id === 'number') {
      const slug = contentSlugById.get(id);
      if (slug) return `${t} #${id} (${slug})`;
    }
    return `${t}${separator}${id}`;
  };

  // Count operations that actually result in an API call so we can emit
  // `[n/total]` progress prefixes similar to `push-media`.
  const totalOps = status.operations.reduce((count, op) => {
    if (op.type === 'create') return count + 1;
    if (op.type === 'update') return count + 1;
    if (op.type === 'conflict' && force && op.local) return count + 1;
    if (op.type === 'delete' && allowDelete) return count + 1;
    return count;
  }, 0);
  let completedOps = 0;
  const progress = () => `[${completedOps}/${totalOps}]`;

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

      completedOps++;
      const target = formatCommentable(payload.commentableType, payload.commentableId);

      if (dryRun) {
        console.log(`${progress()} 🟡 [DRY RUN] Create comment in ${target}`);
        continue;
      }

      try {
        const created = await leadCMSDataService.createComment(payload);
        const createdTarget = formatCommentable(created.commentableType, created.commentableId);
        console.log(`${progress()} ✅ Created comment ${created.id} in ${createdTarget}`);
        await updateLocalFileFromResponse(operation.local, created, remoteCtx);
        didMutate = true;
      } catch (error: any) {
        const { message, isNotFound } = formatCommentApiError(error);
        if (isNotFound) {
          console.warn(`${progress()} ⚠️  Skipped creating comment in ${target}: ${message}. The comment will be retried on the next push once the target exists.`);
        } else {
          console.error(`${progress()} ❌ Failed to create comment in ${target}: ${message}`);
        }
        failureCount++;
      }
      continue;
    }

    if (operation.type === 'update' && operation.local && operation.remote) {
      const payload = buildUpdatePayload(operation.local, operation.remote, canReparent);
      completedOps++;
      const target = formatCommentable(
        operation.local.comment.commentableType ?? operation.remote.commentableType,
        operation.local.comment.commentableId ?? operation.remote.commentableId,
      );

      if (dryRun) {
        console.log(`${progress()} 🟡 [DRY RUN] Update comment ${operation.remote.id} in ${target}`);
        continue;
      }

      try {
        const updated = await leadCMSDataService.updateComment(operation.remote.id, payload);
        console.log(`${progress()} ✅ Updated comment ${updated.id} in ${target}`);
        await updateLocalFileFromResponse(operation.local, updated, remoteCtx);
        didMutate = true;
      } catch (error: any) {
        const { message, isNotFound } = formatCommentApiError(error);
        if (isNotFound) {
          console.warn(`${progress()} ⚠️  Skipped updating comment ${operation.remote.id} in ${target}: ${message}.`);
        } else {
          console.error(`${progress()} ❌ Failed to update comment ${operation.remote.id} in ${target}: ${message}`);
        }
        failureCount++;
      }
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
      if (!remote) {
        console.warn(`⚠️  Cannot force-push comment ${remoteId}: remote not found`);
        continue;
      }

      const payload = buildUpdatePayload(operation.local, remote, canReparent);
      completedOps++;
      const target = formatCommentable(
        operation.local.comment.commentableType ?? remote.commentableType,
        operation.local.comment.commentableId ?? remote.commentableId,
      );

      if (dryRun) {
        console.log(`${progress()} 🟡 [DRY RUN] Force update comment ${remoteId} in ${target}`);
        continue;
      }

      try {
        const updated = await leadCMSDataService.updateComment(remoteId, payload);
        console.log(`${progress()} ✅ Force-updated comment ${updated.id} in ${target}`);
        await updateLocalFileFromResponse(operation.local, updated, remoteCtx);
        didMutate = true;
      } catch (error: any) {
        const { message, isNotFound } = formatCommentApiError(error);
        if (isNotFound) {
          console.warn(`${progress()} ⚠️  Skipped force-updating comment ${remoteId} in ${target}: ${message}.`);
        } else {
          console.error(`${progress()} ❌ Failed to force-update comment ${remoteId} in ${target}: ${message}`);
        }
        failureCount++;
      }
      continue;
    }

    if (operation.type === 'delete' && allowDelete && operation.remote) {
      completedOps++;
      const target = formatCommentable(operation.remote.commentableType, operation.remote.commentableId);

      if (dryRun) {
        console.log(`${progress()} 🟡 [DRY RUN] Delete remote comment ${operation.remote.id} in ${target}`);
        continue;
      }

      try {
        await leadCMSDataService.deleteComment(operation.remote.id);
        console.log(`${progress()} ✅ Deleted remote comment ${operation.remote.id} in ${target}`);
        didMutate = true;
      } catch (error: any) {
        const { message } = formatCommentApiError(error);
        console.error(`${progress()} ❌ Failed to delete comment ${operation.remote.id} in ${target}: ${message}`);
        failureCount++;
      }
    }
  }

  if (!dryRun && didMutate) {
    console.log('🔄 Refreshing local comments anonymously...');
    await pullLeadCMSComments(remoteCtx);
  }

  if (failureCount > 0) {
    console.warn(`⚠️  ${failureCount} comment ${failureCount === 1 ? 'operation' : 'operations'} failed (see messages above). Other comments were processed successfully.`);
  }
}

export type { CommentOperation, LocalCommentItem, RemoteCommentItem, PushCommentsOptions, CommentStatusOptions };
