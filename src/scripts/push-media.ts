import * as fs from 'fs';
import * as path from 'path';
import readline from 'readline';
import FormData from 'form-data';
import { leadCMSDataService, MediaItem } from '../lib/data-service.js';
import { loadConfig, LeadCMSConfig } from '../lib/config.js';
import { success, error, warn, info } from '../lib/console-colors.js';

/**
 * Represents a local media file with metadata
 */
export interface LocalMediaFile {
  filePath: string;      // Relative path from media directory (e.g., 'blog/hero.jpg')
  absolutePath: string;  // Full filesystem path
  scopeUid: string;      // Scope identifier (e.g., 'blog', 'pages/about')
  name: string;          // Filename (e.g., 'hero.jpg')
  size: number;          // File size in bytes
  extension: string;     // File extension including dot (e.g., '.jpg')
  mimeType: string;      // MIME type (e.g., 'image/jpeg')
}

/**
 * Represents operation to perform on a media file
 */
export interface MediaOperation {
  type: 'create' | 'update' | 'delete' | 'skip';
  local?: LocalMediaFile;
  remote?: MediaItem;
  reason: string;
}

/**
 * Result of media status check
 */
export interface MediaStatusResult {
  operations: MediaOperation[];
  localFiles: LocalMediaFile[];
  remoteFiles: MediaItem[];
  summary: {
    creates: number;
    updates: number;
    deletes: number;
    skips: number;
    total: number;
  };
}

/**
 * Result of media push execution
 */
export interface MediaPushResult {
  operations: MediaOperation[];
  executed: {
    successful: number;
    failed: number;
    skipped: number;
  };
  errors: Array<{ operation: MediaOperation; error: string }>;
}

/**
 * Dependencies that can be injected for testing
 */
export interface MediaDependencies {
  /** Function to fetch remote media - defaults to leadCMSDataService.getAllMedia */
  fetchRemoteMedia?: () => Promise<MediaItem[]>;
  /** Function to upload media - defaults to leadCMSDataService.uploadMedia */
  uploadMedia?: (formData: any) => Promise<MediaItem>;
  /** Function to update media - defaults to leadCMSDataService.updateMedia */
  updateMedia?: (formData: any) => Promise<MediaItem>;
  /** Function to delete media - defaults to leadCMSDataService.deleteMedia */
  deleteMedia?: (pathToFile: string) => Promise<void>;
  /** Logger for info messages - defaults to console info */
  logInfo?: (message: string) => void;
  /** Logger for warnings - defaults to console warn */
  logWarn?: (message: string) => void;
  /** Logger for errors - defaults to console error */
  logError?: (message: string) => void;
  /** Logger for success messages - defaults to console success */
  logSuccess?: (message: string) => void;
  /** Function to prompt user for confirmation - defaults to readline prompt */
  promptConfirmation?: (message: string) => Promise<boolean>;
}

/**
 * Default dependencies using real implementations
 */
function getDefaultDependencies(): Required<MediaDependencies> {
  // Create readline interface for user prompts
  let rl: readline.Interface | null = null;

  const getReadline = () => {
    if (!rl) {
      rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
    }
    return rl;
  };

  return {
    fetchRemoteMedia: () => leadCMSDataService.getAllMedia(),
    uploadMedia: (formData: any) => leadCMSDataService.uploadMedia(formData),
    updateMedia: (formData: any) => leadCMSDataService.updateMedia(formData),
    deleteMedia: (pathToFile: string) => leadCMSDataService.deleteMedia(pathToFile),
    logInfo: info,
    logWarn: warn,
    logError: error,
    logSuccess: success,
    promptConfirmation: async (message: string) => {
      const readline = getReadline();
      return new Promise((resolve) => {
        readline.question(message, (answer) => {
          readline.close();
          rl = null;
          const confirmed = answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
          resolve(confirmed);
        });
      });
    }
  };
}

/**
 * Maximum file sizes by type (in bytes)
 */
const MAX_FILE_SIZES = {
  image: 10 * 1024 * 1024,    // 10MB for images
  video: 100 * 1024 * 1024,   // 100MB for videos
  document: 25 * 1024 * 1024, // 25MB for documents
  other: 10 * 1024 * 1024     // 10MB for other files
};

/**
 * File extensions by category
 */
const FILE_CATEGORIES = {
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.avif', '.bmp', '.ico'],
  video: ['.mp4', '.webm', '.ogg', '.mov', '.avi'],
  document: ['.pdf', '.doc', '.docx', '.txt', '.md']
};

