# Content Management Guide

## Overview

The LeadCMS SDK provides comprehensive content management functionality for retrieving, organizing, and working with your CMS content. All operations are framework-agnostic and work seamlessly with Next.js, Astro, Gatsby, Nuxt, and other static site generators.

## Quick Start

```typescript
import { getCMSContentBySlugForLocale } from '@leadcms/sdk';

// Get a single content item
const content = getCMSContentBySlugForLocale('about-us', 'en');

console.log(content.title); // Content title
console.log(content.body);  // Content body
```

## Core Functions

### Get Content by Slug

```typescript
import { 
  getCMSContentBySlug,
  getCMSContentBySlugForLocale 
} from '@leadcms/sdk';

// Get content for default locale
const content = getCMSContentBySlug('about-us');

// Get content for specific locale
const localizedContent = getCMSContentBySlugForLocale('about-us', 'fr');

// Include draft content
const withDrafts = getCMSContentBySlugForLocale('about-us', 'en', true);
```

### Get All Content Slugs

```typescript
import { 
  getAllContentSlugs,
  getAllContentSlugsForLocale 
} from '@leadcms/sdk';

// Get all slugs (default locale)
const allSlugs = getAllContentSlugs();

// Get slugs for specific locale
const frenchSlugs = getAllContentSlugsForLocale('fr');

// Filter by content type
const articles = getAllContentSlugsForLocale('en', ['article']);

// Include drafts
const withDrafts = getAllContentSlugsForLocale('en', ['article'], true);
```

### Get All Routes

Perfect for static site generation:

```typescript
import { getAllContentRoutes } from '@leadcms/sdk';

// Get all routes for all locales
const routes = getAllContentRoutes();

// Each route includes:
// {
//   locale: 'en',
//   slug: 'about-us',
//   slugParts: ['about-us'],
//   isDefaultLocale: true,
//   path: '/about-us'
// }

// Filter by content type
const articleRoutes = getAllContentRoutes(['article']);

// Include drafts
const routesWithDrafts = getAllContentRoutes(['article'], true);
```

## Framework Integration

### Next.js (App Router)

```typescript
// app/[...slug]/page.tsx
import { getCMSContentBySlugForLocale, getAllContentRoutes } from '@leadcms/sdk';

export function generateStaticParams() {
  const routes = getAllContentRoutes();
  return routes.map(route => ({
    slug: route.slugParts
  }));
}

export default function Page({ params }) {
  const slug = params.slug?.join('/') || 'home';
  const content = getCMSContentBySlugForLocale(slug, 'en');
  
  return (
    <article>
      <h1>{content.title}</h1>
      <div dangerouslySetInnerHTML={{ __html: content.body }} />
    </article>
  );
}
```

### Astro

```astro
---
// src/pages/[...slug].astro
import { getCMSContentBySlugForLocale, getAllContentRoutes } from '@leadcms/sdk';

export function getStaticPaths() {
  const routes = getAllContentRoutes();
  return routes.map(route => ({
    params: { slug: route.slug },
    props: { content: getCMSContentBySlugForLocale(route.slug, route.locale) }
  }));
}

const { content } = Astro.props;
---

<article>
  <h1>{content.title}</h1>
  <div set:html={content.body} />
</article>
```

### Gatsby

```javascript
// gatsby-node.js
const { getAllContentRoutes, getCMSContentBySlugForLocale } = require('@leadcms/sdk');

exports.createPages = async ({ actions }) => {
  const { createPage } = actions;
  const routes = getAllContentRoutes();

  routes.forEach(route => {
    createPage({
      path: route.path,
      component: path.resolve('./src/templates/content.js'),
      context: {
        slug: route.slug,
        locale: route.locale
      }
    });
  });
};
```

## Content Structure

### CMSContent Interface

```typescript
interface CMSContent {
  id?: number;                    // Content ID (from LeadCMS)
  slug: string;                   // URL-friendly identifier
  type: string;                   // Content type (e.g., 'article', 'page')
  title: string;                  // Content title
  body: string;                   // Main content body
  language?: string;              // Content language code
  publishedAt?: Date | string;    // Publication date
  createdAt?: Date | string;      // Creation date
  updatedAt?: Date | string;      // Last update date
  translationKey?: string;        // For linking translations
  [key: string]: any;             // Custom fields
}
```

### File Formats

**MDX Format:**
```markdown
---
title: "About Us"
type: "page"
slug: "about-us"
language: "en"
publishedAt: "2024-01-01T00:00:00Z"
---

# About Us

Welcome to our company...
```

**JSON Format:**
```json
{
  "title": "About Us",
  "type": "page",
  "slug": "about-us", 
  "language": "en",
  "publishedAt": "2024-01-01T00:00:00Z",
  "body": "{\"heading\":\"About Us\",\"description\":\"Welcome to our company\",\"sections\":[{\"title\":\"Our Story\",\"content\":\"We started in 2020...\"}]}"
}
```

Note: In JSON format files, the `body` field contains structured JSON data as a stringified JSON object.

## Multi-Language Support

### Get Available Languages

```typescript
import { getAvailableLanguages } from '@leadcms/sdk';

const languages = getAvailableLanguages();
// Returns: ['en', 'fr', 'de', ...]
```

### Get Content Translations

```typescript
import { getContentTranslations } from '@leadcms/sdk';

// Get all translations of a content item
const translations = getContentTranslations('home-page-key');

// Returns:
// [
//   { locale: 'en', content: {...} },
//   { locale: 'fr', content: {...} },
//   { locale: 'de', content: {...} }
// ]
```

