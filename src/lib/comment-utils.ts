/**
 * Comment Utilities
 * Advanced comment processing, tree building, sorting, and filtering
 */

import type { StoredComment } from './comment-types.js';

/**
 * Comment node in a tree structure with children
 */
export interface CommentTreeNode extends StoredComment {
  children: CommentTreeNode[];
  depth: number;
  isLeaf: boolean;
  threadCount: number; // Total number of comments in this thread (including children)
}

/**
 * Sort order for comment threads
 */
export type CommentSortOrder =
  | 'default'      // Oldest first (createdAt ascending)
  | 'newest'       // Newest first (createdAt descending)
  | 'oldest'       // Explicitly oldest first (same as default)
  | 'most-replies' // Threads with most replies first
  | 'least-replies'; // Threads with least replies first

/**
 * Options for building comment trees
 */
export interface CommentTreeOptions {
  /**
   * Sort order for root-level comments
   * @default 'default' (oldest first)
   */
  sortOrder?: CommentSortOrder;

  /**
   * Sort order for replies within each thread
   * @default 'oldest' (chronological order)
   */
  replySortOrder?: CommentSortOrder;

  /**
   * Maximum depth to traverse (0 = unlimited)
   * @default 0
   */
  maxDepth?: number;

  /**
   * Filter comments by language
   */
  language?: string;

  /**
   * Filter comments by tags (must have ALL tags)
   */
  tags?: string[];

  /**
   * Only include comments after this date
   */
  since?: Date | string;

  /**
   * Only include comments before this date
   */
  until?: Date | string;
}

/**
 * Comment statistics
 */
export interface CommentStatistics {
  total: number;
  threads: number; // Root-level comments
  replies: number; // Non-root comments
  maxDepth: number;
  averageDepth: number;
  authors: number; // Unique authors
  languages: string[];
  tags: string[];
  dateRange: {
    earliest: string | null;
    latest: string | null;
  };
  topAuthors: Array<{ name: string; count: number }>;
}

/**
 * Build a comment tree from flat array of comments
 * @param comments - Flat array of comments
 * @param options - Tree building options
 * @returns Array of root-level comment nodes with nested children
 */
export function buildCommentTree(
  comments: StoredComment[],
  options: CommentTreeOptions = {}
): CommentTreeNode[] {
  const {
    sortOrder = 'default',
    replySortOrder = 'oldest',
    maxDepth = 0,
    language,
    tags,
    since,
    until
  } = options;

  // Filter comments based on criteria
  let filtered = filterComments(comments, { language, tags, since, until });

  // Create a map for quick lookup
  const commentMap = new Map<number, CommentTreeNode>();

  // Initialize all comments as tree nodes
  filtered.forEach(comment => {
    commentMap.set(comment.id, {
      ...comment,
      children: [],
      depth: 0,
      isLeaf: true,
      threadCount: 1
    });
  });

  // Build parent-child relationships
  const rootNodes: CommentTreeNode[] = [];

  commentMap.forEach(node => {
    if (node.parentId && commentMap.has(node.parentId)) {
      // This is a reply
      const parent = commentMap.get(node.parentId)!;
      parent.children.push(node);
      parent.isLeaf = false;
    } else {
      // This is a root comment
      rootNodes.push(node);
    }
  });

  // Calculate depth and thread counts
  function calculateDepthAndCount(node: CommentTreeNode, depth: number): number {
    node.depth = depth;

    if (maxDepth > 0 && depth >= maxDepth) {
      // Truncate tree at max depth
      node.children = [];
      node.isLeaf = true;
      return 1;
    }

    let totalCount = 1;

    // Sort children
    sortCommentNodes(node.children, replySortOrder);

    // Recursively process children
    node.children.forEach(child => {
      totalCount += calculateDepthAndCount(child, depth + 1);
    });

    node.threadCount = totalCount;
    return totalCount;
  }

  rootNodes.forEach(node => calculateDepthAndCount(node, 0));

  // Sort root nodes
  sortCommentNodes(rootNodes, sortOrder);

  return rootNodes;
}

