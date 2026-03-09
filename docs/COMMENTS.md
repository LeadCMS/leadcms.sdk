# Working with Comments

## Overview

The LeadCMS SDK supports working with comments that have already been synchronized into your project.

In practice, the workflow is:

1. Pull comments from LeadCMS with the CLI
2. Read them through the SDK in your application
3. Optionally build threaded views with the comment tree helpers

The current public SDK surface for comments is read-oriented. It is designed for rendering comments in static sites, SSR apps, and preview environments.

Comment pulls are always performed anonymously. The SDK does not send an API key when synchronizing comments, so pulled comment files only contain public comment data that is safe to commit to your repository.

## Quick Start

### 1. Sync comments locally

```bash
npx leadcms pull-comments
```

Or pull everything at once:

```bash
npx leadcms pull
```

### 2. Read comments in code

```typescript
import { getCommentsForContent } from "@leadcms/sdk";

const comments = getCommentsForContent(91, "en-US");
const commentsBySlug = getCommentsForContent("pricing", "en-US");

console.log(comments.length);
console.log(comments[0]?.authorName);
console.log(comments[0]?.body);
```

## Available SDK Methods

### Get comments for any entity

```typescript
import { getComments } from "@leadcms/sdk";

const comments = getComments("Content", 91, "en-US");
```

Use this when you know both:

- `commentableType` - for example `Content`
- `commentableId` - the numeric entity ID

### Get comments for content

```typescript
import { getCommentsForContent } from "@leadcms/sdk";

const comments = getCommentsForContent(91, "en-US");
```

This is the most common helper for content pages.
It accepts either the numeric content ID or the content slug.

### Strict variants

The non-strict functions return an empty array when the file is missing or cannot be parsed.

If you want explicit failures during development, use the strict variants:

```typescript
import { getCommentsStrict, getCommentsForContentStrict } from "@leadcms/sdk";

const genericComments = getCommentsStrict("Content", 91, "en-US");
const contentComments = getCommentsForContentStrict(91, "en-US");
const contentCommentsBySlug = getCommentsForContentStrict("pricing", "en-US");
```

## Threaded Comments

For nested comment UIs, use the tree helpers:

```typescript
import { getCommentsTreeForContent } from "@leadcms/sdk";

const tree = getCommentsTreeForContent(91, "en-US", {
  sortOrder: "newest",
  replySortOrder: "oldest",
});

const treeBySlug = getCommentsTreeForContent("pricing", "en-US");
```

Use the dedicated tree guide for advanced sorting, filtering, and rendering patterns:

- [Comment Tree Guide](./COMMENT_TREE.md)

## Comment Types

The SDK exports comment types you can use in your application code:

```typescript
import type { Comment, StoredComment } from "@leadcms/sdk";
```

### `Comment`

Represents a full comment object from the LeadCMS API.

Important fields include:

- `id`
- `parentId`
- `authorName`
- `authorEmail`
- `avatarUrl`
- `body`
- `status`
- `answerStatus`
- `createdAt`
- `updatedAt`
- `commentableId`
- `commentableType`
- `language`
- `tags`

### `StoredComment`

Represents the simplified comment shape stored locally in pulled JSON files.

This is usually the type you will work with in the public read APIs.
The `avatarUrl` field, when present, is the avatar image URL for the comment author.
It is read-only metadata returned by LeadCMS and should not be sent back in client create or update payloads.
The `authorEmail` field is intentionally not preserved in pulled comment files. It may be required when creating a new comment, but after the comment is pushed the SDK refreshes comments anonymously so email addresses are stripped from the stored files.

## Local File Layout

Comments are stored under the configured `commentsDir`.

Typical layout:

```text
.leadcms/comments/
  en-US/
    content/
      91.json
  ru-RU/
    content/
      91.json
```

Each file contains an array of comments for a specific entity.
For content comments, those files are still keyed by numeric content ID under the hood, but the content-specific SDK helpers can resolve a slug to the matching content ID for you.

## Common Usage Patterns

### Render a flat list

```typescript
import { getCommentsForContent } from "@leadcms/sdk";

const comments = getCommentsForContent(91, "en-US");
const sameComments = getCommentsForContent("pricing", "en-US");

for (const comment of comments) {
  console.log(`${comment.authorName}: ${comment.body}`);
}
```

### Filter approved comments only

```typescript
import { getCommentsForContent } from "@leadcms/sdk";

const comments = getCommentsForContent(91, "en-US");
const approved = comments.filter((comment) => comment.status === "Approved");
```

### Separate root comments and replies

```typescript
import { getCommentsForContent } from "@leadcms/sdk";

const comments = getCommentsForContent(91, "en-US");

const rootComments = comments.filter((comment) => !comment.parentId);
const replies = comments.filter((comment) => comment.parentId);
```

## Configuration

Comments use the configured `commentsDir` value.

Example:

```json
{
  "commentsDir": ".leadcms/comments"
}
```

You can also override it through environment configuration.

## Current Scope

The public SDK currently focuses on reading synchronized comments.

- Public read APIs: available
- Public tree APIs: available
- CLI pull/sync workflow: available
- Public create/update/delete SDK methods: not part of the public API surface yet

For most site integrations, this is enough to render comment lists and threaded discussions safely from local synchronized data.

## Privacy and personal data

- Comment synchronization uses anonymous requests only.
- Pulled comment files are treated as public data snapshots.
- `authorEmail` is used only when creating a new comment and is not retained after the post-push refresh.
- Existing synchronized comments should be rendered from the pulled files, not from authenticated write responses.
