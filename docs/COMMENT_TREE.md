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
