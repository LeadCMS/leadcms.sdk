import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import readline from "readline";
import matter from "gray-matter";
import * as Diff from "diff";
import {
  defaultLanguage,
  CONTENT_DIR,
  ContentItem as BaseContentItem,
} from "./leadcms-helpers.js";
import { leadCMSDataService, ContentItem } from "../lib/data-service.js";
import {
  transformRemoteToLocalFormat,
  transformRemoteForComparison,
  hasContentDifferences,
  type ContentTypeMap
} from "../lib/content-transformation.js";
import { colorConsole, statusColors, diffColors } from '../lib/console-colors.js';

// Extended interfaces for local operations
interface LocalContentItem extends BaseContentItem {
  filePath: string;
  locale: string;
  metadata: Record<string, any>;
  isLocal: boolean;
}

interface RemoteContentItem extends ContentItem {
  isLocal: false;
}

interface MatchOperation {
  local: LocalContentItem;
  remote?: RemoteContentItem;
  reason?: string;
  oldSlug?: string; // For renamed content
  oldType?: string; // For type changes
  newType?: string; // For type changes
}

interface ContentOperations {
  create: MatchOperation[];
  update: MatchOperation[];
  rename: MatchOperation[]; // Slug changed but same content
  typeChange: MatchOperation[]; // Content type changed
  conflict: MatchOperation[];
}

interface PushOptions {
  statusOnly?: boolean;
  force?: boolean;
  targetId?: string;      // Target specific content by ID
  targetSlug?: string;    // Target specific content by slug
  showDetailedPreview?: boolean;  // Show detailed diff preview for all files
  dryRun?: boolean;       // Show API calls without executing them
}

interface ExecutionOptions {
  force?: boolean;
}

// Create readline interface for user prompts
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Promisify readline question
function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

/**
 * Check if a directory is a locale directory
 * Only immediate children of CONTENT_DIR with 2-5 letter language codes are considered locales
 */
async function isLocaleDirectory(dirPath: string, parentDir: string): Promise<boolean> {
  try {
    // Only consider directories that are immediate children of CONTENT_DIR
    if (parentDir !== CONTENT_DIR) {
      return false;
    }

    const dirName = path.basename(dirPath);

    // Check if it matches language code pattern (2-5 letters, optionally with region codes)
    // Examples: en, da, ru, en-US, pt-BR, zh-CN
    const isLanguageCode = /^[a-z]{2}(-[A-Z]{2})?$/.test(dirName);

    return isLanguageCode;
  } catch {
    return false;
  }
}/**
 * Read and parse all local content files
 */
async function readLocalContent(): Promise<LocalContentItem[]> {
  console.log(`[LOCAL] Reading content from: ${CONTENT_DIR}`);
  const localContent: LocalContentItem[] = [];

  async function walkDirectory(dir: string, locale: string = defaultLanguage, baseContentDir: string = CONTENT_DIR): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // Check if this is a locale directory (only immediate children of content dir)
          if (entry.name !== defaultLanguage && await isLocaleDirectory(fullPath, dir)) {
            // This is a language directory
            await walkDirectory(fullPath, entry.name, fullPath);
          } else {
            // Regular directory, keep current locale and baseContentDir
            await walkDirectory(fullPath, locale, baseContentDir);
          }
        } else if (entry.isFile() && (entry.name.endsWith('.mdx') || entry.name.endsWith('.json'))) {
          try {
            const content = await parseContentFile(fullPath, locale, baseContentDir);
            if (content) {
              localContent.push(content);
            }
          } catch (error: any) {
            console.warn(`[LOCAL] Failed to parse ${fullPath}:`, error.message);
          }
        }
      }
    } catch (error: any) {
      console.warn(`[LOCAL] Failed to read directory ${dir}:`, error.message);
    }
  }

  await walkDirectory(CONTENT_DIR);
  console.log(`[LOCAL] Found ${localContent.length} local content files`);
  return localContent;
}

/**
 * Parse a single content file (MDX or JSON)
 */
async function parseContentFile(filePath: string, locale: string, baseContentDir: string = CONTENT_DIR): Promise<LocalContentItem | null> {
  const fileContent = await fs.readFile(filePath, 'utf-8');
  const ext = path.extname(filePath);
  const basename = path.basename(filePath, ext);

  let metadata: Record<string, any>;
  let body = '';

  if (ext === '.mdx') {
    const parsed = matter(fileContent);
    metadata = parsed.data;
    body = parsed.content.trim();
  } else if (ext === '.json') {
    const jsonData = JSON.parse(fileContent);
    body = jsonData.body || '';
    metadata = { ...jsonData };
    delete metadata.body;
  } else {
    return null;
  }

  // Calculate slug from relative path within the content directory
  // This includes subdirectories like blog/, docs/, legal/ as part of the slug
  const relativePath = path.relative(baseContentDir, filePath);
  const relativeDir = path.dirname(relativePath);

  let slug: string;
  if (relativeDir === '.' || relativeDir === '') {
    // File is directly in the content/locale directory
    slug = basename;
  } else {
    // File is in a subdirectory, include the path
    slug = path.join(relativeDir, basename).replace(/\\/g, '/'); // Normalize to forward slashes
  }

  return {
    filePath,
    slug,
    locale,
    type: metadata.type,
    metadata,
    body,
    isLocal: true
  };
}

/**
 * Get all unique content types from local content
 */
function getLocalContentTypes(localContent: LocalContentItem[]): Set<string> {
  const types = new Set<string>();
  for (const content of localContent) {
    if (content.type) {
      types.add(content.type);
    }
  }
  return types;
}

