/**
 * Tests for merge conflict detection and push prevention.
 *
 * Covers:
 *  - hasMergeConflictMarkers: detecting standard Git conflict markers
 *  - validateMergeConflicts: filtering content items with unresolved conflicts
 *  - Push integration: verifying files with conflicts are skipped
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { jest } from '@jest/globals';
import { createTestConfig, createDataServiceMock } from './test-helpers';

jest.mock('../src/lib/config.js', () => ({
  getConfig: jest.fn(() => createTestConfig()),
}));

jest.mock('../src/lib/data-service.js', () => ({
  leadCMSDataService: createDataServiceMock(),
}));

import {
  hasMergeConflictMarkers,
  validateMergeConflicts,
} from '../src/scripts/push-leadcms-content';

describe('Merge Conflict Detection', () => {
  describe('hasMergeConflictMarkers', () => {
    it('should detect standard merge conflict markers in MDX body', () => {
      const content = `---
title: My Article
type: article
---

# Heading

Some content before the conflict.

<<<<<<< HEAD
This is the current version.
=======
This is the incoming version.
>>>>>>> feature-branch

More content after.
`;
      expect(hasMergeConflictMarkers(content)).toBe(true);
    });

    it('should detect merge conflict markers in JSON content', () => {
      const content = `{
  "title": "My Article",
  "type": "article",
<<<<<<< HEAD
  "description": "Current description",
=======
  "description": "Incoming description",
>>>>>>> feature-branch
  "body": "content"
}`;
      expect(hasMergeConflictMarkers(content)).toBe(true);
    });

    it('should detect merge conflict markers in frontmatter', () => {
      const content = `---
title: My Article
<<<<<<< HEAD
type: article
=======
type: page
>>>>>>> feature-branch
---

# Content body
`;
      expect(hasMergeConflictMarkers(content)).toBe(true);
    });

    it('should return false for clean content', () => {
      const content = `---
title: My Article
type: article
---

# Hello World

This is normal content without any conflicts.
`;
      expect(hasMergeConflictMarkers(content)).toBe(false);
    });

    it('should return false for empty content', () => {
      expect(hasMergeConflictMarkers('')).toBe(false);
    });

    it('should return false when only one marker is present', () => {
      // Only the start marker, not a real conflict
      const content = `---
title: Article
---

This line shows a start marker:
<<<<<<< example
But without the other markers it's not a real conflict.
`;
      expect(hasMergeConflictMarkers(content)).toBe(false);
    });

    it('should return false when only two markers are present', () => {
      // Start + separator but no end — incomplete conflict block
      const content = `---
title: Article
---

<<<<<<< HEAD
Some content
=======
Other content
`;
      expect(hasMergeConflictMarkers(content)).toBe(false);
    });

    it('should return false when separator is missing', () => {
      const content = `---
title: Article
---

<<<<<<< HEAD
Some content
>>>>>>> feature-branch
`;
      expect(hasMergeConflictMarkers(content)).toBe(false);
    });

    it('should detect multiple conflict blocks', () => {
      const content = `---
title: My Article
<<<<<<< HEAD
type: article
=======
type: page
>>>>>>> branch-1
---

# Content

<<<<<<< HEAD
First version paragraph.
=======
Second version paragraph.
>>>>>>> branch-1
`;
      expect(hasMergeConflictMarkers(content)).toBe(true);
    });

    it('should not false-positive on content discussing merge conflicts', () => {
      // Content that mentions conflict markers in prose/code but doesn't have
      // all three on their own lines — should be safe
      const content = `---
title: How to resolve merge conflicts
type: article
---

# Resolving Git Merge Conflicts

When you see \`<<<<<<< HEAD\` in your file, it means there is a conflict.
The \`=======\` separator divides the two versions.
The conflict ends with \`>>>>>>> branch-name\`.
`;
      // These markers are inline in backticks, not at beginning of line
      expect(hasMergeConflictMarkers(content)).toBe(false);
    });

    it('should detect conflict markers even with extra text after markers', () => {
      const content = `---
title: Test
---

<<<<<<< HEAD (some extra info)
=======
>>>>>>> abc123 (merge commit)
`;
      expect(hasMergeConflictMarkers(content)).toBe(true);
    });

    it('should not false-positive on equal signs in normal content', () => {
      const content = `---
title: My Article
type: article
---

# Table

| Feature | Support |
| ======= | ======= |
| Bold    | Yes     |
`;
      // The ======= line exists but without the other two markers
      expect(hasMergeConflictMarkers(content)).toBe(false);
    });
  });

  describe('validateMergeConflicts', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'leadcms-conflict-test-'));
    });

    afterEach(async () => {
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    function makeItem(slug: string, filePath: string) {
      return {
        slug,
        filePath,
        locale: 'en',
        type: 'article',
        metadata: { type: 'article', title: slug },
        body: '',
        isLocal: true as const,
      };
    }

    it('should return empty array when no files have conflicts', async () => {
      const cleanFile = path.join(tmpDir, 'clean.mdx');
      await fs.writeFile(cleanFile, `---\ntitle: Clean\ntype: article\n---\n\n# Clean content\n`);

      const items = [makeItem('clean', cleanFile)];
      const result = await (validateMergeConflicts as any)(items);
      expect(result).toHaveLength(0);
    });

    it('should detect files with conflict markers', async () => {
      const conflictFile = path.join(tmpDir, 'conflict.mdx');
      await fs.writeFile(conflictFile, `---
title: Conflict
type: article
---

<<<<<<< HEAD
Current version
=======
Incoming version
>>>>>>> feature
`);

      const items = [makeItem('conflict', conflictFile)];
      const result = await (validateMergeConflicts as any)(items);
      expect(result).toHaveLength(1);
      expect(result[0].slug).toBe('conflict');
    });

    it('should only return conflicted files from a mixed set', async () => {
      const cleanFile = path.join(tmpDir, 'clean.mdx');
      await fs.writeFile(cleanFile, `---\ntitle: Clean\ntype: article\n---\n\nClean content\n`);

      const conflictFile = path.join(tmpDir, 'conflict.mdx');
      await fs.writeFile(conflictFile, `---
title: Conflict
type: article
<<<<<<< HEAD
description: v1
=======
description: v2
>>>>>>> branch
---

Body
`);

      const anotherClean = path.join(tmpDir, 'another-clean.json');
      await fs.writeFile(anotherClean, JSON.stringify({ title: 'Clean JSON', type: 'page', body: 'hello' }));

      const items = [
        makeItem('clean', cleanFile),
        makeItem('conflict', conflictFile),
        makeItem('another-clean', anotherClean),
      ];

      const result = await (validateMergeConflicts as any)(items);
      expect(result).toHaveLength(1);
      expect(result[0].slug).toBe('conflict');
    });

    it('should detect conflicts in JSON files', async () => {
      const jsonFile = path.join(tmpDir, 'conflict.json');
      await fs.writeFile(jsonFile, `{
  "title": "Article",
<<<<<<< HEAD
  "description": "old",
=======
  "description": "new",
>>>>>>> main
  "body": "content"
}`);

      const items = [makeItem('conflict', jsonFile)];
      const result = await (validateMergeConflicts as any)(items);
      expect(result).toHaveLength(1);
    });

    it('should handle unreadable files gracefully', async () => {
      const missingFile = path.join(tmpDir, 'missing.mdx');

      const items = [makeItem('missing', missingFile)];
      const result = await (validateMergeConflicts as any)(items);
      // Should not throw; should skip files it can't read
      expect(result).toHaveLength(0);
    });

    it('should return empty array for empty input', async () => {
      const result = await (validateMergeConflicts as any)([]);
      expect(result).toHaveLength(0);
    });

    it('should detect multiple conflicted files', async () => {
      const file1 = path.join(tmpDir, 'conflict1.mdx');
      const file2 = path.join(tmpDir, 'conflict2.mdx');

      const conflictContent = `---
title: Conflict
type: article
---

<<<<<<< HEAD
A
=======
B
>>>>>>> branch
`;
      await fs.writeFile(file1, conflictContent);
      await fs.writeFile(file2, conflictContent);

      const items = [
        makeItem('conflict1', file1),
        makeItem('conflict2', file2),
      ];

      const result = await (validateMergeConflicts as any)(items);
      expect(result).toHaveLength(2);
    });
  });
});
