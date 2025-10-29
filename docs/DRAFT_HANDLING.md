# Draft Content Handling in LeadCMS SDK

## Overview

The LeadCMS SDK now supports draft content handling based on the `publishedAt` field. Content is considered a draft if:

1. `publishedAt` is null or undefined
2. `publishedAt` is a future date (after the current time)

## Default Behavior

By default, all functions that return content will **exclude draft content**. This ensures that only published content is displayed on websites.

## Functions with Draft Support

### Content Fetching Functions

All main content fetching functions now support an optional `includeDrafts` parameter:

```typescript
// Get single content item
getCMSContentBySlug(slug: string, includeDrafts: boolean = false)
getCMSContentBySlugForLocale(slug: string, locale?: string, includeDrafts: boolean = false)

// Get content lists
getAllContentSlugs(contentTypes?: readonly string[], includeDrafts: boolean = false)
getAllContentSlugsForLocale(locale?: string, contentTypes?: readonly string[], includeDrafts?: boolean | null, draftUserUid?: string | null)

// Get translations
getContentTranslations(translationKey: string, includeDrafts: boolean = false)

// Get all routes
getAllContentRoutes(contentTypes?: readonly string[], includeDrafts: boolean = false, draftUserUid?: string | null)
```

### User-Specific Draft Support

For functions that support user-specific drafts (with `userUid` parameter), the behavior is:

- **When `userUid` is provided**: User-specific draft content is **always returned** regardless of `publishedAt` status
- **When `userUid` is not provided**: Standard `publishedAt` draft filtering applies

```typescript
getCMSContentBySlugForLocaleWithDraftSupport(
  slug: string,
  locale: string,
  userUid?: string | null,
  includeDrafts: boolean = false
)
```

## Usage Examples

### Basic Usage (Excludes Drafts by Default)

```typescript
// Only returns published content
const content = getCMSContentBySlug('my-article');
const allSlugs = getAllContentSlugs(['article']);
```

### Including Drafts

```typescript
// Returns all content, including drafts
const contentWithDrafts = getCMSContentBySlug('my-article', true);
const allSlugsWithDrafts = getAllContentSlugs(['article'], true);
```

### User-Specific Drafts

```typescript
// Always returns user's draft if it exists, regardless of publishedAt
// userUid must be a valid GUID format
const userDraft = getCMSContentBySlugForLocaleWithDraftSupport(
  'my-article',
  'en',
  '550e8400-e29b-41d4-a716-446655440000' // Valid GUID format
);

// Example with getAllContentSlugsForLocale
const userSlugs = getAllContentSlugsForLocale(
  'en',
  ['article'],
  true, // includeDrafts
  '6ba7b810-9dad-11d1-80b4-00c04fd430c8' // Valid GUID format
);
```

## User-Specific Draft Files

User-specific draft files are stored with the userUid (GUID) appended to the filename:

```
content/
├── my-article.mdx                                              # Base content
├── my-article-550e8400-e29b-41d4-a716-446655440000.mdx        # User's draft
├── header.json                                                 # Base config
└── header-6ba7b810-9dad-11d1-80b4-00c04fd430c8.json          # User's draft config
```

### GUID Format Requirements

The userUid must follow the standard GUID format:
- Pattern: `XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX`
- 8-4-4-4-12 hexadecimal characters separated by dashes
- Case-insensitive (both uppercase and lowercase accepted)
- Must appear at the end of the filename after a dash

**Valid Examples:**
- `550e8400-e29b-41d4-a716-446655440000`
- `6BA7B810-9DAD-11D1-80B4-00C04FD430C8`
- `123e4567-e89b-12d3-a456-426614174000`

**Invalid Examples:**
- `user-123` (not GUID format)
- `550e8400e29b41d4a716446655440000` (missing dashes)
- `550e8400-e29b-41d4-a716` (incomplete GUID)
- `550e8400-e29b-41d4-a716-44665544000g` (invalid character 'g')

## Draft Detection

The `isContentDraft(content: CMSContent)` utility function can be used to check if content is considered a draft:

```typescript
import { isContentDraft } from './lib/cms';

const content = getCMSContentBySlug('my-article', true); // Include drafts
if (content && isContentDraft(content)) {
  console.log('This content is a draft');
}
```

## Content Structure

Content files should include the `publishedAt` field in their frontmatter (MDX) or properties (JSON):

### MDX Example
```markdown
---
title: "My Article"
type: "article"
publishedAt: "2024-12-01T10:00:00Z"
---

Content here...
```

### JSON Example
```json
{
  "title": "My Article",
  "type": "article",
  "publishedAt": "2024-12-01T10:00:00Z",
  "body": "Content here..."
}
```

## Migration Notes

- Existing content without `publishedAt` will be treated as drafts
- To publish existing content, add a `publishedAt` date in the past
- The SDK automatically converts string dates to Date objects for consistent handling