/**
 * Fetch all remote content using sync API without token (full fetch)
 */
async function fetchRemoteContent(): Promise<RemoteContentItem[]> {
  const allItems = await leadCMSDataService.getAllContent();

  // Ensure we have an array
  if (!Array.isArray(allItems)) {
    console.warn(`[${leadCMSDataService.isMockMode() ? 'MOCK' : 'REMOTE'}] Retrieved invalid data (not an array):`, typeof allItems);
    return [];
  }

  console.log(`[${leadCMSDataService.isMockMode() ? 'MOCK' : 'REMOTE'}] Retrieved ${allItems.length} content items`);

  return allItems.map(item => ({ ...item, isLocal: false })) as RemoteContentItem[];
}



/**
 * Compare local and remote content by transforming remote to local format
 * Returns true if there are meaningful differences in content
 * This new approach compares normalized file content directly instead of parsed objects
 */
async function hasActualContentChanges(local: LocalContentItem, remote: RemoteContentItem, typeMap?: Record<string, string>): Promise<boolean> {
  try {
    // Read the local file content as-is
    const localFileContent = await fs.readFile(local.filePath, 'utf-8');

    // Transform remote content for comparison, only including fields that exist in local content
    // This prevents false positives when remote has additional fields like updatedAt
    const transformedRemoteContent = await transformRemoteForComparison(remote, localFileContent, typeMap as ContentTypeMap);

    // Compare the raw file contents using shared normalization logic
    const hasFileContentChanges = hasContentDifferences(localFileContent, transformedRemoteContent);

    return hasFileContentChanges;
  } catch (error: any) {
    console.warn(`[COMPARE] Failed to compare content for ${local.slug}:`, error.message);
    // Fallback to true to err on the side of showing changes
    return true;
  }
}

/**
 * Match local content with remote content
 */
async function matchContent(localContent: LocalContentItem[], remoteContent: RemoteContentItem[], typeMap?: Record<string, string>): Promise<ContentOperations> {

  const operations: ContentOperations = {
    create: [],
    update: [],
    rename: [],
    typeChange: [],
    conflict: []
  };

  for (const local of localContent) {
    let match: RemoteContentItem | undefined = undefined;

    // First try to match by ID if local content has one
    if (local.metadata.id) {
      match = remoteContent.find(remote => remote.id === local.metadata.id);
    }

    // If no ID match, try to match by current filename slug and locale
    if (!match) {
      match = remoteContent.find(remote =>
        remote.slug === local.slug &&
        (remote.language || defaultLanguage) === local.locale
      );
    }

    // If still no match, try by the slug in metadata (could be old slug for renames)
    if (!match && local.metadata.slug && local.metadata.slug !== local.slug) {
      match = remoteContent.find(remote =>
        remote.slug === local.metadata.slug &&
        (remote.language || defaultLanguage) === local.locale
      );
    }

    // If still no match, try by title and locale (if title exists)
    if (!match && local.metadata.title) {
      match = remoteContent.find(remote =>
        remote.title === local.metadata.title &&
        (remote.language || defaultLanguage) === local.locale
      );
    }

    if (match) {
      // Check for conflicts by comparing updatedAt timestamps from content metadata
      const localUpdated = local.metadata.updatedAt ? new Date(local.metadata.updatedAt) : new Date(0);
      const remoteUpdated = match.updatedAt ? new Date(match.updatedAt) : new Date(0);

      // Detect different types of changes
      const slugChanged = match.slug !== local.slug;
      const typeChanged = match.type !== local.type;

      if (remoteUpdated > localUpdated) {
        let conflictReason = 'Remote content was updated after local content';
        if (slugChanged && typeChanged) {
          conflictReason = 'Both slug and content type changed remotely';
        } else if (slugChanged) {
          conflictReason = 'Slug changed remotely after local changes';
        } else if (typeChanged) {
          conflictReason = 'Content type changed remotely after local changes';
        }

        operations.conflict.push({
          local,
          remote: match,
          reason: conflictReason
        });
      } else if (slugChanged && typeChanged) {
        // Both slug and type changed - this is a complex update
        operations.typeChange.push({
          local,
          remote: match,
          oldSlug: match.slug,
          oldType: match.type,
          newType: local.type
        });
      } else if (slugChanged) {
        // Slug changed - this is a rename
        operations.rename.push({
          local,
          remote: match,
          oldSlug: match.slug
        });
      } else if (typeChanged) {
        // Content type changed
        operations.typeChange.push({
          local,
          remote: match,
          oldType: match.type,
          newType: local.type
        });
      } else {
        // Check if content actually changed by comparing all fields
        const hasContentChanges = await hasActualContentChanges(local, match, typeMap);

        if (hasContentChanges) {
          // Regular update - content modified but slug and type same
          operations.update.push({
            local,
            remote: match
          });
        }
        // If no content changes, don't add to any operation (content is in sync)
      }
    } else {
      // No match found, this is a new content item
      operations.create.push({
        local
      });
    }
  }

  return operations;
}

/**
 * Validate that all required content types exist remotely
 */