/**
 * Get MIME type from file extension
 */
export function getMimeType(extension: string): string {
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.avif': 'image/avif',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.ogg': 'video/ogg',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown'
  };

  return mimeTypes[extension.toLowerCase()] || 'application/octet-stream';
}

/**
 * Get file category from extension
 */
export function getFileCategory(extension: string): 'image' | 'video' | 'document' | 'other' {
  const lowerExt = extension.toLowerCase();

  if (FILE_CATEGORIES.image.includes(lowerExt)) return 'image';
  if (FILE_CATEGORIES.video.includes(lowerExt)) return 'video';
  if (FILE_CATEGORIES.document.includes(lowerExt)) return 'document';

  return 'other';
}

/**
 * Validate file size against limits
 */
export function validateFileSize(file: LocalMediaFile): { valid: boolean; message?: string } {
  const category = getFileCategory(file.extension);
  const maxSize = MAX_FILE_SIZES[category];

  if (file.size > maxSize) {
    return {
      valid: false,
      message: `File size ${(file.size / 1024 / 1024).toFixed(2)}MB exceeds ${category} limit of ${(maxSize / 1024 / 1024).toFixed(0)}MB`
    };
  }

  return { valid: true };
}

/**
 * Check if a file should be ignored (system files, hidden files, etc.)
 */
function shouldIgnoreFile(filename: string): boolean {
  const ignoredPatterns = [
    '.DS_Store',           // macOS
    'Thumbs.db',           // Windows
    'desktop.ini',         // Windows
    '.gitkeep',            // Git placeholder
    '.gitignore',          // Git
    '.htaccess',           // Apache
    '~$',                  // Office temp files (prefix)
    '.tmp',                // Temp files
    '.temp',               // Temp files
    '.bak',                // Backup files
    '.swp',                // Vim swap files
    '.swo',                // Vim swap files
  ];

  // Check if filename matches any ignored pattern
  for (const pattern of ignoredPatterns) {
    if (pattern.startsWith('~') && filename.startsWith(pattern.slice(1))) {
      return true;
    }
    if (filename === pattern || filename.endsWith(pattern)) {
      return true;
    }
  }

  // Ignore hidden files (starting with dot) except common media files
  if (filename.startsWith('.')) {
    return true;
  }

  return false;
}

/**
 * Recursively scan directory for media files
 */
export function scanLocalMedia(mediaDir: string, config: LeadCMSConfig): LocalMediaFile[] {
  const files: LocalMediaFile[] = [];

  if (!fs.existsSync(mediaDir)) {
    return files;
  }

  function scanDirectory(currentDir: string, relativePath: string = '') {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      // Skip ignored files and directories
      if (shouldIgnoreFile(entry.name)) {
        continue;
      }

      const fullPath = path.join(currentDir, entry.name);
      const relPath = relativePath ? path.join(relativePath, entry.name) : entry.name;

      if (entry.isDirectory()) {
        scanDirectory(fullPath, relPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        const stats = fs.statSync(fullPath);

        // Parse scopeUid from path structure
        // Format: mediaDir/scopeUid/filename or mediaDir/scope/uid/filename
        const scopeUid = path.dirname(relPath).replace(/\\/g, '/');

        const localFile: LocalMediaFile = {
          filePath: relPath.replace(/\\/g, '/'),
          absolutePath: fullPath,
          scopeUid,
          name: entry.name,
          size: stats.size,
          extension: ext,
          mimeType: getMimeType(ext)
        };

        files.push(localFile);
      }
    }
  }

  scanDirectory(mediaDir);
  return files;
}

/**
 * Match local and remote media files to determine operations
 */
