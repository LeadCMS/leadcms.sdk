#!/usr/bin/env node
/**
 * LeadCMS Status All CLI Entry Point
 * Unified status view for content, media, and email templates
 */

import 'dotenv/config';
import { getContentStatusData } from '../../scripts/push-leadcms-content.js';
import { buildCommentStatus } from '../../scripts/push-comments.js';
import { statusMedia } from '../../scripts/push-media.js';
import { buildEmailTemplateStatus, getRemoteGroupLabel } from '../../scripts/push-email-templates.js';
import { getSettingsStatusData, renderSettingsStatus, formatSettingValue, formatSettingDiff, renderSettingDiffPreview } from '../../scripts/push-settings.js';
import { buildSegmentStatus } from '../../scripts/push-segments.js';
import { buildSequenceStatus } from '../../scripts/push-sequences.js';
import { initVerboseFromArgs } from '../../lib/logger.js';
import { colorConsole, statusColors } from '../../lib/console-colors.js';
import { defaultLanguage, leadCMSApiKey, resolveIdentity } from '../../scripts/leadcms-helpers.js';
import { startSpinner } from '../../lib/spinner.js';
import { parseRemoteFlag } from './remote-flag.js';

import type { ContentOperations, ContentStatusResult, MatchOperation } from '../../scripts/push-leadcms-content.js';
import type { CommentOperation, CommentStatusResult } from '../../scripts/push-comments.js';
import type { MediaStatusResult } from '../../scripts/push-media.js';
import type { EmailTemplateOperation, EmailTemplateStatusResult } from '../../scripts/push-email-templates.js';
import type { SettingsStatusResult } from '../../lib/settings-types.js';
import type { SegmentOperation, SegmentStatusResult } from '../../scripts/push-segments.js';
import type { SequenceOperation, SequenceStatusResult } from '../../scripts/push-sequences.js';

const args = process.argv.slice(2);
initVerboseFromArgs(args);
const remoteContext = parseRemoteFlag(args);