async function validateContentTypes(localTypes: Set<string>, remoteTypeMap: Record<string, string>, dryRun: boolean = false): Promise<void> {
  const missingTypes: string[] = [];

  for (const type of localTypes) {
    if (!remoteTypeMap[type]) {
      missingTypes.push(type);
    }
  }

  if (missingTypes.length > 0) {
    colorConsole.error(`\n❌ Missing content types in remote LeadCMS: ${colorConsole.highlight(missingTypes.join(', '))}`);
    colorConsole.warn(`\nYou need to create these content types in your LeadCMS instance before pushing content.`);

    if (dryRun) {
      colorConsole.info('\n🧪 In dry run mode - showing what content type creation would look like:');
      for (const type of missingTypes) {
        colorConsole.progress(`\n📋 CREATE CONTENT TYPE (Dry Run):`);
        colorConsole.log(`\n${colorConsole.cyan('POST')} ${colorConsole.highlight('/api/content-types')}`);
        colorConsole.log(`${colorConsole.gray('Content-Type:')} application/json`);
        colorConsole.log(`\n${colorConsole.gray('Request Body:')}`);
        const sampleContentTypeData = {
          uid: type,
          name: type.charAt(0).toUpperCase() + type.slice(1),
          format: 'MDX',
          supportsCoverImage: false,
          supportsComments: false
        };
        colorConsole.log(JSON.stringify(sampleContentTypeData, null, 2));
        colorConsole.success(`✅ Would create content type: ${colorConsole.highlight(type)}`);
      }
      return; // Skip interactive creation in dry run mode
    }

    const createChoice = await question('\nWould you like me to create these content types automatically? (y/N): ');

    if (createChoice.toLowerCase() === 'y' || createChoice.toLowerCase() === 'yes') {
      for (const type of missingTypes) {
        await createContentTypeInteractive(type, dryRun);
      }
    } else {
      colorConsole.info('\nPlease create the missing content types manually in your LeadCMS instance and try again.');
      process.exit(1);
    }
  }
}

/**
 * Create a content type in remote LeadCMS
 */
async function createContentTypeInteractive(typeName: string, dryRun: boolean = false): Promise<void> {
  colorConsole.progress(`\n📝 Creating content type: ${colorConsole.highlight(typeName)}`);

  const format = await question(`What format should '${colorConsole.highlight(typeName)}' use? (MDX/JSON) [MDX]: `) || 'MDX';
  const supportsCoverImage = await question(`Should '${colorConsole.highlight(typeName)}' support cover images? (y/N): `);
  const supportsComments = await question(`Should '${colorConsole.highlight(typeName)}' support comments? (y/N): `);

  const contentTypeData = {
    uid: typeName,
    name: typeName.charAt(0).toUpperCase() + typeName.slice(1),
    format: format.toUpperCase(),
    supportsCoverImage: supportsCoverImage.toLowerCase() === 'y',
    supportsComments: supportsComments.toLowerCase() === 'y'
  };

  if (dryRun) {
    colorConsole.progress(`\n📋 CREATE CONTENT TYPE (Dry Run):`);
    colorConsole.log(`\n${colorConsole.cyan('POST')} ${colorConsole.highlight('/api/content-types')}`);
    colorConsole.log(`${colorConsole.gray('Content-Type:')} application/json`);
    colorConsole.log(`\n${colorConsole.gray('Request Body:')}`);
    colorConsole.log(JSON.stringify(contentTypeData, null, 2));
    colorConsole.success(`✅ Would create content type: ${colorConsole.highlight(typeName)}`);
  } else {
    try {
      await leadCMSDataService.createContentType(contentTypeData);
      colorConsole.success(`✅ Created content type: ${colorConsole.highlight(typeName)}`);
    } catch (error: any) {
      colorConsole.error(`❌ Failed to create content type '${colorConsole.highlight(typeName)}':`, error.message);
      throw error;
    }
  }
}

/**
 * Filter content operations to only include specific content by ID or slug
 */
function filterContentOperations(operations: ContentOperations, targetId?: string, targetSlug?: string): ContentOperations {
  if (!targetId && !targetSlug) {
    return operations; // No filtering needed
  }

  const matchesTarget = (op: MatchOperation): boolean => {
    if (targetId) {
      // Check if local content has the target ID
      if (op.local.metadata.id?.toString() === targetId) return true;
      // Check if remote content has the target ID
      if (op.remote?.id?.toString() === targetId) return true;
    }

    if (targetSlug) {
      // Check if local content has the target slug
      if (op.local.slug === targetSlug) return true;
      // Check if remote content has the target slug
      if (op.remote?.slug === targetSlug) return true;
      // Check if this is a rename and the old slug matches
      if (op.oldSlug === targetSlug) return true;
    }

    return false;
  };

  return {
    create: operations.create.filter(matchesTarget),
    update: operations.update.filter(matchesTarget),
    rename: operations.rename.filter(matchesTarget),
    typeChange: operations.typeChange.filter(matchesTarget),
    conflict: operations.conflict.filter(matchesTarget)
  };
}

/**
 * Display detailed diff for a single content item
 */
