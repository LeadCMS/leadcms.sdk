# LeadCMS SDK

A comprehensive, framework-agnostic SDK and CLI tools for integrating with LeadCMS. Provides clean access to your LeadCMS content through simple JavaScript/TypeScript functions that work with any framework or static site generator.

## Installation

### For Build-Time Usage (Most Common)
If you only use LeadCMS SDK during the build process (static site generation):

```bash
npm install --save-dev @leadcms/sdk
```

### For Runtime Usage
If you need LeadCMS SDK in your production application (SSR, API routes, live preview):

```bash
npm install @leadcms/sdk
```

### Global CLI Installation
For CLI tools and project setup:

```bash
npm install -g @leadcms/sdk
```

### When to Use Each Installation Method

**Development Dependency (`--save-dev`)** - Recommended for:
- ✅ Static Site Generators (Next.js, Astro, Gatsby, Nuxt)
- ✅ Build-time content fetching and processing
- ✅ Static route generation
- ✅ Content pre-processing during build

**Production Dependency (`--save`)** - Use when you need:
- 🔄 Server-Side Rendering (SSR) with dynamic content
- 🔄 API routes that fetch LeadCMS content at runtime
- 🔄 Live preview functionality in production
- 🔄 Runtime content loading and processing

**Global Installation (`-g`)** - Best for:
- 🛠️ CLI commands across multiple projects
- 🛠️ Project initialization and setup
- 🛠️ Content fetching and Docker template generation

## Quick Start

Get started with LeadCMS in 3 simple steps:

### 1. Initialize Your Project
```bash
npx leadcms init
```
This will:
- Connect to your LeadCMS instance
- Detect available entity types (content, media, comments)
- Create configuration files (`.env` and optionally `leadcms.config.json`)

### 2. Authenticate (for write access)
```bash
npx leadcms login
```
- **LeadCMS v1.2.88+**: Automatic device authentication via browser
- **Older versions**: Guided manual token extraction
- Saves your API token securely to `.env`

**Skip this step** if you only need read-only access to public content.

### 3. Download Your Content
```bash
npx leadcms pull
```
Downloads all content, media, and comments to your local project.

