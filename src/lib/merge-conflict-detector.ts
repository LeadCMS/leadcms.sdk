/**
 * Merge conflict detection for content files.
 *
 * Detects unresolved Git merge conflict markers in file content to prevent
 * accidentally pushing broken content to LeadCMS.
 */

/**
 * Standard Git merge conflict marker patterns.
 * A valid merge conflict contains all three markers: <<<<<<<, =======, >>>>>>>
 */
const CONFLICT_START = /^<{7}\s/m;
const CONFLICT_SEPARATOR = /^={7}$/m;
const CONFLICT_END = /^>{7}\s/m;

/**
 * Check whether file content contains unresolved Git merge conflict markers.
 *
 * Returns true only when all three standard markers are present:
 * - `<<<<<<< ` (conflict start)
 * - `=======` (separator)
 * - `>>>>>>> ` (conflict end)
 *
 * This avoids false positives for content that only coincidentally
 * contains one of the markers (e.g. code samples showing a single marker).
 */
export function hasMergeConflictMarkers(content: string): boolean {
    return (
        CONFLICT_START.test(content) &&
        CONFLICT_SEPARATOR.test(content) &&
        CONFLICT_END.test(content)
    );
}
