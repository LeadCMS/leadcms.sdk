# LeadCMS SDK Documentation

Complete documentation for the LeadCMS SDK - a framework-agnostic TypeScript/JavaScript SDK for LeadCMS integration.

## Getting Started

- **[Main README](../README.md)** - Installation, quick start, and API reference
- **[Interactive Init](./INTERACTIVE_INIT.md)** - Setup wizard guide

## Features

### Content & Media
- **[Content Management](./CONTENT_MANAGEMENT.md)** - Retrieving and organizing content
- **[Media Management](./MEDIA_MANAGEMENT.md)** - Working with media files
- **[Draft Handling](./DRAFT_HANDLING.md)** - Working with draft content and user-specific drafts

### Comments
- **[Comment Tree](./COMMENT_TREE.md)** - Building threaded comment interfaces

### Security
- **[Public API Mode](./PUBLIC_API_MODE.md)** - Security-first approach and operation modes

## Development

- **[Development Guide](./DEVELOPMENT.md)** - Local development, testing, and debugging
- **[GitHub Actions](./GITHUB_ACTIONS.md)** - CI/CD setup and automated publishing

## Quick Links

### For Users
1. [Installation](../README.md#installation)
2. [Quick Start](../README.md#quick-start)
3. [Configuration](../README.md#configuration)
4. [API Reference](../README.md#api-reference)

### For Developers
1. [Development Setup](./DEVELOPMENT.md#-quick-setup)
2. [Testing](./DEVELOPMENT.md#-testing)
3. [Publishing](./GITHUB_ACTIONS.md#publishing)

### Common Tasks

**Setup Project:**
```bash
npx leadcms init
npx leadcms pull
```

**Get Content:**
```typescript
import { getCMSContentBySlugForLocale } from '@leadcms/sdk';
const content = getCMSContentBySlugForLocale('about', 'en');
```

**Work with Comments:**
```typescript
import { getCommentsTreeForContent } from '@leadcms/sdk';
const tree = getCommentsTreeForContent(contentId);
```

**Handle Media:**
```bash
npx leadcms pull-media
```

**Handle Drafts:**
```typescript
import { getCMSContentBySlug } from '@leadcms/sdk';
const withDrafts = getCMSContentBySlug('article', true);
```

**Public Mode:**
```bash
# No API key needed for public content
echo "LEADCMS_URL=https://cms.example.com" > .env
npx leadcms pull
```

## Documentation Structure

```
docs/
├── INDEX.md                    # This file - Documentation hub
├── CONTENT_MANAGEMENT.md      # Content retrieval and organization
├── MEDIA_MANAGEMENT.md        # Media file handling
├── COMMENT_TREE.md            # Comment tree and threading
├── DRAFT_HANDLING.md          # Draft content handling
├── PUBLIC_API_MODE.md         # Security and authentication
├── INTERACTIVE_INIT.md        # Setup wizard guide
├── DEVELOPMENT.md             # SDK development guide
└── GITHUB_ACTIONS.md          # CI/CD and publishing
```

## Support

- **Issues:** [GitHub Issues](https://github.com/LeadCMS/leadcms.sdk/issues)
- **Repository:** [GitHub](https://github.com/LeadCMS/leadcms.sdk)
- **NPM Package:** [@leadcms/sdk](https://www.npmjs.com/package/@leadcms/sdk)

## Version

Current version: **2.2.1**

For version history, see the [releases](https://github.com/LeadCMS/leadcms.sdk/releases) page.
