import {
  buildCommentTree,
  flattenCommentTree,
  getCommentThread,
  getCommentStatistics,
  filterComments,
  groupComments,
  findCommentsByAuthor,
  searchComments,
  getRecentComments,
  getCommentCountByAuthor,
  hasReplies,
  getReplies,
  getCommentPath,
  type CommentTreeNode
} from '../src/lib/comment-utils';
import type { StoredComment } from '../src/lib/comment-types';

describe('Comment Utilities', () => {
  // Sample test data
  const sampleComments: StoredComment[] = [
    {
      id: 1,
      parentId: null,
      authorName: 'Alice',
      body: 'First comment',
      createdAt: '2024-01-01T10:00:00Z',
      commentableId: 100,
      commentableType: 'Content',
      language: 'en',
      tags: ['important']
    },
    {
      id: 2,
      parentId: 1,
      authorName: 'Bob',
      body: 'Reply to first',
      createdAt: '2024-01-01T11:00:00Z',
      commentableId: 100,
      commentableType: 'Content',
      language: 'en',
      tags: []
    },
    {
      id: 3,
      parentId: 1,
      authorName: 'Charlie',
      body: 'Another reply',
      createdAt: '2024-01-01T12:00:00Z',
      commentableId: 100,
      commentableType: 'Content',
      language: 'en',
      tags: []
    },
    {
      id: 4,
      parentId: 2,
      authorName: 'Alice',
      body: 'Nested reply',
      createdAt: '2024-01-01T13:00:00Z',
      commentableId: 100,
      commentableType: 'Content',
      language: 'en',
      tags: []
    },
    {
      id: 5,
      parentId: null,
      authorName: 'David',
      body: 'Second root comment',
      createdAt: '2024-01-02T10:00:00Z',
      commentableId: 100,
      commentableType: 'Content',
      language: 'en',
      tags: ['question']
    },
    {
      id: 6,
      parentId: null,
      authorName: 'Eve',
      body: 'Third root comment',
      createdAt: '2024-01-03T10:00:00Z',
      commentableId: 100,
      commentableType: 'Content',
      language: 'fr',
      tags: []
    }
  ];

  describe('buildCommentTree', () => {
    it('should build a basic tree structure', () => {
      const tree = buildCommentTree(sampleComments);

      expect(tree).toHaveLength(3); // 3 root comments
      expect(tree[0].id).toBe(1);
      expect(tree[0].children).toHaveLength(2); // 2 direct replies
      expect(tree[0].depth).toBe(0);
      expect(tree[0].isLeaf).toBe(false);
    });

    it('should handle nested comments', () => {
      const tree = buildCommentTree(sampleComments);
      const firstComment = tree[0];

      expect(firstComment.children[0].id).toBe(2);
      expect(firstComment.children[0].children).toHaveLength(1); // Nested reply
      expect(firstComment.children[0].children[0].id).toBe(4);
      expect(firstComment.children[0].children[0].depth).toBe(2);
    });

    it('should calculate thread counts correctly', () => {
      const tree = buildCommentTree(sampleComments);

      expect(tree[0].threadCount).toBe(4); // 1 root + 2 replies + 1 nested
      expect(tree[1].threadCount).toBe(1); // Just itself
      expect(tree[2].threadCount).toBe(1); // Just itself
    });

    it('should sort by newest first', () => {
      const tree = buildCommentTree(sampleComments, { sortOrder: 'newest' });

      expect(tree[0].id).toBe(6); // Most recent
      expect(tree[1].id).toBe(5);
      expect(tree[2].id).toBe(1); // Oldest
    });

    it('should sort by oldest first (default)', () => {
      const tree = buildCommentTree(sampleComments, { sortOrder: 'oldest' });

      expect(tree[0].id).toBe(1); // Oldest
      expect(tree[1].id).toBe(5);
      expect(tree[2].id).toBe(6); // Most recent
    });

    it('should sort by most replies', () => {
      const tree = buildCommentTree(sampleComments, { sortOrder: 'most-replies' });

      expect(tree[0].threadCount).toBe(4); // Comment with most replies
      expect(tree[1].threadCount).toBe(1);
      expect(tree[2].threadCount).toBe(1);
    });

    it('should respect maxDepth option', () => {
      const tree = buildCommentTree(sampleComments, { maxDepth: 1 });

      expect(tree[0].children).toHaveLength(2);
      expect(tree[0].children[0].children).toHaveLength(0); // Truncated
    });

    it('should filter by language', () => {
      const tree = buildCommentTree(sampleComments, { language: 'fr' });

      expect(tree).toHaveLength(1);
      expect(tree[0].id).toBe(6);
    });

    it('should filter by tags', () => {
      const tree = buildCommentTree(sampleComments, { tags: ['important'] });

      expect(tree).toHaveLength(1);
      expect(tree[0].id).toBe(1);
    });

    it('should filter by date range', () => {
      const tree = buildCommentTree(sampleComments, {
        since: '2024-01-02T00:00:00Z',
        until: '2024-01-03T00:00:00Z'
      });

      expect(tree).toHaveLength(1);
      expect(tree[0].id).toBe(5);
    });

    it('should mark leaf nodes correctly', () => {
      const tree = buildCommentTree(sampleComments);

      expect(tree[0].isLeaf).toBe(false); // Has children
      expect(tree[0].children[1].isLeaf).toBe(true); // No children
      expect(tree[1].isLeaf).toBe(true); // No children
    });
  });

  describe('flattenCommentTree', () => {
    it('should flatten tree to array in display order', () => {
      const tree = buildCommentTree(sampleComments);
      const flat = flattenCommentTree(tree);

      expect(flat).toHaveLength(6);
      expect(flat[0].id).toBe(1); // Root
      expect(flat[1].id).toBe(2); // First child
      expect(flat[2].id).toBe(4); // Nested child
      expect(flat[3].id).toBe(3); // Second child
    });

    it('should preserve depth information', () => {
      const tree = buildCommentTree(sampleComments);
      const flat = flattenCommentTree(tree);

      expect(flat[0].depth).toBe(0);
      expect(flat[1].depth).toBe(1);
      expect(flat[2].depth).toBe(2);
      expect(flat[3].depth).toBe(1);
    });
  });

  describe('getCommentThread', () => {
    it('should get specific thread by root ID', () => {
      const thread = getCommentThread(sampleComments, 1);

      expect(thread).not.toBeNull();
      expect(thread!.id).toBe(1);
      expect(thread!.threadCount).toBe(4);
    });

    it('should get thread by child ID', () => {
      const thread = getCommentThread(sampleComments, 2);

      expect(thread).not.toBeNull();
      expect(thread!.id).toBe(2);
      expect(thread!.threadCount).toBe(2); // Itself + nested reply
    });

    it('should return null for non-existent ID', () => {
      const thread = getCommentThread(sampleComments, 999);

      expect(thread).toBeNull();
    });
  });

  describe('getCommentStatistics', () => {
    it('should calculate correct statistics', () => {
      const stats = getCommentStatistics(sampleComments);

      expect(stats.total).toBe(6);
      expect(stats.threads).toBe(3);
      expect(stats.replies).toBe(3);
      expect(stats.maxDepth).toBe(2);
      expect(stats.authors).toBe(5);
    });

    it('should list all languages', () => {
      const stats = getCommentStatistics(sampleComments);

      expect(stats.languages).toContain('en');
      expect(stats.languages).toContain('fr');
    });

    it('should list all tags', () => {
      const stats = getCommentStatistics(sampleComments);

      expect(stats.tags).toContain('important');
      expect(stats.tags).toContain('question');
    });

    it('should calculate date range', () => {
      const stats = getCommentStatistics(sampleComments);

      expect(stats.dateRange.earliest).toBe('2024-01-01T10:00:00.000Z');
      expect(stats.dateRange.latest).toBe('2024-01-03T10:00:00.000Z');
    });

    it('should list top authors', () => {
      const stats = getCommentStatistics(sampleComments);

      expect(stats.topAuthors[0].name).toBe('Alice');
      expect(stats.topAuthors[0].count).toBe(2);
    });

    it('should handle empty comments array', () => {
      const stats = getCommentStatistics([]);

      expect(stats.total).toBe(0);
      expect(stats.threads).toBe(0);
      expect(stats.maxDepth).toBe(0);
    });
  });

  describe('filterComments', () => {
    it('should filter by language', () => {
      const filtered = filterComments(sampleComments, { language: 'en' });

      expect(filtered).toHaveLength(5);
    });

    it('should filter by tags', () => {
      const filtered = filterComments(sampleComments, { tags: ['important'] });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe(1);
    });

    it('should filter by date range', () => {
      const filtered = filterComments(sampleComments, {
        since: '2024-01-02T00:00:00Z'
      });

      expect(filtered).toHaveLength(2);
    });

    it('should filter by author name', () => {
      const filtered = filterComments(sampleComments, { authorName: 'Alice' });

      expect(filtered).toHaveLength(2);
    });

    it('should filter by search text in body', () => {
      const filtered = filterComments(sampleComments, { searchText: 'reply' });

      expect(filtered).toHaveLength(3);
    });

    it('should filter by search text in author', () => {
      const filtered = filterComments(sampleComments, { searchText: 'alice' });

      expect(filtered).toHaveLength(2);
    });

    it('should combine multiple filters', () => {
      const filtered = filterComments(sampleComments, {
        language: 'en',
        since: '2024-01-01T12:00:00Z'
      });

      expect(filtered).toHaveLength(3);
    });
  });

  describe('groupComments', () => {
    it('should group by language', () => {
      const grouped = groupComments(sampleComments, 'language');

      expect(grouped.get('en')).toHaveLength(5);
      expect(grouped.get('fr')).toHaveLength(1);
    });

    it('should group by author name', () => {
      const grouped = groupComments(sampleComments, 'authorName');

      expect(grouped.get('Alice')).toHaveLength(2);
      expect(grouped.get('Bob')).toHaveLength(1);
    });
  });

  describe('findCommentsByAuthor', () => {
    it('should find all comments by author', () => {
      const comments = findCommentsByAuthor(sampleComments, 'Alice');

      expect(comments).toHaveLength(2);
      expect(comments[0].authorName).toBe('Alice');
      expect(comments[1].authorName).toBe('Alice');
    });

    it('should return empty array for non-existent author', () => {
      const comments = findCommentsByAuthor(sampleComments, 'Unknown');

      expect(comments).toHaveLength(0);
    });
  });

  describe('searchComments', () => {
    it('should find comments by text', () => {
      const results = searchComments(sampleComments, 'reply');

      expect(results).toHaveLength(3);
    });

    it('should be case-insensitive', () => {
      const results = searchComments(sampleComments, 'REPLY');

      expect(results).toHaveLength(3);
    });
  });

  describe('getRecentComments', () => {
    it('should return most recent comments', () => {
      const recent = getRecentComments(sampleComments, 3);

      expect(recent).toHaveLength(3);
      expect(recent[0].id).toBe(6); // Most recent
      expect(recent[1].id).toBe(5);
      expect(recent[2].id).toBe(4);
    });

    it('should handle count larger than array', () => {
      const recent = getRecentComments(sampleComments, 100);

      expect(recent).toHaveLength(6);
    });
  });

  describe('getCommentCountByAuthor', () => {
    it('should count comments per author', () => {
      const counts = getCommentCountByAuthor(sampleComments);

      expect(counts.get('Alice')).toBe(2);
      expect(counts.get('Bob')).toBe(1);
      expect(counts.get('Charlie')).toBe(1);
    });
  });

  describe('hasReplies', () => {
    it('should return true for comments with replies', () => {
      expect(hasReplies(sampleComments, 1)).toBe(true);
      expect(hasReplies(sampleComments, 2)).toBe(true);
    });

    it('should return false for leaf comments', () => {
      expect(hasReplies(sampleComments, 4)).toBe(false);
      expect(hasReplies(sampleComments, 5)).toBe(false);
    });
  });

  describe('getReplies', () => {
    it('should get direct replies', () => {
      const replies = getReplies(sampleComments, 1);

      expect(replies).toHaveLength(2);
      expect(replies[0].id).toBe(2);
      expect(replies[1].id).toBe(3);
    });

    it('should return empty array for no replies', () => {
      const replies = getReplies(sampleComments, 5);

      expect(replies).toHaveLength(0);
    });
  });

  describe('getCommentPath', () => {
    it('should get path to root comment', () => {
      const path = getCommentPath(sampleComments, 1);

      expect(path).toHaveLength(1);
      expect(path[0].id).toBe(1);
    });

    it('should get path to nested comment', () => {
      const path = getCommentPath(sampleComments, 4);

      expect(path).toHaveLength(3);
      expect(path[0].id).toBe(1); // Root
      expect(path[1].id).toBe(2); // Parent
      expect(path[2].id).toBe(4); // Target
    });

    it('should return empty array for non-existent comment', () => {
      const path = getCommentPath(sampleComments, 999);

      expect(path).toHaveLength(0);
    });
  });
});
