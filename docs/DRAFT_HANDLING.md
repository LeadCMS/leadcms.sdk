# Draft Content Handling

## Overview

The SDK supports draft content based on the `publishedAt` field. Content is considered a draft if:

1. `publishedAt` is null or undefined
2. `publishedAt` is a future date

**Default behavior:** All content functions exclude drafts unless explicitly requested.

## Preview Mode (Zero Configuration)

The SDK automatically detects preview slugs and enables draft content access without requiring explicit configuration. This is the **recommended approach** for preview functionality.

### How It Works

When you use a slug containing a GUID pattern (e.g., `home-550e8400-e29b-41d4-a716-446655440000`), the SDK automatically:

1. Detects the GUID suffix in the slug
2. Extracts the base slug and userUid
3. Enables draft content access for this request
4. Returns the user's draft version if it exists, otherwise falls back to base content

### Usage

```typescript
import { getCMSContentBySlugForLocale } from '@leadcms/sdk';

// Normal slug - only returns published content
const published = getCMSContentBySlugForLocale('home', 'en');
// Returns: null (if content has no publishedAt)

// Preview slug - automatically enables draft access
const preview = getCMSContentBySlugForLocale(
  'home-550e8400-e29b-41d4-a716-446655440000',
  'en'
);
// Returns: draft content even without publishedAt
```

### Benefits

- **Zero Configuration**: Works automatically with LeadCMS preview URLs
- **Secure**: Only preview slugs (with valid GUID) can access drafts
- **Backward Compatible**: Normal slugs continue to require `publishedAt`
- **Developer-Friendly**: No additional parameters or mode switching needed

### Use Cases

1. **Content Preview**: Preview pages before publishing
2. **LeadCMS Preview URLs**: Seamless integration with LeadCMS-generated preview links
3. **Draft Review**: Review drafts in staging environments
4. **Development Workflow**: Test content during local development

## Usage

### Exclude Drafts (Default)

```typescript
import { getCMSContentBySlug, getAllContentSlugs } from '@leadcms/sdk';

// Only returns published content
const content = getCMSContentBySlug('my-article');
const slugs = getAllContentSlugs(['article']);
```

### Include Drafts

```typescript
// Include drafts by passing true
const contentWithDrafts = getCMSContentBySlug('my-article', true);
const allSlugs = getAllContentSlugs(['article'], true);
```

### User-Specific Drafts

Functions supporting `userUid` always return user-specific drafts regardless of `publishedAt`:

```typescript
// User drafts are always returned if they exist
const userDraft = getCMSContentBySlugForLocaleWithDraftSupport(
  'my-article',
  'en',
  '550e8400-e29b-41d4-a716-446655440000' // Valid GUID
);
```

## User Draft Files

User-specific draft files use GUID suffix:

```
content/
├── my-article.mdx                                              # Base content
├── my-article-550e8400-e29b-41d4-a716-446655440000.mdx        # User's draft
├── header.json                                                 # Base config
└── header-6ba7b810-9dad-11d1-80b4-00c04fd430c8.json          # User's draft
```

### GUID Format

The `userUid` must follow standard GUID format:
- Pattern: `XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX`
- 8-4-4-4-12 hexadecimal characters
- Case-insensitive

**Valid:**
- `550e8400-e29b-41d4-a716-446655440000`
- `6BA7B810-9DAD-11D1-80B4-00C04FD430C8`

**Invalid:**
- `user-123` (not GUID format)
- `550e8400e29b41d4a716446655440000` (missing dashes)

## Check Draft Status

```typescript
import { isContentDraft, getCMSContentBySlug } from '@leadcms/sdk';

const content = getCMSContentBySlug('my-article', true);
if (content && isContentDraft(content)) {
  console.log('This content is a draft');
}
```
