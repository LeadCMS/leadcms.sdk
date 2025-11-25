import * as fs from 'fs';
import * as path from 'path';
import readline from 'readline';
import FormData from 'form-data';
import { leadCMSDataService, MediaItem } from '../lib/data-service.js';
import { loadConfig, LeadCMSConfig } from '../lib/config.js';
import { success, error, warn, info } from '../lib/console-colors.js';

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
 * Represents a local media file with metadata
 */
interface LocalMediaFile {
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
interface MediaOperation {
  type: 'create' | 'update' | 'delete' | 'skip';
  local?: LocalMediaFile;
  remote?: MediaItem;
  reason: string;
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
function scanLocalMedia(mediaDir: string, config: LeadCMSConfig): LocalMediaFile[] {
  const files: LocalMediaFile[] = [];

  if (!fs.existsSync(mediaDir)) {
    warn(`Media directory not found: ${mediaDir}`);
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
 * Fetch remote media using sync API
 */
async function fetchRemoteMedia(): Promise<MediaItem[]> {
  try {
    return await leadCMSDataService.getAllMedia();
  } catch (err: any) {
    error(`Failed to fetch remote media: ${err.message}`);
    throw error;
  }
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
export function displayMediaStatus(operations: MediaOperation[], dryRun: boolean = false, showDelete: boolean = false) {
  const creates = operations.filter(op => op.type === 'create');
  const updates = operations.filter(op => op.type === 'update');
  const deletes = showDelete ? operations.filter(op => op.type === 'delete') : [];
  const skips = operations.filter(op => op.type === 'skip');

  console.log('\n📊 Media Status:');
  console.log('─'.repeat(80));

  if (creates.length > 0) {
    info(`\n✨ ${creates.length} file(s) to upload:`);
    creates.forEach(op => {
      const sizeKB = ((op.local!.size / 1024).toFixed(2));
      console.log(`   + ${op.local!.scopeUid}/${op.local!.name} (${sizeKB}KB)`);
    });
  }

  if (updates.length > 0) {
    warn(`\n📝 ${updates.length} file(s) to update:`);
    updates.forEach(op => {
      const sizeKB = ((op.local!.size / 1024).toFixed(2));
      console.log(`   ↻ ${op.local!.scopeUid}/${op.local!.name} (${sizeKB}KB)`);
      console.log(`     ${op.reason}`);
    });
  }

  if (deletes.length > 0) {
    error(`\n🗑️  ${deletes.length} file(s) to delete:`);
    deletes.forEach(op => {
      console.log(`   - ${op.remote!.scopeUid}/${op.remote!.name}`);
    });
  }

  if (skips.length > 0) {
    info(`\n✓ ${skips.length} file(s) up to date`);
  }

  console.log('\n' + '─'.repeat(80));

  const totalOperations = creates.length + updates.length + deletes.length;
  if (totalOperations === 0) {
    success('All media files are in sync! ✨');
  } else {
    if (dryRun) {
      info(`\nDry run complete. Run without --dry-run to apply ${totalOperations} change(s).`);
    } else {
      info(`\nReady to apply ${totalOperations} change(s).`);
    }
  }

  console.log('');
}

/**
 * Execute media push operations
 */
export async function executeMediaPush(
  operations: MediaOperation[],
  dryRun: boolean = false
): Promise<void> {
  if (dryRun) {
    displayMediaStatus(operations, true);
    return;
  }

  const creates = operations.filter(op => op.type === 'create');
  const updates = operations.filter(op => op.type === 'update');
  const deletes = operations.filter(op => op.type === 'delete');

  let successCount = 0;
  let errorCount = 0;

  // Upload new files
  for (const op of creates) {
    try {
      const validation = validateFileSize(op.local!);
      if (!validation.valid) {
        error(`✗ ${op.local!.scopeUid}/${op.local!.name}: ${validation.message}`);
        errorCount++;
        continue;
      }

      const formData = new FormData();
      formData.append('File', fs.createReadStream(op.local!.absolutePath));
      formData.append('ScopeUid', op.local!.scopeUid);

      await leadCMSDataService.uploadMedia(formData);
      success(`✓ Uploaded ${op.local!.scopeUid}/${op.local!.name}`);
      successCount++;
    } catch (err: any) {
      error(`✗ Failed to upload ${op.local!.scopeUid}/${op.local!.name}: ${err.message}`);
      errorCount++;
    }
  }

  // Update modified files
  for (const op of updates) {
    try {
      const validation = validateFileSize(op.local!);
      if (!validation.valid) {
        error(`✗ ${op.local!.scopeUid}/${op.local!.name}: ${validation.message}`);
        errorCount++;
        continue;
      }

      const formData = new FormData();
      formData.append('File', fs.createReadStream(op.local!.absolutePath));
      formData.append('ScopeUid', op.local!.scopeUid);
      formData.append('FileName', op.local!.name);

      await leadCMSDataService.updateMedia(formData);
      success(`✓ Updated ${op.local!.scopeUid}/${op.local!.name}`);
      successCount++;
    } catch (err: any) {
      error(`✗ Failed to update ${op.local!.scopeUid}/${op.local!.name}: ${err.message}`);
      errorCount++;
    }
  }

  // Delete removed files
  for (const op of deletes) {
    try {
      const pathToFile = `${op.remote!.scopeUid}/${op.remote!.name}`;
      await leadCMSDataService.deleteMedia(pathToFile);
      success(`✓ Deleted ${pathToFile}`);
      successCount++;
    } catch (err: any) {
      error(`✗ Failed to delete ${op.remote!.scopeUid}/${op.remote!.name}: ${err.message}`);
      errorCount++;
    }
  }

  // Summary
  console.log('\n' + '─'.repeat(80));
  if (errorCount === 0) {
    success(`\n✨ Media push complete! ${successCount} operation(s) successful.`);
  } else {
    warn(`\n⚠️  Media push completed with errors: ${successCount} succeeded, ${errorCount} failed.`);
  }
  console.log('');
}

/**
 * Main function to push media files to LeadCMS
 */
export async function pushMedia(options: {
  dryRun?: boolean;
  force?: boolean;
  scopeUid?: string;
  allowDelete?: boolean;
} = {}): Promise<void> {
  try {
    const config = loadConfig();

    // Determine media directory
    const mediaDir = path.resolve(process.cwd(), config.mediaDir || 'media');

    info(`Scanning local media: ${mediaDir}`);
    const localFiles = scanLocalMedia(mediaDir, config);

    if (localFiles.length === 0) {
      warn('No media files found locally.');
      return;
    }

    info(`Fetching remote media from LeadCMS...`);
    const remoteFiles = await fetchRemoteMedia();

    // Filter by scopeUid if specified
    let filteredLocal = localFiles;
    let filteredRemote = remoteFiles;

    if (options.scopeUid) {
      filteredLocal = localFiles.filter(f => f.scopeUid === options.scopeUid);
      filteredRemote = remoteFiles.filter(f => f.scopeUid === options.scopeUid);
      info(`Filtering by scope: ${options.scopeUid}`);
    }

    // Match and determine operations
    const operations = matchMediaFiles(filteredLocal, filteredRemote, options.allowDelete || false);

    // Display and execute (always show deletes in push mode)
    displayMediaStatus(operations, options.dryRun, true);

    if (!options.dryRun) {
      const totalOps = operations.filter(op => op.type !== 'skip').length;

      if (totalOps === 0) {
        return;
      }

      // Confirm changes unless --force is used
      if (!options.force) {
        const confirmMsg = `\nProceed with applying ${totalOps} change(s) to LeadCMS? (y/N): `;
        const confirmation = await question(confirmMsg);

        if (confirmation.toLowerCase() !== 'y' && confirmation.toLowerCase() !== 'yes') {
          console.log('🚫 Push cancelled.');
          return;
        }
      }

      await executeMediaPush(operations, false);
    }

  } catch (err: any) {
    error(`Media push failed: ${err.message}`);
    throw err;
  } finally {
    // Always close readline interface
    rl.close();
  }
}

/**
 * Status-only function (no modifications)
 */
export async function statusMedia(options: { scopeUid?: string; showDelete?: boolean } = {}): Promise<void> {
  try {
    const config = loadConfig();

    const mediaDir = path.resolve(process.cwd(), config.mediaDir || 'media');

    info(`Scanning local media: ${mediaDir}`);
    const localFiles = scanLocalMedia(mediaDir, config);

    if (localFiles.length === 0) {
      warn('No media files found locally.');
      return;
    }

    info(`Fetching remote media from LeadCMS...`);
    const remoteFiles = await fetchRemoteMedia();

    let filteredLocal = localFiles;
    let filteredRemote = remoteFiles;

    if (options.scopeUid) {
      filteredLocal = localFiles.filter(f => f.scopeUid === options.scopeUid);
      filteredRemote = remoteFiles.filter(f => f.scopeUid === options.scopeUid);
    }

    // Show deletes only if showDelete flag is provided
    const operations = matchMediaFiles(filteredLocal, filteredRemote, options.showDelete || false);
    displayMediaStatus(operations, false, options.showDelete || false);

  } catch (err: any) {
    error(`Media status check failed: ${err.message}`);
    throw err;
  }
}
