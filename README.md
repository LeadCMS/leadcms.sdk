# LeadCMS SDK

A comprehensive SDK and CLI tools for integrating with LeadCMS in Next.js projects.

## Installation

```bash
npm install @yourorg/leadcms-sdk
```

## Configuration

Set the following environment variables:

```bash
NEXT_PUBLIC_LEADCMS_URL=your-leadcms-instance-url
LEADCMS_API_KEY=your-api-key
NEXT_PUBLIC_LEADCMS_DEFAULT_LANGUAGE=en  # optional, defaults to 'en'
```

## CLI Usage

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

## Programmatic Usage

```typescript
import { getCMSContentBySlugForLocale, getAllContentSlugsForLocale } from '@yourorg/leadcms-sdk';

// Fetch content by slug
const content = getCMSContentBySlugForLocale('about-us', '.leadcms/content', 'en');

// Get all content slugs
const slugs = getAllContentSlugsForLocale('.leadcms/content', 'en');
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