export function matchMediaFiles(
  localFiles: LocalMediaFile[],
  remoteFiles: MediaItem[],
  allowDelete: boolean = false
): MediaOperation[] {
  const operations: MediaOperation[] = [];

  // Create map of remote files by scopeUid + name
  const remoteMap = new Map<string, MediaItem>();
  for (const remote of remoteFiles) {
    const key = `${remote.scopeUid}/${remote.name}`;
    remoteMap.set(key, remote);
  }

  // Create map of local files by scopeUid + name
  const localMap = new Map<string, LocalMediaFile>();
  for (const local of localFiles) {
    const key = `${local.scopeUid}/${local.name}`;
    localMap.set(key, local);
  }

  // Check local files against remote
  for (const local of localFiles) {
    const key = `${local.scopeUid}/${local.name}`;
    const remote = remoteMap.get(key);

    if (!remote) {
      // New file - needs to be uploaded
      operations.push({
        type: 'create',
        local,
        reason: 'New file not present remotely'
      });
    } else if (local.size !== remote.size) {
      // File size changed - needs update
      operations.push({
        type: 'update',
        local,
        remote,
        reason: `File size changed (local: ${local.size}, remote: ${remote.size})`
      });
    } else {
      // No changes detected
      operations.push({
        type: 'skip',
        local,
        remote,
        reason: 'No changes detected'
      });
    }
  }

  // Check for deleted files (remote but not local) if deletion is allowed
  if (allowDelete) {
    for (const remote of remoteFiles) {
      const key = `${remote.scopeUid}/${remote.name}`;
      if (!localMap.has(key)) {
        operations.push({
          type: 'delete',
          remote,
          reason: 'File removed locally'
        });
      }
    }
  }

  return operations;
}

/**
 * Display media status in formatted output
 */
export function displayMediaStatus(
  operations: MediaOperation[],
  dryRun: boolean = false,
  showDelete: boolean = false,
  deps?: Partial<MediaDependencies>
): void {
  const log = deps?.logInfo || info;
  const logWarning = deps?.logWarn || warn;
  const logErr = deps?.logError || error;
  const logOk = deps?.logSuccess || success;

  const creates = operations.filter(op => op.type === 'create');
  const updates = operations.filter(op => op.type === 'update');
  const deletes = showDelete ? operations.filter(op => op.type === 'delete') : [];
  const skips = operations.filter(op => op.type === 'skip');

  console.log('\n📊 Media Status:');
  console.log('─'.repeat(80));

  if (creates.length > 0) {
    log(`\n✨ ${creates.length} file(s) to upload:`);
    creates.forEach(op => {
      const sizeKB = ((op.local!.size / 1024).toFixed(2));
      console.log(`   + ${op.local!.scopeUid}/${op.local!.name} (${sizeKB}KB)`);
    });
  }

  if (updates.length > 0) {
    logWarning(`\n📝 ${updates.length} file(s) to update:`);
    updates.forEach(op => {
      const sizeKB = ((op.local!.size / 1024).toFixed(2));
      console.log(`   ↻ ${op.local!.scopeUid}/${op.local!.name} (${sizeKB}KB)`);
      console.log(`     ${op.reason}`);
    });
  }

  if (deletes.length > 0) {
    logErr(`\n🗑️  ${deletes.length} file(s) to delete:`);
    deletes.forEach(op => {
      console.log(`   - ${op.remote!.scopeUid}/${op.remote!.name}`);
    });
  }

  if (skips.length > 0) {
    log(`\n✓ ${skips.length} file(s) up to date`);
  }

  console.log('\n' + '─'.repeat(80));

  const totalOperations = creates.length + updates.length + deletes.length;
  if (totalOperations === 0) {
    logOk('All media files are in sync! ✨');
  } else {
    if (dryRun) {
      log(`\nDry run complete. Run without --dry-run to apply ${totalOperations} change(s).`);
    } else {
      log(`\nReady to apply ${totalOperations} change(s).`);
    }
  }

  console.log('');
}

/**
 * Execute media push operations and return detailed results
 */
