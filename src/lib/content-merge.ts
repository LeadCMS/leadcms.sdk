/**
 * Three-way merge utilities for LeadCMS content
 *
 * Uses the node-diff3 library to perform git-style three-way merges between
 * a base version, a local version, and a remote version of content files.
 *
 * For JSON content, a structural (field-level) merge is used instead of
 * line-based diff to avoid false conflicts from adjacent line changes.
 *
 * The base version comes from the server via the sync API (the state of the
 * content at the time of the client's last sync token). This avoids needing
 * any local storage of base snapshots.
 */

import { diff3Merge } from 'node-diff3';

/**
 * Result of a three-way content merge
 */
export interface MergeResult {
  /** Whether the merge completed without conflicts */
  success: boolean;
  /** The merged content (may contain conflict markers if success is false) */
  merged: string;
  /** Whether there were conflicts that require manual resolution */
  hasConflicts: boolean;
  /** Number of conflict regions found */
  conflictCount: number;
}

/**
 * Fields that are controlled by the server and should always take the remote
 * value during merge, even if they differ between base and local.
 * These fields are set/updated by the server automatically and should never
 * be treated as meaningful local edits.
 */
const SERVER_CONTROLLED_FIELDS = new Set([
  'updatedAt',
  'createdAt',
  'publishedAt',
]);

/**
 * Regex to match a YAML frontmatter line for a server-controlled field.
 * Matches lines like:
 *   updatedAt: "2026-02-01T00:00:00Z"
 *   createdAt: "2026-01-01T00:00:00Z"
 *   updatedAt: 2026-02-01T00:00:00Z
 */
const SERVER_CONTROLLED_YAML_LINE = /^\s*(updatedAt|createdAt|publishedAt)\s*:/;

/**
 * Perform a three-way merge between base, local, and remote content.
 *
 * This works like git merge:
 * - Changes that don't overlap are merged automatically
 * - Changes that modify the same lines produce conflict markers
 * - Server-controlled fields (updatedAt, createdAt, publishedAt) in YAML frontmatter
 *   are auto-resolved to the remote value, never producing conflicts
 *
 * For JSON content, prefer threeWayMergeJson() which does structural merging
 * and avoids false conflicts from adjacent line changes.
 *
 * @param base   - The original content at the time of last sync (from server's baseItems)
 * @param local  - The current local file content (possibly user-modified)
 * @param remote - The current remote content (fetched from server)
 * @returns MergeResult with merged content and conflict information
 */
export function threeWayMerge(base: string, local: string, remote: string): MergeResult {
  const baseLines = base.split('\n');
  const localLines = local.split('\n');
  const remoteLines = remote.split('\n');

  const regions = diff3Merge(localLines, baseLines, remoteLines);

  let conflictCount = 0;
  const resultLines: string[] = [];

  for (const region of regions) {
    if ('ok' in region && region.ok) {
      resultLines.push(...region.ok);
    } else if ('conflict' in region && region.conflict) {
      const localConflictLines = region.conflict.a;
      const remoteConflictLines = region.conflict.b;

      // Try to auto-resolve server-controlled fields within the conflict
      const resolved = resolveServerControlledConflict(localConflictLines, remoteConflictLines);

      if (resolved.remainingConflict) {
        // There are still real conflicts after extracting server-controlled fields
        conflictCount++;
        resultLines.push(...resolved.resolvedLines);
        resultLines.push('<<<<<<< local');
        resultLines.push(...resolved.remainingConflict.local);
        resultLines.push('=======');
        resultLines.push(...resolved.remainingConflict.remote);
        resultLines.push('>>>>>>> remote');
      } else {
        // All lines in this conflict were server-controlled → fully auto-resolved
        resultLines.push(...resolved.resolvedLines);
      }
    }
  }

  const merged = resultLines.join('\n');

  return {
    success: conflictCount === 0,
    merged,
    hasConflicts: conflictCount > 0,
    conflictCount,
  };
}

/**
 * Attempt to auto-resolve server-controlled fields within a conflict region.
 *
 * For each line in the conflict, if it's a server-controlled YAML field
 * (updatedAt, createdAt, publishedAt), replace the local version with the
 * remote version **in-place**, preserving the original field ordering.
 *
 * This avoids extracting server-controlled lines and placing them before
 * the conflict markers, which would shift field positions and cause
 * duplication on subsequent merges when diff3 can't reconcile the reordering.
 *
 * Returns:
 * - resolvedLines: the final merged lines if fully resolved (no remaining conflict)
 * - remainingConflict: null if fully resolved, or { local, remote } with
 *   both sides — server-controlled fields already harmonized to remote values
 *   in the local side so the user can pick either side safely
 */