// Parse flags
const showDelete = args.includes('--delete');
let scopeUid: string | undefined;
const scopeIndex = args.findIndex(arg => arg === '--scope' || arg === '-s');
if (scopeIndex !== -1 && args[scopeIndex + 1]) {
  scopeUid = args[scopeIndex + 1];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function sortByLocaleAndSlug<T>(ops: T[], getLocale: (op: T) => string, getSlug: (op: T) => string): T[] {
  return [...ops].sort((a, b) => {
    const la = getLocale(a), lb = getLocale(b);
    if (la !== lb) return la.localeCompare(lb);
    return getSlug(a).localeCompare(getSlug(b));
  });
}

// ── Content rendering ────────────────────────────────────────────────────────

function renderContentLine(op: MatchOperation, label: string, colorFn: (s: string) => string): void {
  const typeLabel = (op.local?.type || op.remote?.type || 'unknown').padEnd(12);
  const localeLabel = `[${op.local?.locale || op.remote?.language || 'unknown'}]`.padEnd(6);
  const nameLabel = op.local?.slug || op.remote?.slug || 'unknown';
  const idLabel = op.remote?.id ? `(ID: ${op.remote.id})` : '';
  colorConsole.log(`        ${colorFn(label)}   ${typeLabel} ${localeLabel} ${colorConsole.highlight(nameLabel)} ${colorConsole.gray(idLabel)}`);
}

function renderContentSection(ops: ContentOperations): number {
  const creates = sortByLocaleAndSlug(ops.create, o => o.local.locale, o => o.local.slug);
  const updates = sortByLocaleAndSlug(ops.update, o => o.local.locale, o => o.local.slug);
  const renames = sortByLocaleAndSlug(ops.rename, o => o.local.locale, o => o.local.slug);
  const typeChanges = sortByLocaleAndSlug(ops.typeChange, o => o.local.locale, o => o.local.slug);
  const conflicts = sortByLocaleAndSlug(ops.conflict, o => o.local.locale, o => o.local.slug);
  const deletes = showDelete ? sortByLocaleAndSlug(ops.delete, o => o.remote?.language || '', o => o.remote?.slug || '') : [];

  const changeCount = creates.length + updates.length + renames.length + typeChanges.length + conflicts.length + deletes.length;

  for (const op of creates) renderContentLine(op, 'new:      ', statusColors.created);
  for (const op of updates) renderContentLine(op, 'modified: ', statusColors.modified);
  for (const op of renames) {
    const typeLabel = (op.local.type || 'unknown').padEnd(12);
    const localeLabel = `[${op.local.locale || 'unknown'}]`.padEnd(6);
    const idLabel = op.remote?.id ? `(ID: ${op.remote.id})` : '';
    colorConsole.log(`        ${statusColors.renamed('renamed:  ')}   ${typeLabel} ${localeLabel} ${colorConsole.gray(op.oldSlug || 'unknown')} -> ${colorConsole.highlight(op.local.slug)} ${colorConsole.gray(idLabel)}`);
  }
  for (const op of typeChanges) {
    const typeLabel = (op.local.type || 'unknown').padEnd(12);
    const localeLabel = `[${op.local.locale || 'unknown'}]`.padEnd(6);
    const idLabel = op.remote?.id ? `(ID: ${op.remote.id})` : '';
    const typeChangeLabel = `(${colorConsole.gray(op.oldType || 'unknown')} -> ${colorConsole.highlight(op.newType || 'unknown')})`;
    colorConsole.log(`        ${statusColors.typeChange('type chg: ')}   ${typeLabel} ${localeLabel} ${colorConsole.highlight(op.local.slug)} ${typeChangeLabel} ${colorConsole.gray(idLabel)}`);
  }
  for (const op of conflicts) {
    renderContentLine(op, 'conflict: ', statusColors.conflict);
    colorConsole.log(`                    ${colorConsole.gray(op.reason || 'Unknown conflict')}`);
  }
  for (const op of deletes) renderContentLine(op, 'deleted:  ', statusColors.conflict);

  return changeCount;
}

// ── Media rendering ──────────────────────────────────────────────────────────

function renderMediaSection(result: MediaStatusResult): number {
  const creates = result.operations.filter(op => op.type === 'create');
  const updates = result.operations.filter(op => op.type === 'update');
  const deletes = showDelete ? result.operations.filter(op => op.type === 'delete') : [];

  const changeCount = creates.length + updates.length + deletes.length;

  for (const op of creates) {
    const sizeKB = (op.local!.size / 1024).toFixed(2);
    colorConsole.log(`        ${statusColors.created('new:      ')}   ${op.local!.scopeUid}/${colorConsole.highlight(op.local!.name)} ${colorConsole.gray(`(${sizeKB}KB)`)}`);
  }
  for (const op of updates) {
    const sizeKB = (op.local!.size / 1024).toFixed(2);
    colorConsole.log(`        ${statusColors.modified('modified: ')}   ${op.local!.scopeUid}/${colorConsole.highlight(op.local!.name)} ${colorConsole.gray(`(${sizeKB}KB)`)}`);
    if (op.reason) {
      colorConsole.log(`                    ${colorConsole.gray(op.reason)}`);
    }
  }
  for (const op of deletes) {
    colorConsole.log(`        ${statusColors.conflict('deleted:  ')}   ${op.remote!.scopeUid}/${colorConsole.highlight(op.remote!.name)}`);
  }

  return changeCount;
}

// ── Comment rendering ────────────────────────────────────────────────────────

function renderCommentSection(operations: CommentOperation[]): number {
  const creates = operations.filter(op => op.type === 'create');
  const updates = operations.filter(op => op.type === 'update');
  const conflicts = operations.filter(op => op.type === 'conflict');
  const deletes = showDelete ? operations.filter(op => op.type === 'delete') : [];

  const changeCount = creates.length + updates.length + conflicts.length + deletes.length;

  for (const op of creates) {
    const comment = op.local?.comment;
    const label = `${comment?.commentableType || 'Unknown'}#${comment?.commentableId || '?'} [${comment?.language || defaultLanguage}]`;
    colorConsole.log(`        ${statusColors.created('new:      ')}   ${label} ${colorConsole.highlight(comment?.body?.slice(0, 48) || 'New comment')}`);
  }
  for (const op of updates) {
    const comment = op.local?.comment || op.remote;
    const label = `${comment?.commentableType || 'Unknown'}#${comment?.commentableId || '?'} [${comment?.language || defaultLanguage}]`;
    colorConsole.log(`        ${statusColors.modified('modified: ')}   ${label} ${colorConsole.gray(`(ID: ${op.remote?.id || comment?.id || 'unknown'})`)}`);
  }
  for (const op of conflicts) {
    const comment = op.local?.comment || op.remote;
    const label = `${comment?.commentableType || 'Unknown'}#${comment?.commentableId || '?'} [${comment?.language || defaultLanguage}]`;
    colorConsole.log(`        ${statusColors.conflict('conflict: ')}   ${label} ${colorConsole.gray(`(ID: ${op.remote?.id || comment?.id || 'unknown'})`)}`);
    if (op.reason) {
      colorConsole.log(`                    ${colorConsole.gray(op.reason)}`);
    }
  }
  for (const op of deletes) {
    const comment = op.remote;
    const label = `${comment?.commentableType || 'Unknown'}#${comment?.commentableId || '?'} [${comment?.language || defaultLanguage}]`;
    colorConsole.log(`        ${statusColors.conflict('deleted:  ')}   ${label} ${colorConsole.gray(`(ID: ${comment?.id || 'unknown'})`)}`);
  }

  return changeCount;
}

// ── Email template rendering ─────────────────────────────────────────────────

function renderEmailTemplateSection(operations: EmailTemplateOperation[]): number {
  const creates = operations.filter(op => op.type === 'create');
  const updates = operations.filter(op => op.type === 'update');
  const conflicts = operations.filter(op => op.type === 'conflict');
  const deletes = showDelete ? operations.filter(op => op.type === 'delete') : [];

  const changeCount = creates.length + updates.length + conflicts.length + deletes.length;

  for (const op of creates) {
    const groupLabel = (op.local?.groupFolder || 'ungrouped').padEnd(12);
    const localeLabel = `[${op.local?.locale || defaultLanguage}]`.padEnd(6);
    const nameLabel = op.local?.metadata?.name || 'unknown';
    colorConsole.log(`        ${statusColors.created('new:      ')}   ${groupLabel} ${localeLabel} ${colorConsole.highlight(nameLabel)}`);
  }
  for (const op of updates) {
    const groupLabel = (op.local?.groupFolder || 'ungrouped').padEnd(12);
    const localeLabel = `[${op.local?.locale || defaultLanguage}]`.padEnd(6);
    const nameLabel = op.local?.metadata?.name || op.remote?.name || 'unknown';
    const idLabel = op.remote?.id ? `(ID: ${op.remote.id})` : '';
    colorConsole.log(`        ${statusColors.modified('modified: ')}   ${groupLabel} ${localeLabel} ${colorConsole.highlight(nameLabel)} ${colorConsole.gray(idLabel)}`);
  }
  for (const op of conflicts) {
    const groupLabel = (op.local?.groupFolder || 'ungrouped').padEnd(12);
    const localeLabel = `[${op.local?.locale || op.remote?.language || defaultLanguage}]`.padEnd(6);
    const nameLabel = op.local?.metadata?.name || op.remote?.name || 'unknown';
    const reason = op.reason ? `(${op.reason})` : '';
    colorConsole.log(`        ${statusColors.conflict('conflict: ')}   ${groupLabel} ${localeLabel} ${colorConsole.highlight(nameLabel)} ${colorConsole.gray(reason)}`);
  }
  for (const op of deletes) {
    const groupLabel = getRemoteGroupLabel(op.remote || {}).padEnd(12);
    const localeLabel = `[${op.remote?.language || defaultLanguage}]`.padEnd(6);
    const nameLabel = op.remote?.name || 'unknown';
    const idLabel = op.remote?.id ? `(ID: ${op.remote.id})` : '';
    colorConsole.log(`        ${statusColors.conflict('deleted:  ')}   ${groupLabel} ${localeLabel} ${colorConsole.highlight(nameLabel)} ${colorConsole.gray(idLabel)}`);
  }

  return changeCount;
}

// ── Segment rendering ────────────────────────────────────────────────────────

function renderSegmentSection(operations: SegmentOperation[]): number {
  const creates = operations.filter(op => op.type === 'create');
  const updates = operations.filter(op => op.type === 'update');
  const conflicts = operations.filter(op => op.type === 'conflict');
  const deletes = showDelete ? operations.filter(op => op.type === 'delete') : [];

  const changeCount = creates.length + updates.length + conflicts.length + deletes.length;

  for (const op of creates) {
    const nameLabel = op.local?.name || 'unknown';
    colorConsole.log(`        ${statusColors.created('new:      ')}   ${colorConsole.highlight(nameLabel)}`);
  }
  for (const op of updates) {
    const nameLabel = op.local?.name || op.remote?.name || 'unknown';
    const idLabel = op.remote?.id ? `(ID: ${op.remote.id})` : '';
    colorConsole.log(`        ${statusColors.modified('modified: ')}   ${colorConsole.highlight(nameLabel)} ${colorConsole.gray(idLabel)}`);
  }
  for (const op of conflicts) {
    const nameLabel = op.local?.name || op.remote?.name || 'unknown';
    const idLabel = op.remote?.id ? `(ID: ${op.remote.id})` : '';
    colorConsole.log(`        ${statusColors.conflict('conflict: ')}   ${colorConsole.highlight(nameLabel)} ${colorConsole.gray(idLabel)}`);
    if (op.reason) colorConsole.log(`                    ${colorConsole.gray(op.reason)}`);
  }
  for (const op of deletes) {
    const nameLabel = op.remote?.name || 'unknown';
    const idLabel = op.remote?.id ? `(ID: ${op.remote.id})` : '';
    colorConsole.log(`        ${statusColors.conflict('deleted:  ')}   ${colorConsole.highlight(nameLabel)} ${colorConsole.gray(idLabel)}`);
  }

  return changeCount;
}

// ── Sequence rendering ───────────────────────────────────────────────────────

function renderSequenceSection(operations: SequenceOperation[]): number {
  const creates = operations.filter(op => op.type === 'create');
  const updates = operations.filter(op => op.type === 'update');
  const conflicts = operations.filter(op => op.type === 'conflict');
  const deletes = showDelete ? operations.filter(op => op.type === 'delete') : [];

  const changeCount = creates.length + updates.length + conflicts.length + deletes.length;

  for (const op of creates) {
    const nameLabel = op.local?.name || 'unknown';
    colorConsole.log(`        ${statusColors.created('new:      ')}   ${colorConsole.highlight(nameLabel)}`);
  }
  for (const op of updates) {
    const nameLabel = op.local?.name || op.remote?.name || 'unknown';
    const idLabel = op.remote?.id ? `(ID: ${op.remote.id})` : '';
    colorConsole.log(`        ${statusColors.modified('modified: ')}   ${colorConsole.highlight(nameLabel)} ${colorConsole.gray(idLabel)}`);
  }
  for (const op of conflicts) {
    const nameLabel = op.local?.name || op.remote?.name || 'unknown';
    const idLabel = op.remote?.id ? `(ID: ${op.remote.id})` : '';
    colorConsole.log(`        ${statusColors.conflict('conflict: ')}   ${colorConsole.highlight(nameLabel)} ${colorConsole.gray(idLabel)}`);
    if (op.reason) colorConsole.log(`                    ${colorConsole.gray(op.reason)}`);
  }
  for (const op of deletes) {
    const nameLabel = op.remote?.name || 'unknown';
    const idLabel = op.remote?.id ? `(ID: ${op.remote.id})` : '';
    colorConsole.log(`        ${statusColors.conflict('deleted:  ')}   ${colorConsole.highlight(nameLabel)} ${colorConsole.gray(idLabel)}`);
  }

  return changeCount;
}

// ── Summary helper ───────────────────────────────────────────────────────────

function renderSummaryLine(label: string, counts: { creates: number; updates: number; renames?: number; typeChanges?: number; conflicts: number; deletes: number; skips?: number }): string {
  const parts: string[] = [];
  if (counts.creates > 0) parts.push(`${counts.creates} new`);
  if (counts.updates > 0) parts.push(`${counts.updates} modified`);
  if (counts.renames && counts.renames > 0) parts.push(`${counts.renames} renamed`);
  if (counts.typeChanges && counts.typeChanges > 0) parts.push(`${counts.typeChanges} type changed`);
  if (counts.conflicts > 0) parts.push(`${counts.conflicts} conflict${counts.conflicts > 1 ? 's' : ''}`);
  if (counts.deletes > 0) parts.push(`${counts.deletes} to delete`);
  if (counts.skips && counts.skips > 0) parts.push(`${counts.skips} up to date`);

  if (parts.length === 0) return `   ${label} up to date`;
  return `   ${label} ${parts.join(', ')}`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function statusAll() {
  try {
    await resolveIdentity();
    const canCheckEmailTemplates = Boolean(leadCMSApiKey);

    // Show spinner while fetching data from all sources
    const spinner = startSpinner('Fetching status from LeadCMS…');

    let contentResult: ContentStatusResult | null = null;
    let commentResult: CommentStatusResult | null = null;
    let mediaResult: MediaStatusResult | null = null;
    let emailResult: EmailTemplateStatusResult | null = null;
    let settingsResult: SettingsStatusResult | null = null;
    let segmentResult: SegmentStatusResult | null = null;
    let sequenceResult: SequenceStatusResult | null = null;

    try {
      [contentResult, commentResult, mediaResult, emailResult, settingsResult, segmentResult, sequenceResult] = await Promise.all([
        getContentStatusData({ showDelete, remoteContext }).catch((err: any) => {
          spinner.update('Fetching status… (content failed)');
          return null;
        }),
        buildCommentStatus({ showDelete, remoteContext }).catch((err: any) => {
          spinner.update('Fetching status… (comments failed)');
          return null;
        }),
        statusMedia({ scopeUid, showDelete, silent: true }).catch((err: any) => {
          spinner.update('Fetching status… (media failed)');
          return null;
        }),
        canCheckEmailTemplates
          ? buildEmailTemplateStatus({ showDelete, remoteContext }).catch((err: any) => {
            spinner.update('Fetching status… (email templates failed)');
            return null;
          })
          : Promise.resolve(null),
        canCheckEmailTemplates
          ? getSettingsStatusData().catch((err: any) => {
            spinner.update('Fetching status… (settings failed)');
            return null;
          })
          : Promise.resolve(null),
        canCheckEmailTemplates
          ? buildSegmentStatus({ showDelete, remoteContext }).catch((err: any) => {
            spinner.update('Fetching status… (segments failed)');
            return null;
          })
          : Promise.resolve(null),
        canCheckEmailTemplates
          ? buildSequenceStatus({ showDelete, remoteContext }).catch((err: any) => {
            spinner.update('Fetching status… (sequences failed)');
            return null;
          })
          : Promise.resolve(null),
      ]);
      spinner.stop();
    } catch (err) {
      spinner.fail('Failed to fetch status');
      throw err;
    }

    colorConsole.important('\n📊 LeadCMS Status');
    console.log('─'.repeat(80));

    const contentOps = contentResult?.operations ?? null;
    const commentOps = commentResult?.operations ?? null;
    const emailOps = emailResult?.operations ?? null;
    const segmentOps = segmentResult?.operations ?? null;
    const sequenceOps = sequenceResult?.operations ?? null;

    // Count changes per section
    const contentChanges = contentOps
      ? contentOps.create.length + contentOps.update.length + contentOps.rename.length +
      contentOps.typeChange.length + contentOps.conflict.length +
      (showDelete ? contentOps.delete.length : 0)
      : 0;

    const mediaChanges = mediaResult
      ? mediaResult.summary.creates + mediaResult.summary.updates +
      (showDelete ? mediaResult.summary.deletes : 0)
      : 0;

    const commentChanges = commentOps
      ? commentOps.filter(op => showDelete ? true : op.type !== 'delete').length
      : 0;

    const emailChanges = emailOps
      ? emailOps.filter(op => showDelete ? true : op.type !== 'delete').length
      : 0;

    const settingsChanges = settingsResult
      ? settingsResult.comparisons.filter(c => c.status !== 'in-sync').length
      : 0;

    const segmentChanges = segmentOps
      ? segmentOps.filter(op => showDelete ? true : op.type !== 'delete').length
      : 0;

    const sequenceChanges = sequenceOps
      ? sequenceOps.filter(op => showDelete ? true : op.type !== 'delete').length
      : 0;

    // Count up-to-date items per section
    const contentSkips = contentResult
      ? contentResult.totalLocal - contentChanges
      : 0;

    const mediaSkips = mediaResult
      ? mediaResult.summary.skips
      : 0;

    const commentSkips = commentResult
      ? commentResult.totalLocal - commentChanges
      : 0;

    const emailSkips = emailResult
      ? emailResult.totalLocal - emailChanges
      : 0;

    const settingsInSync = settingsResult
      ? settingsResult.comparisons.filter(c => c.status === 'in-sync').length
      : 0;

    const segmentSkips = segmentResult
      ? segmentResult.totalLocal - segmentChanges
      : 0;

    const sequenceSkips = sequenceResult
      ? sequenceResult.totalLocal - sequenceChanges
      : 0;

    const totalChanges = contentChanges + commentChanges + mediaChanges + emailChanges + settingsChanges + segmentChanges + sequenceChanges;

    if (totalChanges === 0) {
      colorConsole.success('\n✅ Everything is in sync!\n');

      if (contentResult) console.log(`   📝 Content:          ${contentSkips > 0 ? `${contentSkips} item(s) ` : ''}up to date`);
      if (commentResult) console.log(`   💬 Comments:         ${commentSkips > 0 ? `${commentSkips} item(s) ` : ''}up to date`);
      if (mediaResult) console.log(`   📷 Media:            ${mediaSkips > 0 ? `${mediaSkips} file(s) ` : ''}up to date`);
      if (canCheckEmailTemplates && emailResult) {
        console.log(`   📧 Email Templates:  ${emailSkips > 0 ? `${emailSkips} item(s) ` : ''}up to date`);
      }
      if (canCheckEmailTemplates && settingsResult) {
        console.log(`   ⚙️  Settings:         ${settingsInSync > 0 ? `${settingsInSync} setting(s) ` : ''}up to date`);
      }
      if (canCheckEmailTemplates && segmentResult) {
        console.log(`   🔖 Segments:         ${segmentSkips > 0 ? `${segmentSkips} item(s) ` : ''}up to date`);
      }
      if (canCheckEmailTemplates && sequenceResult) {
        console.log(`   🔗 Sequences:        ${sequenceSkips > 0 ? `${sequenceSkips} item(s) ` : ''}up to date`);
      }
      console.log('');
      process.exit(0);
    }

    console.log('');

    // ── Content section ──
    if (contentOps && contentChanges > 0) {
      colorConsole.important(`  📝 Content (${contentChanges} change${contentChanges !== 1 ? 's' : ''}):`);
      renderContentSection(contentOps);
      console.log('');
    }

    if (commentOps && commentChanges > 0) {
      colorConsole.important(`  💬 Comments (${commentChanges} change${commentChanges !== 1 ? 's' : ''}):`);
      renderCommentSection(commentOps);
      console.log('');
    }

    // ── Media section ──
    if (mediaResult && mediaChanges > 0) {
      colorConsole.important(`  📷 Media (${mediaChanges} change${mediaChanges !== 1 ? 's' : ''}):`);
      renderMediaSection(mediaResult);
      console.log('');
    }

    // ── Email Templates section ──
    if (emailOps && emailChanges > 0) {
      colorConsole.important(`  📧 Email Templates (${emailChanges} change${emailChanges !== 1 ? 's' : ''}):`);
      renderEmailTemplateSection(emailOps);
      console.log('');
    }

    // ── Settings section ──
    if (settingsResult && settingsChanges > 0) {
      colorConsole.important(`  ⚙️  Settings (${settingsChanges} change${settingsChanges !== 1 ? 's' : ''}):`);
      for (const entry of settingsResult.comparisons) {
        if (entry.status === 'in-sync') continue;
        const lang = entry.language ? ` [${entry.language}]` : '';
        const label = `${entry.key}${lang}`;
        switch (entry.status) {
          case 'modified':
            colorConsole.log(`        ${statusColors.modified('modified: ')}   ${colorConsole.highlight(label)} ${colorConsole.gray(formatSettingDiff(entry.key, entry.remoteValue, entry.localValue))}`);
            renderSettingDiffPreview(entry.key, entry.remoteValue, entry.localValue, '                      ');
            break;
          case 'local-only':
            colorConsole.log(`        ${statusColors.created('new:      ')}   ${colorConsole.highlight(label)} ${colorConsole.gray(`= ${formatSettingValue(entry.key, entry.localValue)}`)}`);
            break;
          case 'remote-only':
            colorConsole.log(`        ${statusColors.conflict('remote:   ')}   ${colorConsole.highlight(label)} ${colorConsole.gray(`= ${formatSettingValue(entry.key, entry.remoteValue)}`)}`);
            break;
        }
      }
      console.log('');
    }

    // ── Segments section ──
    if (segmentOps && segmentChanges > 0) {
      colorConsole.important(`  🔖 Segments (${segmentChanges} change${segmentChanges !== 1 ? 's' : ''}):`);
      renderSegmentSection(segmentOps);
      console.log('');
    }

    // ── Sequences section ──
    if (sequenceOps && sequenceChanges > 0) {
      colorConsole.important(`  🔗 Sequences (${sequenceChanges} change${sequenceChanges !== 1 ? 's' : ''}):`);
      renderSequenceSection(sequenceOps);
      console.log('');
    }

    // ── Summary ──
    console.log('─'.repeat(80));

    if (contentOps) {
      console.log(renderSummaryLine('📝 Content:         ', {
        creates: contentOps.create.length,
        updates: contentOps.update.length,
        renames: contentOps.rename.length,
        typeChanges: contentOps.typeChange.length,
        conflicts: contentOps.conflict.length,
        deletes: showDelete ? contentOps.delete.length : 0,
        skips: contentSkips,
      }));
    }

    if (commentOps) {
      console.log(renderSummaryLine('💬 Comments:        ', {
        creates: commentOps.filter(op => op.type === 'create').length,
        updates: commentOps.filter(op => op.type === 'update').length,
        conflicts: commentOps.filter(op => op.type === 'conflict').length,
        deletes: showDelete ? commentOps.filter(op => op.type === 'delete').length : 0,
        skips: commentSkips,
      }));
    }

    if (mediaResult) {
      console.log(renderSummaryLine('📷 Media:           ', {
        creates: mediaResult.summary.creates,
        updates: mediaResult.summary.updates,
        conflicts: 0,
        deletes: showDelete ? mediaResult.summary.deletes : 0,
        skips: mediaSkips,
      }));
    }

    if (canCheckEmailTemplates && emailOps) {
      const counts = emailOps.reduce(
        (acc, op) => { acc[op.type] = (acc[op.type] || 0) + 1; return acc; },
        {} as Record<string, number>,
      );
      console.log(renderSummaryLine('📧 Email Templates: ', {
        creates: counts.create || 0,
        updates: counts.update || 0,
        conflicts: counts.conflict || 0,
        deletes: showDelete ? (counts.delete || 0) : 0,
        skips: emailSkips,
      }));
    }

    if (canCheckEmailTemplates && settingsResult) {
      const modified = settingsResult.comparisons.filter(c => c.status === 'modified').length;
      const localOnly = settingsResult.comparisons.filter(c => c.status === 'local-only').length;
      const remoteOnly = settingsResult.comparisons.filter(c => c.status === 'remote-only').length;
      console.log(renderSummaryLine('⚙️  Settings:        ', {
        creates: localOnly,
        updates: modified,
        conflicts: remoteOnly,
        deletes: 0,
        skips: settingsInSync,
      }));
    }

    if (canCheckEmailTemplates && segmentOps) {
      const counts = segmentOps.reduce(
        (acc, op) => { acc[op.type] = (acc[op.type] || 0) + 1; return acc; },
        {} as Record<string, number>,
      );
      console.log(renderSummaryLine('🔖 Segments:        ', {
        creates: counts.create || 0,
        updates: counts.update || 0,
        conflicts: counts.conflict || 0,
        deletes: showDelete ? (counts.delete || 0) : 0,
        skips: segmentSkips,
      }));
    }

    if (canCheckEmailTemplates && sequenceOps) {
      const counts = sequenceOps.reduce(
        (acc, op) => { acc[op.type] = (acc[op.type] || 0) + 1; return acc; },
        {} as Record<string, number>,
      );
      console.log(renderSummaryLine('🔗 Sequences:       ', {
        creates: counts.create || 0,
        updates: counts.update || 0,
        conflicts: counts.conflict || 0,
        deletes: showDelete ? (counts.delete || 0) : 0,
        skips: sequenceSkips,
      }));
    }

    console.log('');
    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ Status check failed:', error.message);
    process.exit(1);
  }
}

statusAll();
