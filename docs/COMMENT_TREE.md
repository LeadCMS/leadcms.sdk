# Comment Tree

## Overview

The LeadCMS SDK provides a powerful comment tree API for working with hierarchical comment structures. The `getCommentsTree()` and `getCommentsTreeForContent()` functions return comments in a nested tree format, making it easy to build threaded comment interfaces.

## Features

- 🌲 **Hierarchical Structure**: Automatic parent-child relationship handling
- 🔄 **Multiple Sort Orders**: Sort by date (newest/oldest), reply count (most/least)
- 🔍 **Advanced Filtering**: Filter by language, tags, date range, and more
- 📊 **Rich Metadata**: Each node includes depth, leaf status, and thread count
- 🎯 **Simple API**: Just two functions cover all use cases
- 🔧 **Framework Agnostic**: Works with React, Vue, Astro, Next.js, etc.

## Basic Usage

### Building a Comment Tree

```typescript
import { getCommentsTreeForContent } from '@leadcms/sdk';

// Get comments as a tree for a specific content item
const tree = getCommentsTreeForContent(contentId);

// Each node has:
// - All comment properties (id, body, authorName, etc.)
// - children: CommentTreeNode[] - nested replies
// - depth: number - depth in the tree (0 = root)
// - isLeaf: boolean - true if no replies
// - threadCount: number - total comments in this thread
```

### Tree Structure Example

```typescript
const tree = getCommentsTreeForContent(123);

// tree[0]:
// {
//   id: 1,
//   authorName: "Alice",
//   body: "Great article!",
//   depth: 0,
//   isLeaf: false,
//   threadCount: 4,
//   children: [
//     {
//       id: 2,
//       authorName: "Bob",
//       body: "I agree!",
//       parentId: 1,
//       depth: 1,
//       isLeaf: false,
//       threadCount: 2,
//       children: [
//         {
//           id: 3,
//           authorName: "Charlie",
//           body: "Me too!",
//           parentId: 2,
//           depth: 2,
//           isLeaf: true,
//           threadCount: 1,
//           children: []
//         }
//       ]
//     },
//     {
//       id: 4,
//       authorName: "David",
//       body: "Thanks!",
//       parentId: 1,
//       depth: 1,
//       isLeaf: true,
//       threadCount: 1,
//       children: []
//     }
//   ]
// }
```

## Sorting

### Sort Orders Available

- **`'default'`** / **`'oldest'`**: Oldest comments first (chronological)
- **`'newest'`**: Newest comments first (reverse chronological)
- **`'most-replies'`**: Threads with most replies first
- **`'least-replies'`**: Threads with least replies first

### Examples

```typescript
import { getCommentsTreeForContent } from '@leadcms/sdk';

// Newest comments first
const newestFirst = getCommentsTreeForContent(contentId, {
  sortOrder: 'newest'
});

// Sort by most active threads
const mostActive = getCommentsTreeForContent(contentId, {
  sortOrder: 'most-replies'
});

// Sort root comments by newest, but replies chronologically
const mixed = getCommentsTreeForContent(contentId, {
  sortOrder: 'newest',
  replySortOrder: 'oldest'
});
```

## Filtering

### By Language

```typescript
const frenchComments = getCommentsTreeForContent(contentId, {
  language: 'fr'
});
```

### By Tags

```typescript
// Only comments with 'important' tag
const important = getCommentsTreeForContent(contentId, {
  tags: ['important']
});

// Comments must have ALL specified tags
const tagged = getCommentsTreeForContent(contentId, {
  tags: ['important', 'reviewed']
});
```

### By Date Range

```typescript
// Comments from last 7 days
const recent = getCommentsTreeForContent(contentId, {
  since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
});

// Comments in specific date range
const inRange = getCommentsTreeForContent(contentId, {
  since: '2024-01-01T00:00:00Z',
  until: '2024-12-31T23:59:59Z'
});
```

### Limit Tree Depth

```typescript
// Only show 2 levels deep (root + 1 level of replies)
const shallow = getCommentsTreeForContent(contentId, {
  maxDepth: 1
});
```

## Working with the Comment Tree