export async function executeMediaPush(
  operations: MediaOperation[],
  dryRun: boolean = false,
  deps?: Partial<MediaDependencies>
): Promise<MediaPushResult> {
  const defaults = getDefaultDependencies();
  const uploadMedia = deps?.uploadMedia || defaults.uploadMedia;
  const updateMedia = deps?.updateMedia || defaults.updateMedia;
  const deleteMedia = deps?.deleteMedia || defaults.deleteMedia;
  const logErr = deps?.logError || defaults.logError;
  const logOk = deps?.logSuccess || defaults.logSuccess;
  const logWarning = deps?.logWarn || defaults.logWarn;

  const result: MediaPushResult = {
    operations,
    executed: { successful: 0, failed: 0, skipped: 0 },
    errors: []
  };

  if (dryRun) {
    displayMediaStatus(operations, true, true, deps);
    result.executed.skipped = operations.length;
    return result;
  }

  const creates = operations.filter(op => op.type === 'create');
  const updates = operations.filter(op => op.type === 'update');
  const deletes = operations.filter(op => op.type === 'delete');
  const skips = operations.filter(op => op.type === 'skip');

  result.executed.skipped = skips.length;

  // Upload new files
  for (const op of creates) {
    try {
      const validation = validateFileSize(op.local!);
      if (!validation.valid) {
        logErr(`✗ ${op.local!.scopeUid}/${op.local!.name}: ${validation.message}`);
        result.executed.failed++;
        result.errors.push({ operation: op, error: validation.message! });
        continue;
      }

      const formData = new FormData();
      formData.append('File', fs.createReadStream(op.local!.absolutePath));
      formData.append('ScopeUid', op.local!.scopeUid);

      await uploadMedia(formData);
      logOk(`✓ Uploaded ${op.local!.scopeUid}/${op.local!.name}`);
      result.executed.successful++;
    } catch (err: any) {
      logErr(`✗ Failed to upload ${op.local!.scopeUid}/${op.local!.name}: ${err.message}`);
      result.executed.failed++;
      result.errors.push({ operation: op, error: err.message });
    }
  }

  // Update modified files
  for (const op of updates) {
    try {
      const validation = validateFileSize(op.local!);
      if (!validation.valid) {
        logErr(`✗ ${op.local!.scopeUid}/${op.local!.name}: ${validation.message}`);
        result.executed.failed++;
        result.errors.push({ operation: op, error: validation.message! });
        continue;
      }

      const formData = new FormData();
      formData.append('File', fs.createReadStream(op.local!.absolutePath));
      formData.append('ScopeUid', op.local!.scopeUid);
      formData.append('FileName', op.local!.name);

      await updateMedia(formData);
      logOk(`✓ Updated ${op.local!.scopeUid}/${op.local!.name}`);
      result.executed.successful++;
    } catch (err: any) {
      logErr(`✗ Failed to update ${op.local!.scopeUid}/${op.local!.name}: ${err.message}`);
      result.executed.failed++;
      result.errors.push({ operation: op, error: err.message });
    }
  }

  // Delete removed files
  for (const op of deletes) {
    try {
      const pathToFile = `${op.remote!.scopeUid}/${op.remote!.name}`;
      await deleteMedia(pathToFile);
      logOk(`✓ Deleted ${pathToFile}`);
      result.executed.successful++;
    } catch (err: any) {
      logErr(`✗ Failed to delete ${op.remote!.scopeUid}/${op.remote!.name}: ${err.message}`);
      result.executed.failed++;
      result.errors.push({ operation: op, error: err.message });
    }
  }

  // Summary
  console.log('\n' + '─'.repeat(80));
  if (result.executed.failed === 0) {
    logOk(`\n✨ Media push complete! ${result.executed.successful} operation(s) successful.`);
  } else {
    logWarning(`\n⚠️  Media push completed with errors: ${result.executed.successful} succeeded, ${result.executed.failed} failed.`);
  }
  console.log('');

  return result;
}

/**
 * Options for statusMedia function
 */
export interface StatusMediaOptions {
  scopeUid?: string;
  showDelete?: boolean;
  /** Custom media directory path (absolute). If not provided, uses config.mediaDir */
  mediaDir?: string;
}

/**
 * Status-only function (no modifications) - returns results for testing
 */
