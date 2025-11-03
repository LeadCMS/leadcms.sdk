# Comment Tree Guide

## Overview

The LeadCMS SDK provides powerful comment tree functionality for building threaded comment interfaces. The tree structure automatically handles parent-child relationships, sorting, filtering, and provides rich metadata for each comment node.

## Key Features

- 🌲 **Hierarchical Structure** - Automatic parent-child relationships
- 🔄 **Flexible Sorting** - Sort by date (newest/oldest), reply count (most/least)
- 🔍 **Advanced Filtering** - Filter by language, tags, date range
- 📊 **Rich Metadata** - Each node includes depth, thread count, and leaf status
- 🎯 **Simple API** - Two main functions for all use cases

## Quick Start

```typescript
import { getCommentsTreeForContent } from '@leadcms/sdk';

// Get comments as a tree for a specific content item
const tree = getCommentsTreeForContent(contentId);

// Each node includes:
// - All comment properties (id, body, authorName, etc.)
// - children: CommentTreeNode[] - nested replies
// - depth: number - depth in tree (0 = root)
// - isLeaf: boolean - true if no replies
// - threadCount: number - total comments in this thread
```

## Tree Structure

```typescript
const tree = getCommentsTreeForContent(123);

// tree[0]:
{
  id: 1,
  authorName: "Alice",
  body: "Great article!",
  depth: 0,
  isLeaf: false,
  threadCount: 4,  // Total comments in this thread (including this one)
  children: [
    {
      id: 2,
      authorName: "Bob",
      body: "I agree!",
      parentId: 1,
      depth: 1,
      isLeaf: false,
      threadCount: 2,
      children: [
        {
          id: 3,
          authorName: "Charlie",
          body: "Me too!",
          parentId: 2,
          depth: 2,
          isLeaf: true,
          threadCount: 1,
          children: []
        }
      ]
    },
    {
      id: 4,
      authorName: "David",
      body: "Thanks!",
      parentId: 1,
      depth: 1,
      isLeaf: true,
      threadCount: 1,
      children: []
    }
  ]
}
```

## Sorting Options

### Available Sort Orders

- `'default'` / `'oldest'` - Oldest comments first (chronological)
- `'newest'` - Newest comments first (reverse chronological)
- `'most-replies'` - Threads with most replies first
- `'least-replies'` - Threads with least replies first

### Examples

```typescript
// Newest comments first
const tree = getCommentsTreeForContent(contentId, undefined, {
  sortOrder: 'newest'
});

// Sort by most active threads
const tree = getCommentsTreeForContent(contentId, undefined, {
  sortOrder: 'most-replies'
});

// Sort root comments by newest, but replies chronologically
const tree = getCommentsTreeForContent(contentId, undefined, {
  sortOrder: 'newest',
  replySortOrder: 'oldest'
});
```

## Filtering

### By Language

```typescript
const frenchComments = getCommentsTreeForContent(contentId, 'fr');
```

### By Tags

```typescript
// Only comments with 'important' tag
const important = getCommentsTreeForContent(contentId, undefined, {
  tags: ['important']
});
```

### By Date Range

```typescript
// Comments from last 7 days
const recent = getCommentsTreeForContent(contentId, undefined, {
  since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
});

// Comments in specific date range
const inRange = getCommentsTreeForContent(contentId, undefined, {
  since: '2024-01-01T00:00:00Z',
  until: '2024-12-31T23:59:59Z'
});
```

### Limit Tree Depth

```typescript
// Only show 2 levels deep (root + 1 level of replies)
const shallow = getCommentsTreeForContent(contentId, undefined, {
  maxDepth: 1
});
```

## Working with Tree Data

### Flatten for Display

```typescript
const tree = getCommentsTreeForContent(contentId);

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
```

### Calculate Statistics

```typescript
const tree = getCommentsTreeForContent(contentId);

const stats = {
  rootThreads: tree.length,
  totalComments: tree.reduce((sum, node) => sum + node.threadCount, 0),
  maxDepth: Math.max(...tree.map(node => {
    let max = node.depth;
    function traverse(n) {
      max = Math.max(max, n.depth);
      n.children.forEach(traverse);
    }
    traverse(node);
    return max;
  }))
};
```

## Real-World Examples

### Reddit-Style Comment Display

```typescript
import { getCommentsTreeForContent } from '@leadcms/sdk';

function CommentList({ contentId }) {
  const tree = getCommentsTreeForContent(contentId, undefined, {
    sortOrder: 'most-replies' // Show most discussed first
  });
  
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
  
  return (
    <div>
      {flat.map(comment => (
        <div
          key={comment.id}
          style={{ marginLeft: `${comment.depth * 20}px` }}
          className={comment.isLeaf ? 'leaf-comment' : 'thread-comment'}
        >
          <strong>{comment.authorName}</strong>
          {comment.threadCount > 1 && (
            <span> ({comment.threadCount - 1} replies)</span>
          )}
          <p>{comment.body}</p>
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
        {node.threadCount > 1 && <span> ({node.threadCount - 1} replies)</span>}
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

### Comment Dashboard

```typescript
import { getCommentsTreeForContent, getCommentsForContent } from '@leadcms/sdk';

function CommentDashboard({ contentId }) {
  const tree = getCommentsTreeForContent(contentId);
  const allComments = getCommentsForContent(contentId);
  
  const stats = {
    total: allComments.length,
    threads: tree.length,
    replies: allComments.length - tree.length
  };
  
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

## API Reference

### getCommentsTreeForContent()

Get comments tree for a specific content item (convenience wrapper).

```typescript
function getCommentsTreeForContent(
  contentId: number,
  language?: string,
  options?: CommentTreeOptions
): CommentTreeNode[]
```

**Parameters:**
- `contentId` - The ID of the content
- `language` - Language code (optional, uses default language if not provided)
- `options` - Tree building options (sorting, filtering, etc.)

**Returns:** Array of root-level comment nodes with nested children

### getCommentsTree()

Get comments tree for any commentable entity.

```typescript
function getCommentsTree(
  commentableType: string,
  commentableId: number,
  language?: string,
  options?: CommentTreeOptions
): CommentTreeNode[]
```

**Parameters:**
- `commentableType` - The type of entity (e.g., "Content", "Contact")
- `commentableId` - The ID of the entity
- `language` - Language code (optional, uses default language if not provided)
- `options` - Tree building options (sorting, filtering, etc.)

**Returns:** Array of root-level comment nodes with nested children

## Related Documentation

- [README](../README.md) - Main SDK documentation with comments API
- [PUBLIC_API_MODE](./PUBLIC_API_MODE.md) - Security and authentication guide