/**
 * Flatten a comment tree back to an array
 * Useful for displaying comments in a linear list with indentation
 * @param tree - Comment tree
 * @returns Flat array of comments in display order
 */
export function flattenCommentTree(tree: CommentTreeNode[]): CommentTreeNode[] {
  const result: CommentTreeNode[] = [];

  function traverse(nodes: CommentTreeNode[]) {
    nodes.forEach(node => {
      result.push(node);
      if (node.children.length > 0) {
        traverse(node.children);
      }
    });
  }

  traverse(tree);
  return result;
}

/**
 * Get a specific thread (comment and all its descendants)
 * @param comments - All comments
 * @param rootCommentId - ID of the root comment
 * @param options - Tree building options
 * @returns Comment tree for the specific thread
 */
export function getCommentThread(
  comments: StoredComment[],
  rootCommentId: number,
  options: CommentTreeOptions = {}
): CommentTreeNode | null {
  const tree = buildCommentTree(comments, options);

  function findNode(nodes: CommentTreeNode[], id: number): CommentTreeNode | null {
    for (const node of nodes) {
      if (node.id === id) return node;
      const found = findNode(node.children, id);
      if (found) return found;
    }
    return null;
  }

  return findNode(tree, rootCommentId);
}

/**
 * Get statistics about comments
 * @param comments - Array of comments
 * @returns Comment statistics
 */
export function getCommentStatistics(comments: StoredComment[]): CommentStatistics {
  if (comments.length === 0) {
    return {
      total: 0,
      threads: 0,
      replies: 0,
      maxDepth: 0,
      averageDepth: 0,
      authors: 0,
      languages: [],
      tags: [],
      dateRange: { earliest: null, latest: null },
      topAuthors: []
    };
  }

  const tree = buildCommentTree(comments);
  const flat = flattenCommentTree(tree);

  // Calculate depths
  const depths = flat.map(c => c.depth);
  const maxDepth = Math.max(...depths);
  const averageDepth = depths.reduce((a, b) => a + b, 0) / depths.length;

  // Count threads and replies
  const threads = tree.length;
  const replies = comments.length - threads;

  // Unique authors
  const authorSet = new Set(comments.map(c => c.authorName));
  const authors = authorSet.size;

  // Languages
  const languageSet = new Set(comments.map(c => c.language));
  const languages = Array.from(languageSet);

  // Tags
  const tagSet = new Set<string>();
  comments.forEach(c => {
    if (c.tags) {
      c.tags.forEach(tag => tagSet.add(tag));
    }
  });
  const tags = Array.from(tagSet);

  // Date range
  const dates = comments.map(c => new Date(c.createdAt).getTime()).sort((a, b) => a - b);
  const dateRange = {
    earliest: new Date(dates[0]).toISOString(),
    latest: new Date(dates[dates.length - 1]).toISOString()
  };

  // Top authors
  const authorCounts = new Map<string, number>();
  comments.forEach(c => {
    authorCounts.set(c.authorName, (authorCounts.get(c.authorName) || 0) + 1);
  });
  const topAuthors = Array.from(authorCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    total: comments.length,
    threads,
    replies,
    maxDepth,
    averageDepth,
    authors,
    languages,
    tags,
    dateRange,
    topAuthors
  };
}

/**
 * Filter comments based on criteria
 * @param comments - Array of comments
 * @param filters - Filter criteria
 * @returns Filtered comments
 */