function resolveServerControlledConflict(
  localLines: string[],
  remoteLines: string[]
): {
  resolvedLines: string[];
  remainingConflict: { local: string[]; remote: string[] } | null;
} {
  // Build a map of remote server-controlled field values by field name
  const remoteServerFieldValues = new Map<string, string>();
  for (const line of remoteLines) {
    if (SERVER_CONTROLLED_YAML_LINE.test(line)) {
      const match = line.match(/^\s*(\w+)\s*:/);
      if (match) {
        remoteServerFieldValues.set(match[1], line);
      }
    }
  }

  // Replace server-controlled fields in local lines with remote values in-place,
  // preserving the original line order
  const resolvedLocal = localLines.map(line => {
    if (SERVER_CONTROLLED_YAML_LINE.test(line)) {
      const match = line.match(/^\s*(\w+)\s*:/);
      if (match && remoteServerFieldValues.has(match[1])) {
        return remoteServerFieldValues.get(match[1])!;
      }
    }
    return line;
  });

  // Check if after resolving server-controlled fields, local and remote are identical
  const isFullyResolved =
    resolvedLocal.length === remoteLines.length &&
    resolvedLocal.every((line, i) => line === remoteLines[i]);

  if (isFullyResolved) {
    // All differences were server-controlled → fully resolved, emit remote lines
    return { resolvedLines: remoteLines, remainingConflict: null };
  }

  // Still have real conflict — emit as conflict with server-controlled fields
  // already harmonized to remote values in-place (no extracted lines before markers)
  return {
    resolvedLines: [],
    remainingConflict: { local: resolvedLocal, remote: remoteLines },
  };
}

/**
 * Result of a structural field-level merge for a single value.
 */
interface FieldMergeResult {
  value: any;
  conflicted: boolean;
}

interface JsonConflictValue {
  __leadcmsConflict: true;
  local: any;
  remote: any;
}

function createJsonConflictValue(local: any, remote: any): JsonConflictValue {
  return { __leadcmsConflict: true, local, remote };
}

function isJsonConflictValue(value: any): value is JsonConflictValue {
  return Boolean(value && typeof value === 'object' && value.__leadcmsConflict === true);
}

function cloneWithConflictPlaceholders(value: any, placeholders: Map<string, JsonConflictValue>, state: { index: number }): any {
  if (isJsonConflictValue(value)) {
    const key = `__LEADCMS_CONFLICT_${state.index++}__`;
    placeholders.set(key, value);
    return key;
  }

  if (Array.isArray(value)) {
    return value.map(item => cloneWithConflictPlaceholders(item, placeholders, state));
  }

  if (value !== null && typeof value === 'object') {
    const cloned: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      cloned[key] = cloneWithConflictPlaceholders(val, placeholders, state);
    }
    return cloned;
  }

  return value;
}

function indentMultiline(text: string, indent: string): string {
  return text
    .split('\n')
    .map(line => `${indent}${line}`)
    .join('\n');
}

function addCommaToLastLine(block: string): string {
  const lines = block.split('\n');
  if (lines.length === 0) return block;
  lines[lines.length - 1] = `${lines[lines.length - 1]},`;
  return lines.join('\n');
}