async function displayDetailedDiff(operation: MatchOperation, operationType: string, typeMap?: Record<string, string>): Promise<void> {
  const { local, remote } = operation;

  console.log(`\n📄 Detailed Changes for: ${local.slug} [${local.locale}]`);
  console.log(`   Operation: ${operationType}`);
  console.log(`   Content Type: ${local.type}`);
  if (remote?.id) {
    console.log(`   Remote ID: ${remote.id}`);
  }
  console.log('');

  // Compare metadata fields
  console.log('📋 Metadata Changes:');

  const excludedFields = new Set(['id', 'createdAt', 'updatedAt', 'publishedAt', 'body', 'filePath', 'isLocal']);
  const allLocalFields = new Set(Object.keys(local.metadata));
  const allRemoteFields = new Set(remote ? Object.keys(remote) : []);
  const allFields = new Set([...allLocalFields, ...allRemoteFields]);

  let hasMetadataChanges = false;

  /**
   * Format a value for display, with pretty-printing for objects and arrays
   */
  function formatValue(value: any): string {
    if (value === null || value === undefined) {
      return String(value);
    }
    if (typeof value === 'object') {
      return JSON.stringify(value, null, 2).split('\n').map((line, index) =>
        index === 0 ? line : `     ${line}`
      ).join('\n');
    }
    return JSON.stringify(value);
  }

  for (const field of allFields) {
    if (excludedFields.has(field)) continue;

    const localValue = local.metadata[field];
    const remoteValue = remote?.[field];

    // Normalize values for comparison
    const normalizedLocal = localValue === undefined ? null : localValue;
    const normalizedRemote = remoteValue === undefined ? null : remoteValue;

    if (JSON.stringify(normalizedLocal) !== JSON.stringify(normalizedRemote)) {
      hasMetadataChanges = true;

      if (normalizedRemote === null) {
        colorConsole.log(`   ${diffColors.added(`+ ${field}: ${formatValue(normalizedLocal)} (added)`)}`);
      } else if (normalizedLocal === null) {
        colorConsole.log(`   ${diffColors.removed(`- ${field}: ${formatValue(normalizedRemote)} (removed)`)}`);
      } else {
        colorConsole.log(`   ${diffColors.modified(`~ ${field}: (changed)`)}`);
        colorConsole.log(`     ${diffColors.removed(`- ${formatValue(normalizedRemote)}`)}`);
        colorConsole.log(`     ${diffColors.added(`+ ${formatValue(normalizedLocal)}`)}`);
      }
    }
  }

  if (!hasMetadataChanges && remote) {
    console.log('   No metadata changes detected');
  } else if (!remote) {
    console.log('   New content - all metadata will be added');
  }

  // Compare content using the new transformation approach
  console.log('\n📝 Content Changes:');

  try {
    // Read local file content as-is
    const localFileContent = await fs.readFile(local.filePath, 'utf-8');

    // Transform remote content to local format for comparison
    const transformedRemoteContent = remote ? await transformRemoteToLocalFormat(remote, typeMap as ContentTypeMap) : '';

    if (localFileContent.trim() === transformedRemoteContent.trim()) {
      console.log('   No content changes detected');
    } else {
      // Use line-by-line diff for detailed comparison
      const diff = Diff.diffLines(transformedRemoteContent, localFileContent);

      let addedLines = 0;
      let removedLines = 0;
      let unchangedLines = 0;

      // Show diff preview and count changes
      colorConsole.info('   Content diff preview:');

      let previewLines = 0;
      const maxPreviewLines = 10;

      for (const part of diff) {
        // Count non-empty lines only for more accurate statistics
        const lines = part.value.split('\n').filter((line: string) => line.trim() !== '');

        if (part.added) {
          addedLines += lines.length;
          if (previewLines < maxPreviewLines) {
            for (const line of lines.slice(0, Math.min(lines.length, maxPreviewLines - previewLines))) {
              colorConsole.log(`   ${diffColors.added(`+ ${line}`)}`);
              previewLines++;
            }
          }
        } else if (part.removed) {
          removedLines += lines.length;
          if (previewLines < maxPreviewLines) {
            for (const line of lines.slice(0, Math.min(lines.length, maxPreviewLines - previewLines))) {
              colorConsole.log(`   ${diffColors.removed(`- ${line}`)}`);
              previewLines++;
            }
          }
        } else {
          unchangedLines += lines.length;
        }

        if (previewLines >= maxPreviewLines) break;
      }

      if (previewLines >= maxPreviewLines && (addedLines + removedLines > previewLines)) {
        colorConsole.gray(`   ... (${addedLines + removedLines - previewLines} more changes)`);
      }

      const summaryText = `\n   📊 Change Summary: ${colorConsole.green(`+${addedLines} lines added`)}, ${colorConsole.red(`-${removedLines} lines removed`)}, ${unchangedLines} lines unchanged`;
      colorConsole.log(summaryText);
    }
  } catch (error: any) {
    console.warn(`[DIFF] Failed to generate detailed diff for ${local.slug}:`, error.message);
    console.log('   Unable to show content comparison');
  }

  console.log('');
}

/**
 * Display status/preview of changes
 */