The tree structure returned by `getCommentsTree()` provides all the data you need. Here's how to work with it:

### Flatten Tree for Display

```typescript
import { getCommentsTreeForContent } from '@leadcms/sdk';

const tree = getCommentsTreeForContent(contentId, { sortOrder: 'newest' });

// Recursively flatten the tree
function flattenTree(nodes) {
  const result = [];
  for (const node of nodes) {
    result.push(node);
    if (node.children.length > 0) {
      result.push(...flattenTree(node.children));
    }
  }
  return result;
}

const flat = flattenTree(tree);

// Display with indentation
flat.forEach(comment => {
  const indent = '  '.repeat(comment.depth);
  console.log(`${indent}${comment.authorName}: ${comment.body}`);
});

// Output:
// Alice: Great article!
//   Bob: I agree!
//     Charlie: Me too!
//   David: Thanks!
```

### Find Specific Thread

```typescript
import { getCommentsTreeForContent } from '@leadcms/sdk';

const tree = getCommentsTreeForContent(contentId);

// Find specific comment in tree
function findInTree(nodes, commentId) {
  for (const node of nodes) {
    if (node.id === commentId) return node;
    const found = findInTree(node.children, commentId);
    if (found) return found;
  }
  return null;
}

const thread = findInTree(tree, 5);
if (thread) {
  console.log(`Thread has ${thread.threadCount} total comments`);
  console.log(`Thread depth: ${thread.depth}`);
}
```

### Calculate Statistics

```typescript
import { getCommentsTreeForContent } from '@leadcms/sdk';

const tree = getCommentsTreeForContent(contentId);

// Tree structure includes useful metadata
const stats = {
  rootThreads: tree.length,
  totalComments: tree.reduce((sum, node) => sum + node.threadCount, 0),
  maxDepth: Math.max(...tree.map(n => {
    let max = n.depth;
    function traverse(node) {
      max = Math.max(max, node.depth);
      node.children.forEach(traverse);
    }
    traverse(n);
    return max;
  }))
};

console.log(`Total comments: ${stats.totalComments}`);
console.log(`Root threads: ${stats.rootThreads}`);
console.log(`Max depth: ${stats.maxDepth}`);
```

## Real-World Examples

### Reddit-Style Comment Display

```typescript
import { getCommentsTreeForContent } from '@leadcms/sdk';

function CommentList({ contentId }) {
  const tree = getCommentsTreeForContent(contentId, {
    sortOrder: 'most-replies' // Show most discussed first
  });
  
  // Flatten tree recursively
  const flattenTree = (nodes) => {
    const result = [];
    for (const node of nodes) {
      result.push(node);
      if (node.children.length > 0) {
        result.push(...flattenTree(node.children));
      }
    }
    return result;
  };
  
  const flat = flattenTree(tree);
  
  return (
    <div>
      {flat.map(comment => (
        <div
          key={comment.id}
          style={{ marginLeft: `${comment.depth * 20}px` }}
          className={comment.isLeaf ? 'leaf-comment' : 'thread-comment'}
        >
          <strong>{comment.authorName}</strong>
          <span>{comment.threadCount > 1 ? ` (${comment.threadCount - 1} replies)` : ''}</span>
          <p>{comment.body}</p>
          {!comment.isLeaf && <span>↓ {comment.children.length} direct replies</span>}
        </div>
      ))}
    </div>
  );
}
```

### Comment Dashboard