function renderJsonConflictMarkers(mergedWithPlaceholders: string, placeholders: Map<string, JsonConflictValue>): string {
  const lines = mergedWithPlaceholders.split('\n');
  const output: string[] = [];

  for (const line of lines) {
    const propertyMatch = line.match(/^(\s*"[^"]+": )"(__LEADCMS_CONFLICT_\d+__)"(,?)$/);
    const arrayMatch = line.match(/^(\s*)"(__LEADCMS_CONFLICT_\d+__)"(,?)$/);

    if (!propertyMatch && !arrayMatch) {
      output.push(line);
      continue;
    }

    const isProperty = Boolean(propertyMatch);
    const prefix = isProperty ? propertyMatch![1] : arrayMatch![1];
    const token = isProperty ? propertyMatch![2] : arrayMatch![2];
    const trailingComma = (isProperty ? propertyMatch![3] : arrayMatch![3]) === ',';
    const conflict = placeholders.get(token);

    if (!conflict) {
      output.push(line);
      continue;
    }

    const markerIndent = prefix.match(/^\s*/)?.[0] ?? '';
    const valueIndent = `${markerIndent}  `;
    let localJson = indentMultiline(JSON.stringify(conflict.local, null, 2), valueIndent);
    let remoteJson = indentMultiline(JSON.stringify(conflict.remote, null, 2), valueIndent);

    if (trailingComma) {
      localJson = addCommaToLastLine(localJson);
      remoteJson = addCommaToLastLine(remoteJson);
    }

    let block = isProperty
      ? `${prefix}\n<<<<<<< local\n${localJson}\n=======\n${remoteJson}\n>>>>>>> remote`
      : `<<<<<<< local\n${localJson}\n=======\n${remoteJson}\n>>>>>>> remote`;

    output.push(block);
  }

  return output.join('\n');
}

/**
 * Perform a structural three-way merge on JSON content.
 *
 * Instead of doing a line-based diff (which produces false conflicts for
 * adjacent field changes), this parses the JSON and merges field-by-field:
 *
 * - Fields changed only locally → keep local value
 * - Fields changed only remotely → take remote value
 * - Fields changed identically on both sides → take either (same value)
 * - Fields changed differently on both sides → conflict
 * - Server-controlled fields (updatedAt, createdAt, publishedAt) → always take remote
 *
 * For nested objects, the merge recurses into each level.
 *
 * @param base   - The base JSON content (from server's baseItems, transformed to local format)
 * @param local  - The current local JSON file content
 * @param remote - The current remote JSON content (transformed to local format)
 * @returns MergeResult with the merged JSON string
 */
export function threeWayMergeJson(base: string, local: string, remote: string): MergeResult {
  let baseObj: any;
  let localObj: any;
  let remoteObj: any;

  try {
    baseObj = JSON.parse(base);
    localObj = JSON.parse(local);
    remoteObj = JSON.parse(remote);
  } catch {
    // If any version is not valid JSON, fall back to line-based merge
    return threeWayMerge(base, local, remote);
  }

  const { value: mergedObj, conflicted, conflictCount } = mergeValues(baseObj, localObj, remoteObj);

  const placeholders = new Map<string, JsonConflictValue>();
  const mergedWithPlaceholders = JSON.stringify(
    cloneWithConflictPlaceholders(mergedObj, placeholders, { index: 0 }),
    null,
    2
  );
  const merged = renderJsonConflictMarkers(mergedWithPlaceholders, placeholders);

  return {
    success: !conflicted,
    merged,
    hasConflicts: conflicted,
    conflictCount,
  };
}

/**
 * Recursively merge three values (base, local, remote).
 * Returns the merged value and whether any conflicts were found.
 */
function mergeValues(base: any, local: any, remote: any): FieldMergeResult & { conflictCount: number } {
  // If both local and remote are objects (not arrays), merge field by field
  if (isPlainObject(base) && isPlainObject(local) && isPlainObject(remote)) {
    return mergeObjects(base, local, remote);
  }

  // For non-object values (primitives, arrays, etc.): compare as JSON strings
  const baseStr = JSON.stringify(base);
  const localStr = JSON.stringify(local);
  const remoteStr = JSON.stringify(remote);

  if (baseStr === localStr && baseStr === remoteStr) {
    // No changes
    return { value: local, conflicted: false, conflictCount: 0 };
  }

  if (baseStr === localStr) {
    // Only remote changed → take remote
    return { value: remote, conflicted: false, conflictCount: 0 };
  }

  if (baseStr === remoteStr) {
    // Only local changed → keep local
    return { value: local, conflicted: false, conflictCount: 0 };
  }

  if (localStr === remoteStr) {
    // Both changed identically → take either
    return { value: local, conflicted: false, conflictCount: 0 };
  }

  // Both changed differently → conflict
  // Use an internal conflict marker that will be rendered as real
  // git-style conflict text markers in the final serialized output.
  return {
    value: createJsonConflictValue(local, remote),
    conflicted: true,
    conflictCount: 1,
  };
}

/**
 * Merge three plain objects field by field.
 */
function mergeObjects(
  base: Record<string, any>,
  local: Record<string, any>,
  remote: Record<string, any>
): FieldMergeResult & { conflictCount: number } {
  const allKeys = new Set([
    ...Object.keys(base),
    ...Object.keys(local),
    ...Object.keys(remote),
  ]);

  const merged: Record<string, any> = {};
  let hasConflict = false;
  let totalConflicts = 0;

  for (const key of allKeys) {
    const inBase = key in base;
    const inLocal = key in local;
    const inRemote = key in remote;

    // Server-controlled fields: always take remote value
    if (SERVER_CONTROLLED_FIELDS.has(key)) {
      if (inRemote) {
        merged[key] = remote[key];
      } else if (inLocal) {
        merged[key] = local[key];
      }
      // If only in base, it was deleted from both → omit
      continue;
    }

    if (inBase && inLocal && inRemote) {
      // Key exists in all three — merge the values
      const result = mergeValues(base[key], local[key], remote[key]);
      merged[key] = result.value;
      if (result.conflicted) {
        hasConflict = true;
        totalConflicts += result.conflictCount;
      }
    } else if (!inBase && inLocal && inRemote) {
      // Key added by both sides
      const result = mergeValues(undefined, local[key], remote[key]);
      merged[key] = result.value;
      if (result.conflicted) {
        hasConflict = true;
        totalConflicts += result.conflictCount;
      }
    } else if (!inBase && inLocal && !inRemote) {
      // Key added only locally → keep
      merged[key] = local[key];
    } else if (!inBase && !inLocal && inRemote) {
      // Key added only remotely → take
      merged[key] = remote[key];
    } else if (inBase && !inLocal && inRemote) {
      // Key deleted locally — check if remote also changed it
      const baseStr = JSON.stringify(base[key]);
      const remoteStr = JSON.stringify(remote[key]);
      if (baseStr === remoteStr) {
        // Remote didn't change it, local deleted it → keep deleted (omit)
      } else {
        // Remote changed it but local deleted it → conflict, prefer remote
        merged[key] = remote[key];
        hasConflict = true;
        totalConflicts++;
      }
    } else if (inBase && inLocal && !inRemote) {
      // Key deleted remotely — check if local also changed it
      const baseStr = JSON.stringify(base[key]);
      const localStr = JSON.stringify(local[key]);
      if (baseStr === localStr) {
        // Local didn't change it, remote deleted it → keep deleted (omit)
      } else {
        // Local changed it but remote deleted it → conflict, prefer local
        merged[key] = local[key];
        hasConflict = true;
        totalConflicts++;
      }
    } else if (inBase && !inLocal && !inRemote) {
      // Deleted by both sides → omit
    }
  }

  return { value: merged, conflicted: hasConflict, conflictCount: totalConflicts };
}

/**
 * Check if a value is a plain object (not array, null, Date, etc.)
 */
function isPlainObject(value: any): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Determine whether a local file has been modified compared to the base version.
 *
 * This is used to decide whether three-way merge is needed:
 * - If local === base  → local is unmodified, safe to overwrite with remote
 * - If local !== base  → local was modified, need three-way merge
 *
 * Uses timestamp normalization to avoid false positives from precision differences
 * (e.g. server returns 7 decimal places but local file has 6).
 *
 * @param base  - The base content (from server's baseItems, transformed to local format)
 * @param local - The current local file content
 * @returns true if local content differs from base
 */
export function isLocallyModified(base: string, local: string): boolean {
  return normalizeForMergeComparison(base) !== normalizeForMergeComparison(local);
}

/**
 * Normalize content for merge comparison.
 * Handles trivial whitespace and timestamp precision differences that shouldn't
 * trigger a merge.
 */
function normalizeForMergeComparison(content: string): string {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/\s+\n/g, '\n')
    // Normalize ISO timestamp precision: truncate fractional seconds to 6 decimal
    // places (microsecond precision) then strip trailing zeros.
    // e.g. "2026-02-13T10:32:20.2939836Z" → "2026-02-13T10:32:20.293983Z"
    // This prevents false diffs from servers returning 7-digit precision while
    // local serializers use 6-digit precision.
    .replace(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,6})\d*Z/g, '$1Z')
    .replace(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+?)0+Z/g, '$1Z')
    .trimEnd();
}