export async function statusMedia(
  options: StatusMediaOptions = {},
  deps?: Partial<MediaDependencies>
): Promise<MediaStatusResult> {
  const defaults = getDefaultDependencies();
  const fetchRemoteMedia = deps?.fetchRemoteMedia || defaults.fetchRemoteMedia;
  const logInfoFn = deps?.logInfo || defaults.logInfo;
  const logWarnFn = deps?.logWarn || defaults.logWarn;
  const logErrFn = deps?.logError || defaults.logError;

  try {
    const config = loadConfig();

    // Use provided mediaDir or resolve from config
    const mediaDir = options.mediaDir || path.resolve(process.cwd(), config.mediaDir || 'media');

    logInfoFn(`Scanning local media: ${mediaDir}`);
    const localFiles = scanLocalMedia(mediaDir, config);

    if (localFiles.length === 0) {
      logWarnFn('No media files found locally.');
      return {
        operations: [],
        localFiles: [],
        remoteFiles: [],
        summary: { creates: 0, updates: 0, deletes: 0, skips: 0, total: 0 }
      };
    }

    logInfoFn(`Fetching remote media from LeadCMS...`);
    const remoteFiles = await fetchRemoteMedia();

    let filteredLocal = localFiles;
    let filteredRemote = remoteFiles;

    if (options.scopeUid) {
      filteredLocal = localFiles.filter(f => f.scopeUid === options.scopeUid);
      filteredRemote = remoteFiles.filter(f => f.scopeUid === options.scopeUid);
    }

    // Show deletes only if showDelete flag is provided
    const operations = matchMediaFiles(filteredLocal, filteredRemote, options.showDelete || false);
    displayMediaStatus(operations, false, options.showDelete || false, deps);

    const creates = operations.filter(op => op.type === 'create').length;
    const updates = operations.filter(op => op.type === 'update').length;
    const deletes = operations.filter(op => op.type === 'delete').length;
    const skips = operations.filter(op => op.type === 'skip').length;

    return {
      operations,
      localFiles: filteredLocal,
      remoteFiles: filteredRemote,
      summary: {
        creates,
        updates,
        deletes,
        skips,
        total: creates + updates + deletes
      }
    };

  } catch (err: any) {
    logErrFn(`Media status check failed: ${err.message}`);
    throw err;
  }
}

/**
 * Options for pushMedia function
 */
export interface PushMediaOptions {
  dryRun?: boolean;
  force?: boolean;
  scopeUid?: string;
  allowDelete?: boolean;
  /** Custom media directory path (absolute). If not provided, uses config.mediaDir */
  mediaDir?: string;
}

/**
 * Main function to push media files to LeadCMS - returns results for testing
 */
export async function pushMedia(
  options: PushMediaOptions = {},
  deps?: Partial<MediaDependencies>
): Promise<MediaPushResult> {
  const defaults = getDefaultDependencies();
  const fetchRemoteMedia = deps?.fetchRemoteMedia || defaults.fetchRemoteMedia;
  const logInfoFn = deps?.logInfo || defaults.logInfo;
  const logWarnFn = deps?.logWarn || defaults.logWarn;
  const logErrFn = deps?.logError || defaults.logError;
  const promptConfirmation = deps?.promptConfirmation || defaults.promptConfirmation;

  try {
    const config = loadConfig();

    // Use provided mediaDir or resolve from config
    const mediaDir = options.mediaDir || path.resolve(process.cwd(), config.mediaDir || 'media');

    logInfoFn(`Scanning local media: ${mediaDir}`);
    const localFiles = scanLocalMedia(mediaDir, config);

    if (localFiles.length === 0) {
      logWarnFn('No media files found locally.');
      return {
        operations: [],
        executed: { successful: 0, failed: 0, skipped: 0 },
        errors: []
      };
    }

    logInfoFn(`Fetching remote media from LeadCMS...`);
    const remoteFiles = await fetchRemoteMedia();

    // Filter by scopeUid if specified
    let filteredLocal = localFiles;
    let filteredRemote = remoteFiles;

    if (options.scopeUid) {
      filteredLocal = localFiles.filter(f => f.scopeUid === options.scopeUid);
      filteredRemote = remoteFiles.filter(f => f.scopeUid === options.scopeUid);
      logInfoFn(`Filtering by scope: ${options.scopeUid}`);
    }

    // Match and determine operations
    const operations = matchMediaFiles(filteredLocal, filteredRemote, options.allowDelete || false);

    // Display and execute (always show deletes in push mode)
    displayMediaStatus(operations, options.dryRun, true, deps);

    if (options.dryRun) {
      return {
        operations,
        executed: { successful: 0, failed: 0, skipped: operations.length },
        errors: []
      };
    }

    const totalOps = operations.filter(op => op.type !== 'skip').length;

    if (totalOps === 0) {
      return {
        operations,
        executed: { successful: 0, failed: 0, skipped: operations.length },
        errors: []
      };
    }

    // Confirm changes unless --force is used
    if (!options.force) {
      const confirmMsg = `\nProceed with applying ${totalOps} change(s) to LeadCMS? (y/N): `;
      const confirmed = await promptConfirmation(confirmMsg);

      if (!confirmed) {
        console.log('🚫 Push cancelled.');
        return {
          operations,
          executed: { successful: 0, failed: 0, skipped: operations.length },
          errors: []
        };
      }
    }

    return await executeMediaPush(operations, false, deps);

  } catch (err: any) {
    logErrFn(`Media push failed: ${err.message}`);
    throw err;
  }
}
