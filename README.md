# LeadCMS SDK

A comprehensive, framework-agnostic SDK and CLI tools for integrating with LeadCMS. Provides clean access to your LeadCMS content through simple JavaScript/TypeScript functions that work with any framework or static site generator.

## Installation

```bash
npm install @leadcms/sdk
```

## Configuration

LeadCMS SDK supports multiple configuration methods in order of priority:

### 1. Configuration File (Recommended)

Create a `leadcms.config.json` file in your project root:

```bash
# Initialize configuration file
npx leadcms init
```

```json
{
  "url": "https://your-leadcms-instance.com",
  "apiKey": "your-api-key-here",
  "defaultLanguage": "en",
  "contentDir": ".leadcms/content",
  "mediaDir": "public/media",
  "enableDrafts": false
}
```

> **Note:** Content types are automatically detected from your LeadCMS API - no need to configure them manually!

### 2. Programmatic Configuration

```typescript
import { configure } from '@leadcms/sdk';

configure({
  url: 'https://your-leadcms-instance.com',
  apiKey: 'your-api-key',
  defaultLanguage: 'en'
});
```

### 3. Environment Variables (Fallback)

```bash
# Required
LEADCMS_URL=your-leadcms-instance-url
LEADCMS_API_KEY=your-api-key

# Optional
LEADCMS_DEFAULT_LANGUAGE=en
LEADCMS_CONTENT_DIR=.leadcms/content
LEADCMS_MEDIA_DIR=public/media

# Next.js users can also use:
NEXT_PUBLIC_LEADCMS_URL=your-leadcms-instance-url
NEXT_PUBLIC_LEADCMS_DEFAULT_LANGUAGE=en
```

## CLI Usage

### Initialize configuration
```bash
npx leadcms init
# Creates leadcms.config.json with sample configuration
```

### Fetch content from LeadCMS
```bash
npx leadcms fetch
```

### Watch for real-time updates
```bash
npx leadcms watch
```

### Generate environment variables file
```bash
npx leadcms generate-env
```

## Core Functions

```typescript
import { 
  getCMSContentBySlugForLocale, 
  getAllContentSlugsForLocale,
  getAllContentRoutes,
  getAvailableLanguages,
  configure 
} from '@leadcms/sdk';

// Option 1: Use configuration file (recommended)
// Content directory from config: .leadcms/content
const content = getCMSContentBySlugForLocale('about-us', undefined, 'en');

// Option 2: Programmatic configuration
configure({
  url: 'https://your-instance.com',
  apiKey: 'your-key',
  contentDir: '.leadcms/content'
});

// Option 3: Specify content directory explicitly
const content = getCMSContentBySlugForLocale('about-us', '.leadcms/content', 'en');

// Get all content slugs for a locale
const slugs = getAllContentSlugsForLocale('.leadcms/content', 'en');

// Get all routes (framework-agnostic)
const routes = getAllContentRoutes('.leadcms/content');
// Returns: [{ locale: 'en', slug: 'about-us', path: '/about-us', ... }]

// Get available languages (uses configured contentDir if not specified)
const languages = getAvailableLanguages();

// Get content with draft support
const draftContent = getCMSContentBySlugForLocaleWithDraftSupport(
  'about-us', 
  '.leadcms/content', 
  'en', 
  'user-uuid-for-drafts'
);

// Load configuration objects
const headerConfig = getHeaderConfig('.leadcms/content', 'en');
const footerConfig = getFooterConfig('.leadcms/content', 'en');
```

## Framework Integration

The SDK provides framework-agnostic data access. You can easily build framework-specific helpers in your project:

```typescript
// Example: Next.js App Router helper
export function generateStaticParams() {
  const routes = getAllContentRoutes('.leadcms/content');
  return routes.map(route => ({
    slug: route.slugParts,
    ...(route.isDefaultLocale ? {} : { locale: route.locale })
  }));
}

// Example: Astro helper
export function getStaticPaths() {
  const routes = getAllContentRoutes('.leadcms/content');
  return routes.map(route => ({
    params: { slug: route.slug },
    props: { locale: route.locale, path: route.path }
  }));
}
```

## Docker Support

The SDK includes Docker templates for:
- Production deployment
- Preview environment with live updates

Copy the Docker files from the package and customize as needed.

## Development

```bash
npm run build    # Build the SDK
npm run dev      # Watch mode for development
```