**That's it!** You're ready to use LeadCMS content in your application. See [Usage Examples](#usage-examples) below.

## CI/CD Integration

[![Build & Test](https://github.com/LeadCMS/leadcms.sdk/actions/workflows/build-and-test.yml/badge.svg)](https://github.com/LeadCMS/leadcms.sdk/actions/workflows/build-and-test.yml)

The LeadCMS SDK includes comprehensive CI/CD workflows for GitHub Actions that provide:

### 🧪 Automated Testing
- **Multi-Node Support**: Tests run on Node.js 18, 20, and 22
- **Coverage Reports**: Automatic coverage reporting with visual coverage diffs on PRs
- **Test Results**: Interactive test results displayed directly in GitHub Actions
- **JUnit XML**: Structured test output for integration with external tools

### 📊 Coverage Reporting
- **LCOV Reports**: Line and branch coverage tracking
- **PR Comments**: Automatic coverage comments on pull requests showing coverage changes
- **Coverage Artifacts**: HTML coverage reports archived for 30 days
- **Multiple Formats**: Coverage available in LCOV, HTML, and Clover formats

### 🔧 Quality Checks
- **TypeScript Compilation**: Ensures type safety across all Node.js versions
- **Package Validation**: Verifies package structure and CLI functionality
- **Docker Template Testing**: Validates generated Docker configurations

### Setting Up CI/CD for Your Project

If you're using this SDK in your own project, you can add similar testing workflows:

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm test
```

### Running Tests Locally

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

### Test Coverage

The SDK maintains high test coverage with comprehensive unit tests covering:
- 📄 Content retrieval and parsing
- 🌍 Multi-language support and translations
- 📝 Draft content handling and user-specific overrides
- 🏗️ Build-time optimizations and caching
- 🔧 Configuration management and validation
- 🔄 Push/Pull synchronization with conflict detection
- 🖥️ CLI command functionality with mocked API responses

### Testing with Mock Data

For testing CLI commands locally without a real LeadCMS instance, use the built-in mock data service:

```bash
# Enable mock mode and test status command
LEADCMS_USE_MOCK=true LEADCMS_CONTENT_DIR=./test-content npx leadcms status

# Test with different mock scenarios
LEADCMS_USE_MOCK=true LEADCMS_MOCK_SCENARIO=hasConflicts npx leadcms status
LEADCMS_USE_MOCK=true LEADCMS_MOCK_SCENARIO=mixedOperations npx leadcms push --dry-run
```

**Available Mock Scenarios:**
- `allNew` - Local content that doesn't exist remotely (default)
- `noChanges` - All content is in sync
- `hasConflicts` - Remote content is newer than local
- `hasUpdates` - Local content is newer than remote
- `mixedOperations` - Mix of new, updated, and conflicted content
- `missingContentTypes` - Content with unknown types

**Mock Mode Activation:**
- `NODE_ENV=test` - Automatically uses mock mode
- `LEADCMS_USE_MOCK=true` - Force mock mode

The data service abstraction automatically handles switching between real API calls and mock data based on your environment, providing seamless testing without external dependencies.

## Configuration

LeadCMS SDK supports multiple configuration methods in order of priority:

> **🚀 Quick Start:** Run `npx leadcms init` for an interactive setup wizard that handles everything!

### 1. Environment Variables (Recommended for API credentials)

For security reasons, it's best to keep sensitive credentials as environment variables:

```bash
# Required
LEADCMS_URL=your-leadcms-instance-url

# Optional - API key for authenticated access
# Omit this for public-only mode (published content only)
LEADCMS_API_KEY=your-api-key

# Optional - can also be set via environment variables
LEADCMS_DEFAULT_LANGUAGE=en
LEADCMS_CONTENT_DIR=.leadcms/content
LEADCMS_MEDIA_DIR=public/media
LEADCMS_ENABLE_DRAFTS=true

# Next.js users can also use:
NEXT_PUBLIC_LEADCMS_URL=your-leadcms-instance-url
NEXT_PUBLIC_LEADCMS_DEFAULT_LANGUAGE=en
```

> **� Security Note:** The SDK uses a **security-first approach** - all read operations (content, comments, media sync) are performed WITHOUT authentication, ensuring only public data is retrieved. API keys are only used for write operations. See [Public API Mode Guide](./docs/PUBLIC_API_MODE.md) for details.

### 2. Configuration File (For project-specific settings)

Create a `leadcms.config.json` file **only if you need to override default settings** like `contentDir`, `mediaDir`, or `defaultLanguage`:

```bash
# Initialize configuration file
npx leadcms init
```

```json
{
  "defaultLanguage": "en",
  "contentDir": ".leadcms/content",
  "mediaDir": "public/media",
  "enableDrafts": false
}
```

> **Security Note:** Avoid putting `url` and `apiKey` in config files. Environment variables are safer and work better with deployment platforms.

### 3. Programmatic Configuration

For advanced use cases, you can configure the SDK programmatically:

```typescript
import { configure } from '@leadcms/sdk';

configure({
  url: 'https://your-leadcms-instance.com',
  apiKey: 'your-api-key',
  defaultLanguage: 'en',
  contentDir: '.leadcms/content',
  mediaDir: 'public/media',
  enableDrafts: false
});
```

> **Best Practice:** Use environment variables for `url` and `apiKey`, and programmatic configuration only for project-specific overrides.

### Configuration Options

- `url` - Your LeadCMS instance URL (**required**, best as env var)
- `apiKey` - Your LeadCMS API key (**optional**, omit for public-only mode, best as env var when used)
- `defaultLanguage` - Default language code (default: "en")
- `contentDir` - Directory for downloaded content (default: ".leadcms/content")
- `mediaDir` - Directory for media files (default: "public/media")
- `enableDrafts` - Enable draft content support (default: false, requires API key)

## CLI Usage

### Check SDK version
```bash
npx leadcms version
# or
npx leadcms -v
# or
npx leadcms --version
```

### Initialize configuration
```bash
npx leadcms init
```

Interactive setup wizard that:
1. **Connects to your LeadCMS instance** - Validates URL and checks for existing authentication
2. **Fetches configuration** - Retrieves default language and available languages from public `/api/config` endpoint
3. **Configures directories** - Sets content and media directories (defaults: `.leadcms/content`, `public/media`)
4. **Creates environment file** - Saves configuration to `.env` or `.env.local`
5. **Creates config file** - Only if you use non-default directories (keeps your project clean!)

**Note:** The `/api/config` endpoint is public and works without authentication. For write operations and private content, run `leadcms login` after initialization.

### Login to LeadCMS
```bash
npx leadcms login
```

Authenticates with your LeadCMS instance:
- **Device Authentication** (LeadCMS v1.2.88+) - Opens a browser link for secure authentication
- **Manual Token** (older versions) - Guides you through extracting an API token
- **Saves token** - Automatically stores the token in your `.env` file

**When to use:**
- After running `leadcms init` if you need write access
- To update an expired or invalid token
- When switching between LeadCMS instances

Example session (with existing authentication):
```
🚀 LeadCMS SDK Initialization

Enter your LeadCMS URL: https://your-instance.leadcms.ai

✓ API key found in environment

🔍 Connecting to LeadCMS...
✅ Connected successfully!

📋 Available languages:
   1. English (United States) [en-US] (default)
   2. Russian (Russia) [ru-RU]

Default language code [en-US]: 
✓ Using default language: en-US

📦 Supported entity types:
   ✓ Content
   ✓ Media
   ✓ Comments

Content directory [.leadcms/content]:
Media directory [public/media]:
Comments directory [.leadcms/comments]:

📝 Creating configuration files...

✅ Updated .env
ℹ️  Using default directories, no leadcms.config.json needed.

✨ Configuration complete!

Next steps:
  1. Run: npx leadcms pull (to download content)
  2. Start using LeadCMS content in your project
```

Example session (without authentication):
```
🚀 LeadCMS SDK Initialization

Enter your LeadCMS URL: https://your-instance.leadcms.ai

ℹ️  No API key found.

🔐 Authentication Setup
   Authentication is optional and can be skipped for most use cases.
   • Without authentication: You can pull content and build your site (read-only access)
   • With authentication: You can also push content changes back to LeadCMS
   • You can always authenticate later by running: leadcms login

Would you like to authenticate now? (Y/n): n
ℹ️  Skipping authentication. Continuing in read-only mode.
   You can run "leadcms login" later to authenticate.

🔍 Connecting to LeadCMS...
✅ Connected successfully!

📋 Available languages:
   1. English (United States) [en-US] (default)
   2. Russian (Russia) [ru-RU]

Default language code [en-US]: 
✓ Using default language: en-US

📦 Supported entity types:
   ✓ Content
   ✓ Media
   ✓ Comments

Content directory [.leadcms/content]:
Media directory [public/media]:
Comments directory [.leadcms/comments]:

📝 Creating configuration files...

✅ Updated .env
ℹ️  Using default directories, no leadcms.config.json needed.

✨ Configuration complete!

Next steps:
  1. Run: npx leadcms login (for write access and private content)
  2. Run: npx leadcms pull (to download content)
  3. Start using LeadCMS content in your project
```

The wizard creates:
- **`.env`** (or `.env.local` if exists) with `LEADCMS_URL`, `LEADCMS_DEFAULT_LANGUAGE`, and optionally `LEADCMS_API_KEY`
- **`leadcms.config.json`** only if custom directories are specified

**Anonymous Mode:** Perfect for static sites that only need public content. Omit the API key to skip authentication entirely.

### Generate Docker deployment templates
```bash
npx leadcms docker
# Creates Docker files for production and preview deployments
```

### Pull content and comments from LeadCMS
```bash
npx leadcms pull
```

This command will:
- Sync all content from LeadCMS to local files
- Sync all comments to `.leadcms/comments/` directory
- Update sync tokens for incremental updates

To pull only comments:
```bash
npx leadcms pull-comments
```

> **Note:** `npx leadcms fetch` is still supported as an alias for backward compatibility.

### Push local content to LeadCMS
```bash
npx leadcms push [options]
```

Push your local content changes to LeadCMS. This command will:
- Analyze local MDX/JSON files and compare with remote content
- Detect new content, updates, and conflicts using `updatedAt` timestamps
- Prompt for confirmation before making changes
- Support for creating missing content types automatically
- Update local files with remote metadata (id, createdAt, updatedAt) after sync

**Options:**
- `--force` - Override remote changes (skip conflict check)


**Required Metadata Fields:**
```yaml
---
type: "article"                    # Content type (must exist in LeadCMS)
title: "Article Title"             # Content title
slug: "article-slug"               # URL slug
language: "en"                     # Content language
publishedAt: "2024-10-29T10:00:00Z" # Publication date
updatedAt: "2024-10-29T10:00:00Z"   # Last update (used for conflict detection)
---
```

### Check sync status
```bash
npx leadcms status
```

Shows the current sync status between local and remote content without making any changes.

### Watch for real-time updates
```bash
npx leadcms watch
```

### Generate environment variables file
```bash
npx leadcms generate-env
```



## Framework Integration

The SDK provides framework-agnostic data access. Most frameworks use it as a **development dependency** for build-time static generation:

```typescript
// Next.js Static Generation (Build-time only - devDependency)
export function generateStaticParams() {
  // This runs at BUILD TIME, not runtime
  const routes = getAllContentRoutes();
  return routes.map(route => ({
    slug: route.slugParts,
    ...(route.isDefaultLocale ? {} : { locale: route.locale })
  }));
}

// Astro Static Generation (Build-time only - devDependency)
export function getStaticPaths() {
  // This runs at BUILD TIME, not runtime
  const routes = getAllContentRoutes();
  return routes.map(route => ({
    params: { slug: route.slug },
    props: { locale: route.locale, path: route.path }
  }));
}

// Gatsby Static Generation (Build-time only - devDependency)
exports.createPages = async ({ actions }) => {
  const { createPage } = actions;
  const routes = getAllContentRoutes();

  routes.forEach(route => {
    createPage({
      path: route.path,
      component: path.resolve('./src/templates/content.js'),
      context: { slug: route.slug, locale: route.locale }
    });
  });
};

// Runtime Usage Examples (Production dependency required)

// Next.js API Route (Runtime)
import { getCMSContentBySlugForLocale } from '@leadcms/sdk';

export async function GET(request) {
  // This runs at REQUEST TIME, needs production dependency
  const content = getCMSContentBySlugForLocale('about', 'en');
  return Response.json(content);
}

// Express.js Server (Runtime)
app.get('/api/content/:slug', (req, res) => {
  // This runs at REQUEST TIME, needs production dependency
  const content = getCMSContentBySlugForLocale(req.params.slug, 'en');
  res.json(content);
});
```

## API Reference

### Content API

Get content from your LeadCMS instance:

```typescript
import { 
  getCMSContentBySlugForLocale,
  getAllContentSlugsForLocale,
  getAllContentRoutes 
} from '@leadcms/sdk';

// Get single content item
const content = getCMSContentBySlugForLocale('about-us', 'en');

// Get all content slugs
const slugs = getAllContentSlugsForLocale('en');

// Get all routes for static generation
const routes = getAllContentRoutes();
```

**📖 See [Content Management Guide](./docs/CONTENT_MANAGEMENT.md)** for complete API documentation, framework integration examples, and advanced features.

### Media API

Media files are automatically synced during content pull:

```bash
# Sync all media files
npx leadcms pull

# Sync only media
npx leadcms pull-media
```

**📖 See [Media Management Guide](./docs/MEDIA_MANAGEMENT.md)** for media handling, optimization, and deployment strategies.

### Comments API

Work with comments on your content:

```bash
# Sync comments
npx leadcms pull

# Sync only comments
npx leadcms pull-comments
```

```typescript
import { 
  getCommentsForContent,
  getCommentsTreeForContent 
} from '@leadcms/sdk';

// Get flat list of comments
const comments = getCommentsForContent(contentId);

// Get comments as tree for threading
const tree = getCommentsTreeForContent(contentId, undefined, {
  sortOrder: 'newest',
  replySortOrder: 'oldest'
});
```

**📖 See [Comment Tree Guide](./docs/COMMENT_TREE.md)** for complete documentation on threaded comments, sorting, filtering, and advanced features.

## Docker Deployment

LeadCMS SDK includes framework-agnostic Docker templates for easy deployment:

### Generate Templates

```bash
npx leadcms docker
```

This creates:
- `Dockerfile` - Production static site deployment
- `nginx.conf` - Optimized nginx configuration
- `scripts/inject-runtime-env.sh` - Runtime environment injection
- `preview/Dockerfile` - Development/preview environment
- `preview/nginx.conf` - Development proxy configuration
- `preview/supervisord.conf` - Multi-service management

### Production Deployment

```bash
# 1. Build your static site (framework-specific)
npm run build        # Next.js: creates 'out' directory
# npm run build      # Astro: creates 'dist' directory
# npm run build      # Gatsby: creates 'public' directory

# 2. Build Docker image
docker build -t my-leadcms-site .

# 3. Run container
docker run -p 80:80 \
  -e LEADCMS_URL=https://your-instance.com \
  -e LEADCMS_DEFAULT_LANGUAGE=en \
  my-leadcms-site
```

### Preview/Development Mode

```bash
# 1. Add livepreview script to package.json
{
  "scripts": {
    "livepreview": "next dev",     // Next.js
    // "livepreview": "astro dev", // Astro
    // "livepreview": "gatsby develop", // Gatsby
    // "livepreview": "nuxt dev"   // Nuxt
  }
}

# 2. Build preview image
docker build -f preview/Dockerfile -t my-leadcms-site-preview .

# 3. Run with live updates
docker run -p 80:80 \
  -e LEADCMS_URL=https://your-instance.com \
  -e LEADCMS_API_KEY=your-api-key \
  -e LEADCMS_DEFAULT_LANGUAGE=en \
  my-leadcms-site-preview
```

### Template Features

✅ **Framework-agnostic** - Works with any static site generator
✅ **Production optimized** - Nginx with proper caching headers
✅ **Live preview** - Development mode with hot reload support
✅ **Multi-service** - Nginx proxy + dev server + LeadCMS watcher
✅ **Runtime configuration** - Environment variables injected at startup
✅ **Health checks** - Built-in container health monitoring

### Customizing Templates

After generating templates with `npx leadcms docker`, you can customize:

1. **Source directory** in `Dockerfile`:
   ```dockerfile
   # Change 'out' to your framework's build output:
   COPY dist /usr/share/nginx/html    # Astro
   COPY public /usr/share/nginx/html  # Gatsby
   COPY .output/public /usr/share/nginx/html  # Nuxt
   ```

2. **Nginx configuration** in `nginx.conf` for custom routing rules

3. **Development command** in `preview/supervisord.conf`:
   ```ini
   [program:dev-server]
   command=npm run livepreview    # Your development command
   ```

## Performance & Debugging

### Configuration Caching
The SDK automatically caches configuration files for 60 seconds and content files for 30 seconds to improve build performance. Multiple calls to the same configuration functions will use cached results.

### Debug Logging
Control SDK logging verbosity with environment variables:

```bash
# Enable debug logging (shows configuration loading messages)
LEADCMS_DEBUG=true npm run build

# Production mode (minimal logging)
NODE_ENV=production npm run build
```

Debug mode is automatically enabled when `NODE_ENV=development` or `LEADCMS_DEBUG=true`.

### Error Handling
The SDK provides detailed error information for missing configuration files:

```typescript
import { loadContentConfig, loadContentConfigStrict } from '@leadcms/sdk';

// Graceful handling - returns null for missing files
const config = loadContentConfig('layout'); // Returns null if missing

// Strict handling - throws detailed errors for debugging
try {
  const config = loadContentConfigStrict('layout');
} catch (error) {
  console.log('Missing configuration:', error.configName);
  console.log('Expected locale:', error.locale);
  console.log('Full error:', error.message);
  // Error message includes: configName, locale, and expected file path
}
```

**Error Details Include:**
- `configName` - The specific configuration name that was requested
- `locale` - The locale that was being loaded
- `message` - Full descriptive error including expected file path
- Clear console logging of missing files with exact paths

### Performance Tips
- ✅ Use configuration files instead of programmatic configuration for better caching
- ✅ The SDK caches file reads automatically - no manual optimization needed
- ✅ In production builds, logging is minimal to reduce noise
- ✅ Configuration is cached across multiple function calls within the same process
- ✅ Use `loadContentConfig()` for optional configs, `loadContentConfigStrict()` for required configs

## Features & Documentation

### 📚 Complete Guides

- **[Documentation Index](./docs/INDEX.md)** - Central hub for all documentation

#### Content & Media
- **[Content Management](./docs/CONTENT_MANAGEMENT.md)** - Retrieving, organizing, and working with content
- **[Media Management](./docs/MEDIA_MANAGEMENT.md)** - Handling media files and optimization
- **[Draft Handling](./docs/DRAFT_HANDLING.md)** - Working with draft content and user-specific drafts

#### Comments
- **[Comment Tree Guide](./docs/COMMENT_TREE.md)** - Building threaded comment interfaces with sorting and filtering

#### Setup & Configuration
- **[Interactive Init](./docs/INTERACTIVE_INIT.md)** - Setup wizard and authentication
- **[Public API Mode](./docs/PUBLIC_API_MODE.md)** - Security-first approach and operation modes

#### Development
- **[Development Guide](./docs/DEVELOPMENT.md)** - Local development, testing, and debugging
- **[GitHub Actions](./docs/GITHUB_ACTIONS.md)** - CI/CD setup and automated publishing

## Development

For SDK development and contributions, see [Development Guide](./docs/DEVELOPMENT.md).

**Quick Start:**

```bash
# Clone and setup
git clone https://github.com/LeadCMS/leadcms.sdk.git
cd leadcms.sdk
npm install
npm run build

# Run tests
npm test

# Development mode
npm run dev
```

**Contributing:**

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm test`
5. Submit a pull request
