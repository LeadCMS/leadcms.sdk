/**
 * Tests for the three-way content merge utility
 *
 * Tests cover:
 * - Clean merges (non-overlapping changes)
 * - Conflict detection (overlapping changes)
 * - Local modification detection
 * - Edge cases (empty content, identical content, etc.)
 * - MDX frontmatter merging
 * - JSON content merging
 */

import { threeWayMerge, threeWayMergeJson, isLocallyModified, MergeResult } from '../src/lib/content-merge';

describe('content-merge', () => {
  describe('threeWayMerge', () => {
    it('should return the remote when local is unchanged', () => {
      const base = 'line1\nline2\nline3';
      const local = 'line1\nline2\nline3';
      const remote = 'line1\nmodified\nline3';

      const result = threeWayMerge(base, local, remote);

      expect(result.success).toBe(true);
      expect(result.hasConflicts).toBe(false);
      expect(result.conflictCount).toBe(0);
      expect(result.merged).toBe('line1\nmodified\nline3');
    });

    it('should return the local when remote is unchanged', () => {
      const base = 'line1\nline2\nline3';
      const local = 'line1\nlocal change\nline3';
      const remote = 'line1\nline2\nline3';

      const result = threeWayMerge(base, local, remote);

      expect(result.success).toBe(true);
      expect(result.hasConflicts).toBe(false);
      expect(result.merged).toBe('line1\nlocal change\nline3');
    });

    it('should auto-merge non-overlapping changes', () => {
      const base = 'line1\nline2\nline3\nline4\nline5';
      const local = 'line1\nlocal change\nline3\nline4\nline5';
      const remote = 'line1\nline2\nline3\nline4\nremote change';

      const result = threeWayMerge(base, local, remote);

      expect(result.success).toBe(true);
      expect(result.hasConflicts).toBe(false);
      expect(result.conflictCount).toBe(0);
      expect(result.merged).toBe('line1\nlocal change\nline3\nline4\nremote change');
    });

    it('should detect and mark conflicts for overlapping changes', () => {
      const base = 'line1\noriginal\nline3';
      const local = 'line1\nlocal version\nline3';
      const remote = 'line1\nremote version\nline3';

      const result = threeWayMerge(base, local, remote);

      expect(result.success).toBe(false);
      expect(result.hasConflicts).toBe(true);
      expect(result.conflictCount).toBe(1);
      expect(result.merged).toContain('<<<<<<< local');
      expect(result.merged).toContain('local version');
      expect(result.merged).toContain('=======');
      expect(result.merged).toContain('remote version');
      expect(result.merged).toContain('>>>>>>> remote');
    });

    it('should handle identical changes from both sides (false conflict)', () => {
      const base = 'line1\noriginal\nline3';
      const local = 'line1\nsame change\nline3';
      const remote = 'line1\nsame change\nline3';

      const result = threeWayMerge(base, local, remote);

      expect(result.success).toBe(true);
      expect(result.hasConflicts).toBe(false);
      expect(result.merged).toBe('line1\nsame change\nline3');
    });

    it('should handle multiple non-overlapping changes', () => {
      const base = 'a\nb\nc\nd\ne\nf\ng';
      const local = 'a\nB\nc\nd\ne\nf\ng';
      const remote = 'a\nb\nc\nd\ne\nF\ng';

      const result = threeWayMerge(base, local, remote);

      expect(result.success).toBe(true);
      expect(result.merged).toBe('a\nB\nc\nd\ne\nF\ng');
    });

    it('should handle multiple conflicts', () => {
      const base = 'a\nb\nc\nd\ne';
      const local = 'A\nb\nc\nd\nE';
      const remote = 'X\nb\nc\nd\nY';

      const result = threeWayMerge(base, local, remote);

      expect(result.success).toBe(false);
      expect(result.conflictCount).toBe(2);
    });

    it('should handle empty base (all content is new)', () => {
      const base = '';
      const local = 'local content';
      const remote = 'remote content';

      const result = threeWayMerge(base, local, remote);

      // Both sides added content where none existed — this is a conflict
      expect(result.hasConflicts).toBe(true);
    });

    it('should handle all three versions being identical', () => {
      const content = 'line1\nline2\nline3';

      const result = threeWayMerge(content, content, content);

      expect(result.success).toBe(true);
      expect(result.hasConflicts).toBe(false);
      expect(result.merged).toBe(content);
    });

    it('should handle local additions', () => {
      const base = 'line1\nline2';
      const local = 'line1\nline2\nnew local line';
      const remote = 'line1\nline2';

      const result = threeWayMerge(base, local, remote);

      expect(result.success).toBe(true);
      expect(result.merged).toContain('new local line');
    });

    it('should handle remote additions', () => {
      const base = 'line1\nline2';
      const local = 'line1\nline2';
      const remote = 'line1\nline2\nnew remote line';

      const result = threeWayMerge(base, local, remote);

      expect(result.success).toBe(true);
      expect(result.merged).toContain('new remote line');
    });

    it('should handle local deletions', () => {
      const base = 'line1\nline2\nline3';
      const local = 'line1\nline3';
      const remote = 'line1\nline2\nline3';

      const result = threeWayMerge(base, local, remote);

      expect(result.success).toBe(true);
      expect(result.merged).toBe('line1\nline3');
    });

    it('should handle remote deletions', () => {
      const base = 'line1\nline2\nline3';
      const local = 'line1\nline2\nline3';
      const remote = 'line1\nline3';

      const result = threeWayMerge(base, local, remote);

      expect(result.success).toBe(true);
      expect(result.merged).toBe('line1\nline3');
    });

    // --- MDX-specific merge scenarios ---

    it('should auto-merge MDX frontmatter and body changes', () => {
      const base = [
        '---',
        'title: Original Title',
        'slug: my-post',
        'description: Original description',
        '---',
        '',
        'Original body content.',
      ].join('\n');

      const local = [
        '---',
        'title: Original Title',
        'slug: my-post',
        'description: Updated local description',
        '---',
        '',
        'Original body content.',
      ].join('\n');

      const remote = [
        '---',
        'title: Original Title',
        'slug: my-post',
        'description: Original description',
        '---',
        '',
        'Updated remote body content.',
      ].join('\n');

      const result = threeWayMerge(base, local, remote);

      expect(result.success).toBe(true);
      expect(result.merged).toContain('Updated local description');
      expect(result.merged).toContain('Updated remote body content.');
    });

    it('should conflict when both sides change the same frontmatter field', () => {
      const base = [
        '---',
        'title: Original Title',
        'slug: my-post',
        '---',
        '',
        'Body content.',
      ].join('\n');

      const local = [
        '---',
        'title: Local Title',
        'slug: my-post',
        '---',
        '',
        'Body content.',
      ].join('\n');

      const remote = [
        '---',
        'title: Remote Title',
        'slug: my-post',
        '---',
        '',
        'Body content.',
      ].join('\n');

      const result = threeWayMerge(base, local, remote);

      expect(result.hasConflicts).toBe(true);
      expect(result.merged).toContain('<<<<<<< local');
      expect(result.merged).toContain('Local Title');
      expect(result.merged).toContain('Remote Title');
    });

    // --- MDX server-controlled field scenarios ---

    it('should auto-accept remote updatedAt in MDX frontmatter without conflict', () => {
      const base = [
        '---',
        'title: My Post',
        'updatedAt: "2026-01-01T00:00:00Z"',
        '---',
        '',
        'Body content.',
      ].join('\n');

      const local = [
        '---',
        'title: My Post',
        'updatedAt: "2026-01-01T00:00:00Z"',
        '---',
        '',
        'Body content.',
      ].join('\n');

      const remote = [
        '---',
        'title: My Post',
        'updatedAt: "2026-02-01T00:00:00Z"',
        '---',
        '',
        'Body content.',
      ].join('\n');

      const result = threeWayMerge(base, local, remote);

      expect(result.success).toBe(true);
      expect(result.hasConflicts).toBe(false);
      expect(result.merged).toContain('updatedAt: "2026-02-01T00:00:00Z"');
    });

    it('should auto-accept remote updatedAt even when local also changed it in MDX', () => {
      const base = [
        '---',
        'title: My Post',
        'updatedAt: "2026-01-01T00:00:00Z"',
        '---',
        '',
        'Body content.',
      ].join('\n');

      const local = [
        '---',
        'title: My Post',
        'updatedAt: "2026-01-15T00:00:00Z"',
        '---',
        '',
        'Body content.',
      ].join('\n');

      const remote = [
        '---',
        'title: My Post',
        'updatedAt: "2026-02-01T00:00:00Z"',
        '---',
        '',
        'Body content.',
      ].join('\n');

      const result = threeWayMerge(base, local, remote);

      // Should NOT conflict — updatedAt always takes remote
      expect(result.success).toBe(true);
      expect(result.hasConflicts).toBe(false);
      expect(result.merged).toContain('updatedAt: "2026-02-01T00:00:00Z"');
      expect(result.merged).not.toContain('<<<<<<< local');
    });

    it('should auto-accept remote createdAt in MDX frontmatter without conflict', () => {
      const base = [
        '---',
        'title: My Post',
        'createdAt: "2026-01-01T00:00:00Z"',
        '---',
        '',
        'Body.',
      ].join('\n');

      const local = [
        '---',
        'title: My Post',
        'createdAt: "2026-01-01T00:00:00.0000000Z"',
        '---',
        '',
        'Body.',
      ].join('\n');

      const remote = [
        '---',
        'title: My Post',
        'createdAt: "2026-01-01T00:00:00.1234567Z"',
        '---',
        '',
        'Body.',
      ].join('\n');

      const result = threeWayMerge(base, local, remote);

      expect(result.success).toBe(true);
      expect(result.hasConflicts).toBe(false);
      expect(result.merged).toContain('createdAt: "2026-01-01T00:00:00.1234567Z"');
    });

    it('should auto-accept remote publishedAt in MDX frontmatter without conflict', () => {
      const base = [
        '---',
        'title: My Post',
        'publishedAt: "2026-01-01T00:00:00Z"',
        '---',
        '',
        'Body.',
      ].join('\n');

      const local = [
        '---',
        'title: My Post',
        'publishedAt: "2026-01-01T00:00:00Z"',
        '---',
        '',
        'Body.',
      ].join('\n');

      const remote = [
        '---',
        'title: My Post',
        'publishedAt: "2026-03-01T00:00:00Z"',
        '---',
        '',
        'Body.',
      ].join('\n');

      const result = threeWayMerge(base, local, remote);

      expect(result.success).toBe(true);
      expect(result.hasConflicts).toBe(false);
      expect(result.merged).toContain('publishedAt: "2026-03-01T00:00:00Z"');
    });

    it('should auto-accept remote updatedAt while preserving real conflicts in MDX', () => {
      const base = [
        '---',
        'title: Original',
        'updatedAt: "2026-01-01T00:00:00Z"',
        '---',
        '',
        'Body.',
      ].join('\n');

      const local = [
        '---',
        'title: Local Title',
        'updatedAt: "2026-01-15T00:00:00Z"',
        '---',
        '',
        'Body.',
      ].join('\n');

      const remote = [
        '---',
        'title: Remote Title',
        'updatedAt: "2026-02-01T00:00:00Z"',
        '---',
        '',
        'Body.',
      ].join('\n');

      const result = threeWayMerge(base, local, remote);

      // title conflict should remain, but updatedAt should auto-resolve to remote
      expect(result.hasConflicts).toBe(true);
      expect(result.merged).toContain('updatedAt: "2026-02-01T00:00:00Z"');
      // The conflict should be about title, not updatedAt
      expect(result.merged).toContain('Local Title');
      expect(result.merged).toContain('Remote Title');
    });

    it('should handle updatedAt + adjacent field changes in MDX without false conflict', () => {
      const base = [
        '---',
        'title: My Post',
        'description: Original desc',
        'updatedAt: "2026-01-01T00:00:00Z"',
        'author: John',
        '---',
        '',
        'Body.',
      ].join('\n');

      const local = [
        '---',
        'title: My Post',
        'description: Local desc',
        'updatedAt: "2026-01-01T00:00:00Z"',
        'author: John',
        '---',
        '',
        'Body.',
      ].join('\n');

      const remote = [
        '---',
        'title: My Post',
        'description: Original desc',
        'updatedAt: "2026-02-01T00:00:00Z"',
        'author: Jane',
        '---',
        '',
        'Body.',
      ].join('\n');

      const result = threeWayMerge(base, local, remote);

      // updatedAt should always be auto-resolved to remote — no conflict on that field
      expect(result.merged).toContain('updatedAt: "2026-02-01T00:00:00Z"');
      expect(result.merged).not.toContain('updatedAt: "2026-01-01T00:00:00Z"');

      // Note: description + author are adjacent non-overlapping changes that diff3
      // coalesces into a single conflict region. This is a known diff3 limitation
      // for line-based merge. For JSON content, use threeWayMergeJson instead.
      // Server-controlled fields remain inside the conflict markers (in-place) with
      // the remote value on both sides. This preserves field ordering so subsequent
      // merges don't produce duplication.
      if (result.hasConflicts) {
        // If there's a conflict, updatedAt should have the SAME (remote) value on both sides
        const conflictRegex = /<<<<<<< local\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> remote/g;
        let match;
        while ((match = conflictRegex.exec(result.merged)) !== null) {
          // If updatedAt appears in the conflict, it must be the remote value on both sides
          if (match[1].includes('updatedAt') || match[2].includes('updatedAt')) {
            expect(match[1]).toContain('updatedAt: "2026-02-01T00:00:00Z"');
            expect(match[2]).toContain('updatedAt: "2026-02-01T00:00:00Z"');
          }
        }
      }
    });

    it('should not duplicate server-controlled fields when mixed with real conflicts', () => {
      // Scenario: publishedAt and updatedAt are adjacent to a conflicting field.
      // diff3 groups them into one conflict region. The auto-resolution must NOT
      // extract server-controlled lines and place them before the conflict markers,
      // because that shifts their position and causes duplication on the next merge.
      const base = [
        '---',
        'title: My Post',
        'description: Original desc',
        'publishedAt: "2026-01-01T00:00:00Z"',
        'updatedAt: "2026-01-01T00:00:00Z"',
        '---',
        '',
        'Body.',
      ].join('\n');

      const local = [
        '---',
        'title: My Post',
        'description: Local desc',
        'publishedAt: "2026-01-01T00:00:00.1234567Z"',
        'updatedAt: "2026-01-01T00:00:00Z"',
        '---',
        '',
        'Body.',
      ].join('\n');

      const remote = [
        '---',
        'title: My Post',
        'description: Remote desc',
        'publishedAt: "2026-01-01T00:00:00.9876543Z"',
        'updatedAt: "2026-02-01T00:00:00Z"',
        '---',
        '',
        'Body.',
      ].join('\n');

      const result = threeWayMerge(base, local, remote);

      // There should be a conflict on description (with server-controlled fields in-place)
      expect(result.hasConflicts).toBe(true);
      // Server-controlled fields should take remote values
      expect(result.merged).toContain('publishedAt: "2026-01-01T00:00:00.9876543Z"');
      expect(result.merged).toContain('updatedAt: "2026-02-01T00:00:00Z"');

      // Server-controlled fields appear on both sides of the conflict (with remote
      // values) to preserve field ordering. After resolving the conflict by picking
      // either side, they must appear exactly once.
      const resolvedLocal = result.merged
        .replace(/<<<<<<< local\n/, '')
        .replace(/=======\n[\s\S]*?>>>>>>> remote\n?/, '');
      const resolvedRemote = result.merged
        .replace(/<<<<<<< local\n[\s\S]*?=======\n/, '')
        .replace(/>>>>>>> remote\n?/, '');

      // CRITICAL: after resolving either way, no duplication
      expect((resolvedLocal.match(/updatedAt:/g) || []).length).toBe(1);
      expect((resolvedLocal.match(/publishedAt:/g) || []).length).toBe(1);
      expect((resolvedRemote.match(/updatedAt:/g) || []).length).toBe(1);
      expect((resolvedRemote.match(/publishedAt:/g) || []).length).toBe(1);
    });

    it('should not produce duplicates on consecutive merges after conflict resolution', () => {
      // Simulate: first merge has a mixed conflict, user resolves it, then
      // a second merge happens with updated server timestamps.
      // This is the exact scenario that was causing duplicate updatedAt lines.

      // --- First merge ---
      const base1 = [
        '---',
        'title: My Post',
        'description: Original',
        'publishedAt: "2026-01-01T00:00:00Z"',
        'updatedAt: "2026-01-01T00:00:00Z"',
        '---',
        '',
        'Body.',
      ].join('\n');

      const local1 = [
        '---',
        'title: My Post',
        'description: Local edit',
        'publishedAt: "2026-01-01T00:00:00.123Z"',
        'updatedAt: "2026-01-01T00:00:00Z"',
        '---',
        '',
        'Body.',
      ].join('\n');

      const remote1 = [
        '---',
        'title: My Post',
        'description: Remote edit',
        'publishedAt: "2026-01-01T00:00:00.456Z"',
        'updatedAt: "2026-02-01T00:00:00Z"',
        '---',
        '',
        'Body.',
      ].join('\n');

      const merge1 = threeWayMerge(base1, local1, remote1);
      expect(merge1.hasConflicts).toBe(true);

      // Simulate user resolving the conflict: pick local side
      // With in-place resolution, both sides of the conflict have server-controlled
      // fields with remote values. Pick the local side (first half of conflict).
      const resolved = merge1.merged
        .replace(/<<<<<<< local\n/, '')
        .replace(/=======\n[\s\S]*?>>>>>>> remote\n?/, '');

      // Verify no duplication after first merge resolution
      const updatedAtCount1 = (resolved.match(/updatedAt:/g) || []).length;
      expect(updatedAtCount1).toBe(1);
      // Verify field order is preserved (description before publishedAt before updatedAt)
      const descIdx = resolved.indexOf('description:');
      const pubIdx = resolved.indexOf('publishedAt:');
      const updIdx = resolved.indexOf('updatedAt:');
      expect(descIdx).toBeLessThan(pubIdx);
      expect(pubIdx).toBeLessThan(updIdx);

      // --- Second merge (after push + pull) ---
      // The resolved file is now "local", server sends new base and remote
      const base2 = remote1; // base is what server had at last sync
      const local2 = resolved; // user's resolved file
      const remote2 = [
        '---',
        'title: My Post',
        'description: Local edit',
        'publishedAt: "2026-01-01T00:00:00.456Z"',
        'updatedAt: "2026-02-15T00:00:00Z"',
        '---',
        '',
        'Body.',
      ].join('\n');

      const merge2 = threeWayMerge(base2, local2, remote2);

      // CRITICAL: no duplicate server-controlled fields after second merge
      const updatedAtCount2 = (merge2.merged.match(/updatedAt:/g) || []).length;
      const publishedAtCount2 = (merge2.merged.match(/publishedAt:/g) || []).length;
      expect(updatedAtCount2).toBe(1);
      expect(publishedAtCount2).toBe(1);
    });

    // --- JSON-specific merge scenarios ---

    it('should auto-merge non-overlapping JSON property changes', () => {
      const base = JSON.stringify({ id: 1, title: 'Original', description: 'Desc', body: 'Content' }, null, 2);
      const local = JSON.stringify({ id: 1, title: 'Local Title', description: 'Desc', body: 'Content' }, null, 2);
      const remote = JSON.stringify({ id: 1, title: 'Original', description: 'Desc', body: 'Updated Content' }, null, 2);

      const result = threeWayMerge(base, local, remote);

      expect(result.success).toBe(true);
      expect(result.merged).toContain('Local Title');
      expect(result.merged).toContain('Updated Content');
    });

    it('should conflict when both sides change the same JSON property', () => {
      const base = JSON.stringify({ id: 1, title: 'Original' }, null, 2);
      const local = JSON.stringify({ id: 1, title: 'Local' }, null, 2);
      const remote = JSON.stringify({ id: 1, title: 'Remote' }, null, 2);

      const result = threeWayMerge(base, local, remote);

      expect(result.hasConflicts).toBe(true);
      expect(result.conflictCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('isLocallyModified', () => {
    it('should return false for identical content', () => {
      const content = 'line1\nline2\nline3';
      expect(isLocallyModified(content, content)).toBe(false);
    });

    it('should return true for different content', () => {
      const base = 'line1\nline2\nline3';
      const local = 'line1\nmodified\nline3';
      expect(isLocallyModified(base, local)).toBe(true);
    });

    it('should ignore trailing whitespace differences', () => {
      const base = 'line1\nline2\nline3\n';
      const local = 'line1\nline2\nline3';
      expect(isLocallyModified(base, local)).toBe(false);
    });

    it('should ignore CRLF vs LF differences', () => {
      const base = 'line1\r\nline2\r\nline3';
      const local = 'line1\nline2\nline3';
      expect(isLocallyModified(base, local)).toBe(false);
    });

    it('should ignore trailing whitespace on lines', () => {
      const base = 'line1  \nline2  \nline3';
      const local = 'line1\nline2\nline3';
      expect(isLocallyModified(base, local)).toBe(false);
    });

    it('should detect actual content changes', () => {
      const base = 'title: Original\nslug: test';
      const local = 'title: Modified\nslug: test';
      expect(isLocallyModified(base, local)).toBe(true);
    });

    it('should detect added lines', () => {
      const base = 'line1\nline2';
      const local = 'line1\nline2\nline3';
      expect(isLocallyModified(base, local)).toBe(true);
    });

    it('should detect removed lines', () => {
      const base = 'line1\nline2\nline3';
      const local = 'line1\nline3';
      expect(isLocallyModified(base, local)).toBe(true);
    });

    it('should ignore timestamp precision differences (trailing zeros)', () => {
      const base = '{"updatedAt": "2026-02-13T10:32:20.2939836Z"}';
      const local = '{"updatedAt": "2026-02-13T10:32:20.293983Z"}';
      // The only difference is a trailing zero in fractional seconds — should not be treated as modified
      expect(isLocallyModified(base, local)).toBe(false);
    });

    it('should ignore trailing zeros in various timestamp fields', () => {
      const base = '{"createdAt": "2026-02-10T13:34:55.7102880Z", "updatedAt": "2026-02-13T10:32:20.29398360Z"}';
      const local = '{"createdAt": "2026-02-10T13:34:55.710288Z", "updatedAt": "2026-02-13T10:32:20.2939836Z"}';
      expect(isLocallyModified(base, local)).toBe(false);
    });
  });

  describe('threeWayMergeJson', () => {
    it('should auto-merge non-overlapping field changes', () => {
      const base = JSON.stringify({ id: 1, title: 'Original', description: 'Desc', body: 'Content' }, null, 2);
      const local = JSON.stringify({ id: 1, title: 'Local Title', description: 'Desc', body: 'Content' }, null, 2);
      const remote = JSON.stringify({ id: 1, title: 'Original', description: 'Desc', body: 'Updated Content' }, null, 2);

      const result = threeWayMergeJson(base, local, remote);

      expect(result.success).toBe(true);
      expect(result.hasConflicts).toBe(false);

      const merged = JSON.parse(result.merged);
      expect(merged.title).toBe('Local Title');
      expect(merged.body).toBe('Updated Content');
    });

    it('should auto-merge adjacent field changes without false conflicts', () => {
      const base = JSON.stringify({ a: 'A', b: 'B', c: 'C' }, null, 2);
      const local = JSON.stringify({ a: 'A', b: 'B-local', c: 'C' }, null, 2);
      const remote = JSON.stringify({ a: 'A-remote', b: 'B', c: 'C' }, null, 2);

      const result = threeWayMergeJson(base, local, remote);

      expect(result.success).toBe(true);
      const merged = JSON.parse(result.merged);
      expect(merged.a).toBe('A-remote');
      expect(merged.b).toBe('B-local');
    });

    it('should conflict when both sides change the same field differently', () => {
      const base = JSON.stringify({ id: 1, title: 'Original' }, null, 2);
      const local = JSON.stringify({ id: 1, title: 'Local' }, null, 2);
      const remote = JSON.stringify({ id: 1, title: 'Remote' }, null, 2);

      const result = threeWayMergeJson(base, local, remote);

      expect(result.hasConflicts).toBe(true);
      expect(result.conflictCount).toBe(1);
      expect(result.merged).toContain('<<<<<<< local');
      expect(result.merged).toContain('=======');
      expect(result.merged).toContain('>>>>>>> remote');
      expect(result.merged).not.toContain('"<<<<<<< local"');
      expect(result.merged).not.toContain('"======="');
      expect(result.merged).not.toContain('">>>>>>> remote"');
    });

    it('should not conflict when both sides make identical changes', () => {
      const base = JSON.stringify({ id: 1, title: 'Original' }, null, 2);
      const local = JSON.stringify({ id: 1, title: 'Same Change' }, null, 2);
      const remote = JSON.stringify({ id: 1, title: 'Same Change' }, null, 2);

      const result = threeWayMergeJson(base, local, remote);

      expect(result.success).toBe(true);
      const merged = JSON.parse(result.merged);
      expect(merged.title).toBe('Same Change');
    });

    it('should always take remote updatedAt (server-controlled field)', () => {
      const base = JSON.stringify({ id: 1, updatedAt: '2026-01-01T00:00:00Z' }, null, 2);
      const local = JSON.stringify({ id: 1, updatedAt: '2026-01-01T00:00:00Z' }, null, 2);
      const remote = JSON.stringify({ id: 1, updatedAt: '2026-02-01T00:00:00Z' }, null, 2);

      const result = threeWayMergeJson(base, local, remote);

      expect(result.success).toBe(true);
      const merged = JSON.parse(result.merged);
      expect(merged.updatedAt).toBe('2026-02-01T00:00:00Z');
    });

    it('should always take remote updatedAt even when local also changed it', () => {
      const base = JSON.stringify({ id: 1, updatedAt: '2026-01-01T00:00:00Z', title: 'T' }, null, 2);
      const local = JSON.stringify({ id: 1, updatedAt: '2026-01-15T00:00:00Z', title: 'T' }, null, 2);
      const remote = JSON.stringify({ id: 1, updatedAt: '2026-02-01T00:00:00Z', title: 'T' }, null, 2);

      const result = threeWayMergeJson(base, local, remote);

      // Should not conflict — updatedAt always takes remote
      expect(result.success).toBe(true);
      const merged = JSON.parse(result.merged);
      expect(merged.updatedAt).toBe('2026-02-01T00:00:00Z');
    });

    it('should always take remote createdAt (server-controlled field)', () => {
      const base = JSON.stringify({ id: 1, createdAt: '2026-01-01T00:00:00Z' }, null, 2);
      const local = JSON.stringify({ id: 1, createdAt: '2026-01-01T00:00:00Z' }, null, 2);
      const remote = JSON.stringify({ id: 1, createdAt: '2026-01-01T12:00:00Z' }, null, 2);

      const result = threeWayMergeJson(base, local, remote);

      expect(result.success).toBe(true);
      const merged = JSON.parse(result.merged);
      expect(merged.createdAt).toBe('2026-01-01T12:00:00Z');
    });

    it('should handle nested object merges', () => {
      const base = JSON.stringify({
        nested: { a: 1, b: 2, c: 3 },
        top: 'value',
      }, null, 2);
      const local = JSON.stringify({
        nested: { a: 1, b: 20, c: 3 },
        top: 'value',
      }, null, 2);
      const remote = JSON.stringify({
        nested: { a: 1, b: 2, c: 30 },
        top: 'value',
      }, null, 2);

      const result = threeWayMergeJson(base, local, remote);

      expect(result.success).toBe(true);
      const merged = JSON.parse(result.merged);
      expect(merged.nested.b).toBe(20);  // local change
      expect(merged.nested.c).toBe(30);  // remote change
    });

    it('should handle field additions from both sides', () => {
      const base = JSON.stringify({ id: 1 }, null, 2);
      const local = JSON.stringify({ id: 1, localField: 'added' }, null, 2);
      const remote = JSON.stringify({ id: 1, remoteField: 'added' }, null, 2);

      const result = threeWayMergeJson(base, local, remote);

      expect(result.success).toBe(true);
      const merged = JSON.parse(result.merged);
      expect(merged.localField).toBe('added');
      expect(merged.remoteField).toBe('added');
    });

    it('should handle field deletion by local when remote unchanged', () => {
      const base = JSON.stringify({ id: 1, toDelete: 'value', keep: 'yes' }, null, 2);
      const local = JSON.stringify({ id: 1, keep: 'yes' }, null, 2);
      const remote = JSON.stringify({ id: 1, toDelete: 'value', keep: 'yes' }, null, 2);

      const result = threeWayMergeJson(base, local, remote);

      expect(result.success).toBe(true);
      const merged = JSON.parse(result.merged);
      expect(merged.toDelete).toBeUndefined();
    });

    it('should handle field deletion by remote when local unchanged', () => {
      const base = JSON.stringify({ id: 1, toDelete: 'value', keep: 'yes' }, null, 2);
      const local = JSON.stringify({ id: 1, toDelete: 'value', keep: 'yes' }, null, 2);
      const remote = JSON.stringify({ id: 1, keep: 'yes' }, null, 2);

      const result = threeWayMergeJson(base, local, remote);

      expect(result.success).toBe(true);
      const merged = JSON.parse(result.merged);
      expect(merged.toDelete).toBeUndefined();
    });

    it('should handle all three versions being identical', () => {
      const content = JSON.stringify({ id: 1, name: 'test' }, null, 2);

      const result = threeWayMergeJson(content, content, content);

      expect(result.success).toBe(true);
      expect(result.hasConflicts).toBe(false);
      expect(result.merged).toBe(content);
    });

    it('should fall back to line-based merge for invalid JSON', () => {
      const base = 'not json';
      const local = 'not json either';
      const remote = 'also not json';

      const result = threeWayMergeJson(base, local, remote);

      // Falls back to line-based merge — which will conflict since all differ
      expect(result.hasConflicts).toBe(true);
    });

    it('should handle array value changes', () => {
      const base = JSON.stringify({ tags: ['a', 'b'] }, null, 2);
      const local = JSON.stringify({ tags: ['a', 'b'] }, null, 2);
      const remote = JSON.stringify({ tags: ['a', 'b', 'c'] }, null, 2);

      const result = threeWayMergeJson(base, local, remote);

      expect(result.success).toBe(true);
      const merged = JSON.parse(result.merged);
      expect(merged.tags).toEqual(['a', 'b', 'c']);
    });

    it('should conflict when both sides change arrays differently', () => {
      const base = JSON.stringify({ tags: ['a', 'b'] }, null, 2);
      const local = JSON.stringify({ tags: ['a', 'x'] }, null, 2);
      const remote = JSON.stringify({ tags: ['a', 'y'] }, null, 2);

      const result = threeWayMergeJson(base, local, remote);

      expect(result.hasConflicts).toBe(true);
      expect(result.merged).toContain('<<<<<<< local');
      expect(result.merged).toContain('>>>>>>> remote');
      expect(result.merged).not.toContain('"<<<<<<< local"');
    });

    it('should render nested object conflicts as top-level text markers (not JSON keys)', () => {
      const base = JSON.stringify({
        navigation: [
          { label: 'Services', href: '/public/services' },
          { label: 'Blog', href: '/public/blog' },
        ],
      }, null, 2);

      const local = JSON.stringify({
        navigation: [
          { label: 'Services', href: '/#services' },
          { label: 'Blog', href: '/public_de/blog' },
        ],
      }, null, 2);

      const remote = JSON.stringify({
        navigation: [
          { label: 'Services', href: '/public_en/services' },
          { label: 'Blog', href: '/public_en/blog' },
        ],
      }, null, 2);

      const result = threeWayMergeJson(base, local, remote);

      expect(result.hasConflicts).toBe(true);
      expect(result.merged).toContain('"navigation":');
      expect(result.merged).toContain('<<<<<<< local');
      expect(result.merged).toContain('>>>>>>> remote');
      expect(result.merged).toContain('/public_de/blog');
      expect(result.merged).toContain('/public_en/blog');
      expect(result.merged).not.toContain('"<<<<<<< local"');
      expect(result.merged).not.toContain('"======="');
      expect(result.merged).not.toContain('">>>>>>> remote"');
    });

    it('should keep trailing commas inside conflict sides (not on marker lines)', () => {
      const base = JSON.stringify({
        navigation: [
          { label: 'Services', href: '/public/services' },
          { label: 'Blog', href: '/public/blog' },
        ],
        id: 3,
      }, null, 2);

      const local = JSON.stringify({
        navigation: [
          { label: 'Services', href: '/#services' },
          { label: 'Blog', href: '/public_de/blog' },
        ],
        id: 3,
      }, null, 2);

      const remote = JSON.stringify({
        navigation: [
          { label: 'Services', href: '/public_en/services' },
          { label: 'Blog', href: '/public_en/blog' },
        ],
        id: 3,
      }, null, 2);

      const result = threeWayMergeJson(base, local, remote);

      expect(result.hasConflicts).toBe(true);
      expect(result.merged).toContain('<<<<<<< local');
      expect(result.merged).toContain('>>>>>>> remote');
      expect(result.merged).toContain('    ],\n=======');
      expect(result.merged).toContain('    ],\n>>>>>>> remote');
      expect(result.merged).not.toContain('>>>>>>> remote,');
    });
  });
});