async function displayStatus(operations: ContentOperations, isStatusOnly: boolean = false, isSingleFile: boolean = false, showDetailedPreview: boolean = false, typeMap?: Record<string, string>): Promise<void> {
  if (isSingleFile) {
    colorConsole.important('\n📄 LeadCMS File Status');
  } else {
    colorConsole.important('\n📊 LeadCMS Status');
  }
  colorConsole.log('');

  // Summary line like git
  const totalChanges = operations.create.length + operations.update.length + operations.rename.length + operations.typeChange.length + operations.conflict.length;
  if (totalChanges === 0) {
    if (isSingleFile) {
      colorConsole.success('✅ File is in sync with remote content!');
    } else {
      colorConsole.success('✅ No changes detected. Everything is in sync!');
    }
    return;
  }

  // For single file mode, show detailed diff information
  if (isSingleFile) {
    // Show detailed diff for each operation
    for (const op of operations.create) {
      await displayDetailedDiff(op, 'New file', typeMap);
    }
    for (const op of operations.update) {
      await displayDetailedDiff(op, 'Modified', typeMap);
    }
    for (const op of operations.rename) {
      await displayDetailedDiff(op, `Renamed (${op.oldSlug} → ${op.local.slug})`, typeMap);
    }
    for (const op of operations.typeChange) {
      await displayDetailedDiff(op, `Type changed (${op.oldType} → ${op.newType})`, typeMap);
    }
    for (const op of operations.conflict) {
      await displayDetailedDiff(op, `Conflict: ${op.reason}`, typeMap);
    }
    return;
  }

  // Changes to be synced (like git's "Changes to be committed")
  if (operations.create.length > 0 || operations.update.length > 0 || operations.rename.length > 0 || operations.typeChange.length > 0) {
    const syncableChanges = operations.create.length + operations.update.length + operations.rename.length + operations.typeChange.length;
    console.log(`Changes to be synced (${syncableChanges} files):`);
    if (!isStatusOnly) {
      console.log('  (use "leadcms status" to see sync status)');
    }
    console.log('');

    // Helper function to sort operations by locale (ASC) then slug (ASC)
    const sortOperations = (ops: MatchOperation[]) => {
      return ops.sort((a, b) => {
        // First sort by locale
        if (a.local.locale !== b.local.locale) {
          return a.local.locale.localeCompare(b.local.locale);
        }
        // Then sort by slug within the same locale
        return a.local.slug.localeCompare(b.local.slug);
      });
    };

    // New content
    for (const op of sortOperations([...operations.create])) {
      const typeLabel = op.local.type.padEnd(12);
      const localeLabel = `[${op.local.locale}]`.padEnd(6);
      colorConsole.log(`        ${statusColors.created('new file:')}   ${typeLabel} ${localeLabel} ${colorConsole.highlight(op.local.slug)}`);
    }

    // Modified content
    for (const op of sortOperations([...operations.update])) {
      const typeLabel = op.local.type.padEnd(12);
      const localeLabel = `[${op.local.locale}]`.padEnd(6);
      const idLabel = op.remote?.id ? `(ID: ${op.remote.id})` : '';
      colorConsole.log(`        ${statusColors.modified('modified:')}   ${typeLabel} ${localeLabel} ${colorConsole.highlight(op.local.slug)} ${colorConsole.gray(idLabel)}`);
    }

    // Renamed content (slug changed)
    for (const op of sortOperations([...operations.rename])) {
      const typeLabel = op.local.type.padEnd(12);
      const localeLabel = `[${op.local.locale}]`.padEnd(6);
      const idLabel = op.remote?.id ? `(ID: ${op.remote.id})` : '';
      colorConsole.log(`        ${statusColors.renamed('renamed:')}    ${typeLabel} ${localeLabel} ${colorConsole.gray(op.oldSlug || 'unknown')} -> ${colorConsole.highlight(op.local.slug)} ${colorConsole.gray(idLabel)}`);
    }

    // Type changed content
    for (const op of sortOperations([...operations.typeChange])) {
      const typeLabel = op.local.type.padEnd(12);
      const localeLabel = `[${op.local.locale}]`.padEnd(6);
      const idLabel = op.remote?.id ? `(ID: ${op.remote.id})` : '';
      const typeChangeLabel = `(${colorConsole.gray(op.oldType || 'unknown')} -> ${colorConsole.highlight(op.newType || 'unknown')})`;
      colorConsole.log(`        ${statusColors.typeChange('type change:')}${typeLabel} ${localeLabel} ${colorConsole.highlight(op.local.slug)} ${typeChangeLabel} ${colorConsole.gray(idLabel)}`);
    }

    // Show detailed previews if requested (and not in single file mode which already shows them)
    if (showDetailedPreview && !isSingleFile) {
      console.log('');
      console.log('📋 Detailed Change Previews:');
      console.log('');

      // Show detailed diff for each operation (same as single file mode)
      for (const op of sortOperations([...operations.create])) {
        await displayDetailedDiff(op, 'New file', typeMap);
      }
      for (const op of sortOperations([...operations.update])) {
        await displayDetailedDiff(op, 'Modified', typeMap);
      }
      for (const op of sortOperations([...operations.rename])) {
        await displayDetailedDiff(op, `Renamed (${op.oldSlug} → ${op.local.slug})`, typeMap);
      }
      for (const op of sortOperations([...operations.typeChange])) {
        await displayDetailedDiff(op, `Type changed (${op.oldType} → ${op.newType})`, typeMap);
      }
    }

    console.log('');
  }  // Conflicts (like git's merge conflicts)
  if (operations.conflict.length > 0) {
    colorConsole.warn(`⚠️  Unmerged conflicts (${operations.conflict.length} files):`);
    colorConsole.info('  (use "leadcms pull" to merge remote changes)');
    colorConsole.log('');

    // Sort conflicts by locale then slug as well
    const sortedConflicts = [...operations.conflict].sort((a, b) => {
      if (a.local.locale !== b.local.locale) {
        return a.local.locale.localeCompare(b.local.locale);
      }
      return a.local.slug.localeCompare(b.local.slug);
    });

    for (const op of sortedConflicts) {
      const typeLabel = op.local.type.padEnd(12);
      const localeLabel = `[${op.local.locale}]`.padEnd(6);
      colorConsole.log(`        ${statusColors.conflict('conflict:')}   ${typeLabel} ${localeLabel} ${colorConsole.highlight(op.local.slug)}`);
      colorConsole.log(`                    ${colorConsole.gray(op.reason || 'Unknown conflict')}`);
    }
    colorConsole.log('');

    // Show detailed previews for conflicts if requested (and not in single file mode)
    if (showDetailedPreview && !isSingleFile && operations.conflict.length > 0) {
      console.log('');
      console.log('📋 Detailed Conflict Previews:');
      console.log('');

      for (const op of sortedConflicts) {
        await displayDetailedDiff(op, `Conflict: ${op.reason}`, typeMap);
      }
    }

    if (!isStatusOnly) {
      colorConsole.important('💡 To resolve conflicts:');
      colorConsole.info('   • Run "leadcms pull" to fetch latest changes');
      colorConsole.info('   • Resolve conflicts in local files');
      colorConsole.info('   • Run "leadcms push" again');
      colorConsole.warn('   • Or use "leadcms push --force" to override remote changes (⚠️  data loss risk)');
      colorConsole.log('');
    }
  }
}