```typescript
import { getCommentsTreeForContent, getCommentsForContent } from '@leadcms/sdk';

function CommentDashboard({ contentId }) {
  const tree = getCommentsTreeForContent(contentId);
  const allComments = getCommentsForContent(contentId);
  
  // Calculate statistics from tree
  const stats = {
    total: allComments.length,
    threads: tree.length,
    replies: allComments.length - tree.length,
    maxDepth: Math.max(...tree.map(node => calculateMaxDepth(node))),
  };
  
  function calculateMaxDepth(node) {
    if (node.children.length === 0) return node.depth;
    return Math.max(...node.children.map(calculateMaxDepth));
  }
  
  // Get recent comments (sorted by date)
  const recent = [...allComments]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10);
  
  // Group by language
  const byLanguage = allComments.reduce((acc, comment) => {
    acc[comment.language] = (acc[comment.language] || 0) + 1;
    return acc;
  }, {});
  
  return (
    <div>
      <h2>Comment Statistics</h2>
      <p>Total: {stats.total} | Threads: {stats.threads} | Replies: {stats.replies}</p>
      <p>Max Depth: {stats.maxDepth}</p>
      
      <h3>By Language</h3>
      <ul>
        {Object.entries(byLanguage).map(([lang, count]) => (
          <li key={lang}>{lang}: {count}</li>
        ))}
      </ul>
      
      <h3>Recent Comments</h3>
      {recent.map(comment => (
        <div key={comment.id}>
          <strong>{comment.authorName}</strong>: {comment.body}
        </div>
      ))}
    </div>
  );
}
```

### Collapsible Thread Component

```typescript
import { getCommentsTreeForContent } from '@leadcms/sdk';
import { useState } from 'react';

function ThreadView({ node }) {
  const [collapsed, setCollapsed] = useState(false);
  
  if (!node) return null;
  
  return (
    <div className="thread">
      <div className="thread-header" onClick={() => setCollapsed(!collapsed)}>
        <strong>{node.authorName}</strong>
        <span>{node.threadCount > 1 ? ` (${node.threadCount - 1} replies)` : ''}</span>
        <button>{collapsed ? '▶' : '▼'}</button>
      </div>
      
      <div className="thread-body">{node.body}</div>
      
      {!collapsed && node.children.map(child => (
        <div key={child.id} style={{ marginLeft: '20px' }}>
          <ThreadView node={child} />
        </div>
      ))}
    </div>
  );
}

function CommentSection({ contentId }) {
  const tree = getCommentsTreeForContent(contentId);
  
  return (
    <div>
      {tree.map(node => (
        <ThreadView key={node.id} node={node} />
      ))}
    </div>
  );
}
```

## TypeScript Types

### CommentTreeNode

```typescript
interface CommentTreeNode extends StoredComment {
  children: CommentTreeNode[];
  depth: number;
  isLeaf: boolean;
  threadCount: number;
}
```

### CommentTreeOptions

```typescript
interface CommentTreeOptions {
  sortOrder?: 'default' | 'newest' | 'oldest' | 'most-replies' | 'least-replies';
  replySortOrder?: 'default' | 'newest' | 'oldest' | 'most-replies' | 'least-replies';
  maxDepth?: number;
  language?: string;
  tags?: string[];
  since?: Date | string;
  until?: Date | string;
}
```

### CommentStatistics

```typescript
interface CommentStatistics {
  total: number;
  threads: number;
  replies: number;
  maxDepth: number;
  averageDepth: number;
  authors: number;
  languages: string[];
  tags: string[];
  dateRange: {
    earliest: string | null;
    latest: string | null;
  };
  topAuthors: Array<{ name: string; count: number }>;
}
```

## API Reference

### Public API

The LeadCMS SDK exposes two main functions for working with comment trees:

- **`getCommentsTree(type, id, language?, options?)`** - Get comments tree for any commentable entity
- **`getCommentsTreeForContent(contentId, language?, options?)`** - Get comments tree for content (convenience wrapper)

Both functions return a hierarchical tree structure with all the features documented above (sorting, filtering, statistics, etc.).

### Internal Implementation Note

The SDK includes internal utility functions (`buildCommentTree`, `flattenCommentTree`, `filterComments`, `searchComments`, etc.) that are used by `getCommentsTree()` to provide its functionality. These are implementation details and not part of the public API.

**Why?** To maintain a clean, stable public API that can evolve internally without breaking changes. The tree structure returned by `getCommentsTree()` provides all the data you need in a hierarchical format. If you need flat arrays or filtered subsets, work with the returned tree structure directly.

## Related Documentation

- [Comments Feature](./COMMENTS_FEATURE.md) - Basic comments usage
- [Public API Mode](./PUBLIC_API_MODE.md) - Security and authentication
- [README](../README.md) - General SDK documentation