### Locale-Aware Links

```typescript
import { makeLocaleAwareLink, getLocaleFromPath } from '@leadcms/sdk';

// Create locale-aware link
const link = makeLocaleAwareLink('/about', 'fr', 'en');
// Returns: '/fr/about' (if 'fr' is not default locale)

// Extract locale from path
const locale = getLocaleFromPath('/fr/about', 'en');
// Returns: 'fr'
```

## Configuration Loading

### Load Config Files

```typescript
import { 
  loadContentConfig,
  loadContentConfigStrict,
  getHeaderConfig,
  getFooterConfig 
} from '@leadcms/sdk';

// Generic config loading (returns null if not found)
const menuConfig = loadContentConfig('menu', 'en');

// Strict loading (throws error if not found)
try {
  const requiredConfig = loadContentConfigStrict('layout', 'en');
} catch (error) {
  console.error('Missing config:', error.message);
}

// Convenience functions for common configs
const header = getHeaderConfig('en');
const footer = getFooterConfig('en');
```

### User-Specific Config

```typescript
// Load config with user override (userUid must be valid GUID)
const userMenu = loadContentConfig(
  'menu',
  'en',
  '550e8400-e29b-41d4-a716-446655440000'
);
```

## Syncing Content

### Pull Content from LeadCMS

```bash
# Pull all content
npx leadcms pull

# Pull only content (no media, no comments)
npx leadcms pull-content

# Check sync status
npx leadcms status
```

### Push Content to LeadCMS

```bash
# Push local changes
npx leadcms push

# Dry run (see what would be pushed)
npx leadcms push --dry-run

# Force push (override conflicts)
npx leadcms push --force
```

**Content frontmatter for Push (required and optional fields):**
```yaml
---
type: "article"                    # required: Content type (must exist in LeadCMS)
title: "Article Title"             # required: Content title
slug: "article-slug"               # required: URL slug (unique per locale)
language: "en"                     # required: Content language
publishedAt: "2024-01-01T00:00:00Z" # optional: Publication date (omit to create a draft or schedule a future publish)
# updatedAt: "2024-01-01T00:00:00Z"   # optional: maintained by the server; do not set for new content
---
```

Notes:
- `publishedAt` is optional. Omitting it is a valid way to create draft or scheduled content depending on your LeadCMS workflow.
- `updatedAt` is typically set and maintained by the LeadCMS server after content is created or updated. The SDK will use `updatedAt` when present for conflict detection, but you should not rely on it being set for brand-new local files.

## Draft Content

See [Draft Handling Guide](./DRAFT_HANDLING.md) for complete documentation.

**Quick Examples:**

```typescript
// Exclude drafts (default)
const published = getCMSContentBySlugForLocale('article', 'en');

// Include drafts
const withDrafts = getCMSContentBySlugForLocale('article', 'en', true);

// User-specific drafts
const userDraft = getCMSContentBySlugForLocaleWithDraftSupport(
  'article',
  'en',
  '550e8400-e29b-41d4-a716-446655440000'
);

// Check if content is draft
import { isContentDraft } from '@leadcms/sdk';
if (isContentDraft(content)) {
  console.log('This is a draft');
}
```

## Content Organization

### Directory Structure

```
.leadcms/
  content/
    en/                    # English content
      home.mdx
      about.mdx
      articles/
        article-1.mdx
        article-2.mdx
    fr/                    # French content
      home.mdx
      about.mdx
      articles/
        article-1.mdx
    header.json            # Config files (no locale subdirectory)
    footer.json
```

### Content Types

Content types are automatically detected from your LeadCMS instance:

```bash
# View available content types
npx leadcms status
```

Filter by content type in your code:

```typescript
// Only get articles
const articles = getAllContentSlugsForLocale('en', ['article']);

// Multiple types
const content = getAllContentSlugsForLocale('en', ['article', 'page']);
```

## Performance & Caching

The SDK automatically caches:
- **Config files**: 60 seconds
- **Content files**: 30 seconds

For better performance:
- Use build-time content fetching (SSG) over runtime (SSR)
- Filter by content type when possible
- Use configuration files instead of programmatic config

## Error Handling

### Graceful Error Handling

```typescript
// Returns null if not found
const content = getCMSContentBySlugForLocale('missing', 'en');
if (!content) {
  console.log('Content not found');
}

// Returns empty array if not found
const slugs = getAllContentSlugsForLocale('invalid-locale');
```

### Strict Error Handling

```typescript
// Throws detailed errors
try {
  const config = loadContentConfigStrict('required-config', 'en');
} catch (error) {
  console.error('Config error:', error.message);
  // Error includes: configName, locale, expected path
}
```

## TypeScript Support

Full TypeScript support with comprehensive type definitions:

```typescript
import type { CMSContent, CMSContentTemplateProps } from '@leadcms/sdk';

// Type-safe content access
const content: CMSContent = getCMSContentBySlugForLocale('about', 'en');

// Type-safe template props
interface PageProps extends CMSContentTemplateProps {
  // Your additional props
}
```

## Related Documentation

- [Draft Handling](./DRAFT_HANDLING.md) - Working with draft content
- [Comment Tree](./COMMENT_TREE.md) - Managing comments
- [Media Management](./MEDIA_MANAGEMENT.md) - Working with media files
- [Public API Mode](./PUBLIC_API_MODE.md) - Security and authentication
- [README](../README.md) - Main documentation