/**
 * Display what API calls would be made without executing them
 */
async function showDryRunOperations(operations: ContentOperations): Promise<void> {
  colorConsole.important('\n🧪 Dry Run Mode - API Calls Preview');
  colorConsole.info('The following API calls would be made:\n');

  // Create operations
  if (operations.create.length > 0) {
    colorConsole.progress(`\n📤 CREATE Operations (${operations.create.length}):`);
    for (const op of operations.create) {
      const contentData = formatContentForAPI(op.local);
      colorConsole.log(`\n${colorConsole.cyan('POST')} ${colorConsole.highlight('/api/content')}`);
      colorConsole.log(`${colorConsole.gray('Content-Type:')} application/json`);
      colorConsole.log(`\n${colorConsole.gray('Request Body:')}`);
      colorConsole.log(JSON.stringify(contentData, null, 2));
    }
  }

  // Update operations
  if (operations.update.length > 0) {
    colorConsole.progress(`\n🔄 UPDATE Operations (${operations.update.length}):`);
    for (const op of operations.update) {
      if (op.remote?.id) {
        const contentData = formatContentForAPI(op.local);
        colorConsole.log(`\n${colorConsole.yellow('PUT')} ${colorConsole.highlight(`/api/content/${op.remote.id}`)}`);
        colorConsole.log(`${colorConsole.gray('Content-Type:')} application/json`);
        colorConsole.log(`\n${colorConsole.gray('Request Body:')}`);
        colorConsole.log(JSON.stringify(contentData, null, 2));
      }
    }
  }

  // Rename operations (implemented as updates)
  if (operations.rename.length > 0) {
    colorConsole.progress(`\n📝 RENAME Operations (${operations.rename.length}):`);
    for (const op of operations.rename) {
      if (op.remote?.id) {
        const contentData = formatContentForAPI(op.local);
        colorConsole.log(`\n${colorConsole.yellow('PUT')} ${colorConsole.highlight(`/api/content/${op.remote.id}`)}`);
        colorConsole.log(`${colorConsole.gray('Content-Type:')} application/json`);
        colorConsole.log(`${colorConsole.gray('Note:')} Renaming ${colorConsole.gray(op.oldSlug || 'unknown')} → ${colorConsole.highlight(op.local.slug)}`);
        colorConsole.log(`\n${colorConsole.gray('Request Body:')}`);
        colorConsole.log(JSON.stringify(contentData, null, 2));
      }
    }
  }

  // Type change operations (implemented as updates)
  if (operations.typeChange.length > 0) {
    colorConsole.progress(`\n🔀 TYPE CHANGE Operations (${operations.typeChange.length}):`);
    for (const op of operations.typeChange) {
      if (op.remote?.id) {
        const contentData = formatContentForAPI(op.local);
        colorConsole.log(`\n${colorConsole.yellow('PUT')} ${colorConsole.highlight(`/api/content/${op.remote.id}`)}`);
        colorConsole.log(`${colorConsole.gray('Content-Type:')} application/json`);
        colorConsole.log(`${colorConsole.gray('Note:')} Type change ${colorConsole.gray(op.oldType || 'unknown')} → ${colorConsole.highlight(op.newType || 'unknown')}`);
        colorConsole.log(`\n${colorConsole.gray('Request Body:')}`);
        colorConsole.log(JSON.stringify(contentData, null, 2));
      }
    }
  }



  colorConsole.log('\n');
  colorConsole.important('💡 No actual API calls were made. Use without --dry-run to execute.');
}

/**
 * Main function for push command
 */