export function filterComments(
  comments: StoredComment[],
  filters: {
    language?: string;
    tags?: string[];
    since?: Date | string;
    until?: Date | string;
    authorName?: string;
    searchText?: string;
  } = {}
): StoredComment[] {
  return comments.filter(comment => {
    // Language filter
    if (filters.language && comment.language !== filters.language) {
      return false;
    }

    // Tags filter (must have ALL specified tags)
    if (filters.tags && filters.tags.length > 0) {
      if (!comment.tags || !filters.tags.every(tag => comment.tags!.includes(tag))) {
        return false;
      }
    }

    // Date filters
    const commentDate = new Date(comment.createdAt);

    if (filters.since) {
      const sinceDate = typeof filters.since === 'string' ? new Date(filters.since) : filters.since;
      if (commentDate < sinceDate) {
        return false;
      }
    }

    if (filters.until) {
      const untilDate = typeof filters.until === 'string' ? new Date(filters.until) : filters.until;
      if (commentDate > untilDate) {
        return false;
      }
    }

    // Author filter
    if (filters.authorName && comment.authorName !== filters.authorName) {
      return false;
    }

    // Search text (in body or author name)
    if (filters.searchText) {
      const searchLower = filters.searchText.toLowerCase();
      const inBody = comment.body.toLowerCase().includes(searchLower);
      const inAuthor = comment.authorName.toLowerCase().includes(searchLower);
      if (!inBody && !inAuthor) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Group comments by a specific field
 * @param comments - Array of comments
 * @param groupBy - Field to group by
 * @returns Map of groups
 */
export function groupComments<K extends keyof StoredComment>(
  comments: StoredComment[],
  groupBy: K
): Map<StoredComment[K], StoredComment[]> {
  const groups = new Map<StoredComment[K], StoredComment[]>();

  comments.forEach(comment => {
    const key = comment[groupBy];
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(comment);
  });

  return groups;
}

/**
 * Find comments by author
 * @param comments - Array of comments
 * @param authorName - Author name to search for
 * @returns Comments by the author
 */
export function findCommentsByAuthor(
  comments: StoredComment[],
  authorName: string
): StoredComment[] {
  return filterComments(comments, { authorName });
}

/**
 * Search comments by text
 * @param comments - Array of comments
 * @param searchText - Text to search for
 * @returns Matching comments
 */
export function searchComments(
  comments: StoredComment[],
  searchText: string
): StoredComment[] {
  return filterComments(comments, { searchText });
}

/**
 * Get recent comments
 * @param comments - Array of comments
 * @param count - Number of recent comments to return
 * @returns Most recent comments
 */
export function getRecentComments(
  comments: StoredComment[],
  count: number = 10
): StoredComment[] {
  return [...comments]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, count);
}

/**
 * Get comment count by author
 * @param comments - Array of comments
 * @returns Map of author names to comment counts
 */
export function getCommentCountByAuthor(
  comments: StoredComment[]
): Map<string, number> {
  const counts = new Map<string, number>();

  comments.forEach(comment => {
    counts.set(comment.authorName, (counts.get(comment.authorName) || 0) + 1);
  });

  return counts;
}

/**
 * Check if a comment has replies
 * @param comments - All comments
 * @param commentId - Comment ID to check
 * @returns True if the comment has replies
 */
export function hasReplies(comments: StoredComment[], commentId: number): boolean {
  return comments.some(c => c.parentId === commentId);
}

/**
 * Get direct replies to a comment
 * @param comments - All comments
 * @param parentId - Parent comment ID
 * @returns Direct child comments
 */
export function getReplies(
  comments: StoredComment[],
  parentId: number
): StoredComment[] {
  return comments.filter(c => c.parentId === parentId);
}

/**
 * Get the path from root to a specific comment
 * @param comments - All comments
 * @param commentId - Target comment ID
 * @returns Array of comments from root to target
 */
export function getCommentPath(
  comments: StoredComment[],
  commentId: number
): StoredComment[] {
  const commentMap = new Map(comments.map(c => [c.id, c]));
  const path: StoredComment[] = [];

  let current = commentMap.get(commentId);

  while (current) {
    path.unshift(current);
    current = current.parentId ? commentMap.get(current.parentId) : undefined;
  }

  return path;
}

/**
 * Sort comment nodes in place
 * @param nodes - Array of comment nodes
 * @param sortOrder - Sort order
 */
function sortCommentNodes(nodes: CommentTreeNode[], sortOrder: CommentSortOrder): void {
  nodes.sort((a, b) => {
    switch (sortOrder) {
      case 'newest':
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

      case 'oldest':
      case 'default':
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

      case 'most-replies':
        return b.threadCount - a.threadCount;

      case 'least-replies':
        return a.threadCount - b.threadCount;

      default:
        return 0;
    }
  });
}