async function pushMain(options: PushOptions = {}): Promise<void> {
  const { statusOnly = false, force = false, targetId, targetSlug, showDetailedPreview = false, dryRun = false } = options;

  try {
    const isSingleFileMode = !!(targetId || targetSlug);
    const actionDescription = statusOnly ? 'status check' : 'push';
    const targetDescription = targetId ? `ID ${targetId}` : targetSlug ? `slug "${targetSlug}"` : 'all content';

    console.log(`[PUSH] Starting ${actionDescription} for ${targetDescription}...`);

    // Read local content
    const localContent = await readLocalContent();

    if (localContent.length === 0) {
      console.log('📂 No local content found. Nothing to sync.');
      return;
    }

    // Fetch remote content types for content transformation
    const remoteTypes = await leadCMSDataService.getContentTypes();
    const remoteTypeMap: Record<string, string> = {};
    remoteTypes.forEach(type => {
      remoteTypeMap[type.uid] = type.format;
    });

    // Filter local content if targeting specific content
    let filteredLocalContent = localContent;
    if (isSingleFileMode) {
      filteredLocalContent = localContent.filter(content => {
        if (targetId && content.metadata.id?.toString() === targetId) return true;
        if (targetSlug && content.slug === targetSlug) return true;
        return false;
      });

      if (filteredLocalContent.length === 0) {
        console.log(`❌ No local content found with ${targetId ? `ID ${targetId}` : `slug "${targetSlug}"`}`);
        return;
      }

      console.log(`[LOCAL] Found ${filteredLocalContent.length} matching local file(s)`);
    } else {
      // Get local content types and validate them
      const localTypes = getLocalContentTypes(localContent);
      console.log(`[LOCAL] Found content types: ${Array.from(localTypes).join(', ')}`);
      await validateContentTypes(localTypes, remoteTypeMap, dryRun);
    }

    // Fetch remote content for comparison
    const remoteContent = await fetchRemoteContent();

    // Match local vs remote content with type mapping for proper content transformation
    const operations = await matchContent(filteredLocalContent, remoteContent, remoteTypeMap);

    // Filter operations if targeting specific content
    const finalOperations = isSingleFileMode ?
      filterContentOperations(operations, targetId, targetSlug) :
      operations;

    // Check if we found the target content
    if (isSingleFileMode) {
      const totalChanges = finalOperations.create.length + finalOperations.update.length +
                          finalOperations.rename.length + finalOperations.typeChange.length +
                          finalOperations.conflict.length;

      if (totalChanges === 0 && filteredLocalContent.length > 0) {
        // We have local content but no operations - it's in sync
        console.log(`✅ Content with ${targetId ? `ID ${targetId}` : `slug "${targetSlug}"`} is in sync`);
      } else if (totalChanges === 0) {
        console.log(`❌ No content found with ${targetId ? `ID ${targetId}` : `slug "${targetSlug}"`} in remote or local`);
        return;
      }
    }

    // Display status
    await displayStatus(finalOperations, statusOnly, isSingleFileMode, showDetailedPreview, remoteTypeMap);

    // If status only, we're done
    if (statusOnly) {
      return;
    }

    // If dry run mode, show API calls without executing
    if (dryRun) {
      await showDryRunOperations(finalOperations);
      return;
    }

    // Handle conflicts
    if (finalOperations.conflict.length > 0 && !force) {
      console.log('\n❌ Cannot proceed due to conflicts. Use --force to override or resolve conflicts first.');
      return;
    }

    const totalChanges = finalOperations.create.length + finalOperations.update.length + finalOperations.rename.length + finalOperations.typeChange.length;
    if (totalChanges === 0) {
      if (isSingleFileMode) {
        console.log('✅ File is already in sync.');
      } else {
        console.log('✅ Nothing to sync.');
      }
      return;
    }

    // Confirm changes
    const itemDescription = isSingleFileMode ? 'file change' : 'changes';
    const confirmMsg = `\nProceed with syncing ${totalChanges} ${itemDescription} to LeadCMS? (y/N): `;
    const confirmation = await question(confirmMsg);

    if (confirmation.toLowerCase() !== 'y' && confirmation.toLowerCase() !== 'yes') {
      console.log('🚫 Push cancelled.');
      return;
    }

    // Execute the sync
    await executePush(finalOperations, { force });

    colorConsole.success('\n🎉 Content push completed successfully!');

  } catch (error: any) {
    const operation = statusOnly ? 'Status check' : 'Push';
    console.error(`❌ ${operation} failed:`, error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

/**
 * Execute the actual push operations
 */
async function executePush(operations: ContentOperations, options: ExecutionOptions = {}): Promise<void> {
  const { force = false } = options;

  // Handle force updates for conflicts
  if (force && operations.conflict.length > 0) {
    console.log(`\n🔄 Force updating ${operations.conflict.length} conflicted items...`);
    for (const conflict of operations.conflict) {
      operations.update.push({
        local: conflict.local,
        remote: conflict.remote
      });
    }
  }

  // Use individual operations
  await executeIndividualOperations(operations, { force });
}

/**
 * Execute operations individually (one by one)
 */
async function executeIndividualOperations(operations: ContentOperations, options: ExecutionOptions = {}): Promise<void> {
  const { force = false } = options;
  let successful = 0;
  let failed = 0;

  // Create new content
  if (operations.create.length > 0) {
    console.log(`\n🆕 Creating ${operations.create.length} new items...`);
    for (const op of operations.create) {
      try {
        const result = await leadCMSDataService.createContent(formatContentForAPI(op.local));
        if (result) {
          await updateLocalMetadata(op.local, result);
          successful++;
          colorConsole.success(`✅ Created: ${colorConsole.highlight(`${op.local.type}/${op.local.slug}`)}`);
        } else {
          failed++;
          colorConsole.error(`❌ Failed to create: ${colorConsole.highlight(`${op.local.type}/${op.local.slug}`)}`);
        }
      } catch (error: any) {
        failed++;
        colorConsole.error(`❌ Failed to create ${colorConsole.highlight(`${op.local.type}/${op.local.slug}`)}:`, error.message);
      }
    }
  }

  // Update existing content
  if (operations.update.length > 0) {
    console.log(`\n🔄 Updating ${operations.update.length} existing items...`);
    for (const op of operations.update) {
      try {
        if (op.remote?.id) {
          const result = await leadCMSDataService.updateContent(op.remote.id, formatContentForAPI(op.local));
          if (result) {
            await updateLocalMetadata(op.local, result);
            successful++;
            colorConsole.success(`✅ Updated: ${colorConsole.highlight(`${op.local.type}/${op.local.slug}`)}`);
          } else {
            failed++;
            colorConsole.error(`❌ Failed to update: ${colorConsole.highlight(`${op.local.type}/${op.local.slug}`)}`);
          }
        } else {
          failed++;
          colorConsole.error(`❌ Failed to update ${colorConsole.highlight(`${op.local.type}/${op.local.slug}`)}: No remote ID`);
        }
      } catch (error: any) {
        failed++;
        console.log(`❌ Failed to update ${op.local.type}/${op.local.slug}:`, error.message);
      }
    }
  }

  // Handle renamed content (slug changed)
  if (operations.rename.length > 0) {
    console.log(`\n📝 Renaming ${operations.rename.length} items...`);
    for (const op of operations.rename) {
      try {
        if (op.remote?.id) {
          const result = await leadCMSDataService.updateContent(op.remote.id, formatContentForAPI(op.local));
          if (result) {
            await updateLocalMetadata(op.local, result);
            successful++;
            console.log(`✅ Renamed: ${op.oldSlug} -> ${op.local.slug}`);
          } else {
            failed++;
            console.log(`❌ Failed to rename: ${op.oldSlug} -> ${op.local.slug}`);
          }
        } else {
          failed++;
          console.log(`❌ Failed to rename ${op.oldSlug}: No remote ID`);
        }
      } catch (error: any) {
        failed++;
        console.log(`❌ Failed to rename ${op.oldSlug}:`, error.message);
      }
    }
  }

  // Handle content type changes
  if (operations.typeChange.length > 0) {
    console.log(`\n🔄 Changing content types for ${operations.typeChange.length} items...`);
    for (const op of operations.typeChange) {
      try {
        if (op.remote?.id) {
          const result = await leadCMSDataService.updateContent(op.remote.id, formatContentForAPI(op.local));
          if (result) {
            await updateLocalMetadata(op.local, result);
            successful++;
            console.log(`✅ Type changed: ${op.local.slug} (${op.oldType} -> ${op.newType})`);
          } else {
            failed++;
            console.log(`❌ Failed to change type: ${op.local.slug} (${op.oldType} -> ${op.newType})`);
          }
        } else {
          failed++;
          console.log(`❌ Failed to change type for ${op.local.slug}: No remote ID`);
        }
      } catch (error: any) {
        failed++;
        console.log(`❌ Failed to change type for ${op.local.slug}:`, error.message);
      }
    }
  }

  console.log(`\n📊 Results: ${successful} successful, ${failed} failed`);

  // If any updates were successful, automatically pull latest changes to sync local store
  if (successful > 0) {
    console.log(`\n🔄 Syncing latest changes from LeadCMS to local store...`);
    try {
      const { fetchLeadCMSContent } = await import('./fetch-leadcms-content.js');
      await fetchLeadCMSContent();
      console.log('✅ Local content store synchronized with latest changes');
    } catch (error: any) {
      console.warn('⚠️  Failed to automatically sync local content:', error.message);
      console.log('💡 You may want to manually run the pull command to sync latest changes');
    }
  }
}

/**
 * Format local content for API submission
 */
function formatContentForAPI(localContent: LocalContentItem): Partial<ContentItem> {
  const contentData: any = {
    slug: localContent.slug,
    type: localContent.type,
    language: localContent.locale,
    body: localContent.body,
    ...localContent.metadata
  };

  // Preserve the file-based slug (from localContent.slug) over metadata slug
  // This is crucial for rename operations where the file has been renamed
  // but the frontmatter still contains the old slug
  if (localContent.slug !== localContent.metadata?.slug) {
    contentData.slug = localContent.slug;
  }

  // Remove local-only fields
  delete contentData.filePath;
  delete contentData.isLocal;

  return contentData;
}

/**
 * Update local file with metadata from LeadCMS response
 */
async function updateLocalMetadata(localContent: LocalContentItem, remoteResponse: ContentItem): Promise<void> {
  const { filePath } = localContent;
  const ext = path.extname(filePath);

  try {
    if (ext === '.mdx') {
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const parsed = matter(fileContent);

      // Update metadata with response data (only non-system fields)
      parsed.data.id = remoteResponse.id;
      // Do not add system fields (createdAt, updatedAt, publishedAt) to local files

      // Rebuild the file
      const newContent = matter.stringify(parsed.content, parsed.data);
      await fs.writeFile(filePath, newContent, 'utf-8');

    } else if (ext === '.json') {
      const jsonData = JSON.parse(await fs.readFile(filePath, 'utf-8'));

      // Update metadata (only non-system fields)
      jsonData.id = remoteResponse.id;
      // Do not add system fields (createdAt, updatedAt, publishedAt) to local files

      await fs.writeFile(filePath, JSON.stringify(jsonData, null, 2), 'utf-8');
    }
  } catch (error: any) {
    console.warn(`Failed to update local metadata for ${filePath}:`, error.message);
  }
}

// Export functions for CLI usage
export { pushMain as pushLeadCMSContent };

// Export internal functions for testing
export { hasActualContentChanges };
// Re-export the new comparison function for consistency
export { transformRemoteForComparison } from "../lib/content-transformation.js";

// Handle direct script execution only in ESM environment
if (typeof import.meta !== 'undefined' && process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const statusOnly = args.includes('--status');
  const force = args.includes('--force');
  const dryRun = args.includes('--dry-run');

  // Parse target ID or slug
  let targetId: string | undefined;
  let targetSlug: string | undefined;

  const idIndex = args.findIndex(arg => arg === '--id');
  if (idIndex !== -1 && args[idIndex + 1]) {
    targetId = args[idIndex + 1];
  }

  const slugIndex = args.findIndex(arg => arg === '--slug');
  if (slugIndex !== -1 && args[slugIndex + 1]) {
    targetSlug = args[slugIndex + 1];
  }

  pushMain({ statusOnly, force, targetId, targetSlug, dryRun }).catch((error) => {
    console.error('Error running LeadCMS push:', error.message);
    process.exit(1);
  });
}

// Export types
export type { LocalContentItem, RemoteContentItem, ContentOperations, PushOptions };
