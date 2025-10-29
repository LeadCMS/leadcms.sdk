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

## CI/CD Integration

[![CI](https://github.com/LeadCMS/leadcms-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/LeadCMS/leadcms-sdk/actions/workflows/ci.yml)

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

## Configuration

LeadCMS SDK supports multiple configuration methods in order of priority:

### 1. Environment Variables (Recommended for API credentials)

For security reasons, it's best to keep sensitive credentials as environment variables:

```bash
# Required - keep these as environment variables for security
LEADCMS_URL=your-leadcms-instance-url
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
- `apiKey` - Your LeadCMS API key (**required**, best as env var)
- `defaultLanguage` - Default language code (default: "en")
- `contentDir` - Directory for downloaded content (default: ".leadcms/content")
- `mediaDir` - Directory for media files (default: "public/media")
- `enableDrafts` - Enable draft content support (default: false)

## CLI Usage

### Initialize configuration
```bash
npx leadcms init
# Creates leadcms.config.json with sample configuration
```

### Generate Docker deployment templates
```bash
npx leadcms docker
# Creates Docker files for production and preview deployments
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

### Core Functions

```typescript
import {
  getCMSContentBySlugForLocale,
  getAllContentSlugsForLocale,
  getAllContentRoutes,
  getAvailableLanguages,
  configure
} from '@leadcms/sdk';

// Get content by slug and locale
const content = getCMSContentBySlugForLocale('about-us', 'en');

// Get all content slugs for a locale
const slugs = getAllContentSlugsForLocale('en');

// Get all routes (framework-agnostic)
const routes = getAllContentRoutes();
// Returns: [{ locale: 'en', slug: 'about-us', path: '/about-us', ... }]

// Get available languages (uses configured contentDir)
const languages = getAvailableLanguages();

// Get content with draft support (userUid must be a valid GUID)
const draftContent = getCMSContentBySlugForLocaleWithDraftSupport(
  'about-us',
  'en',
  '550e8400-e29b-41d4-a716-446655440000' // Valid GUID format
);

// Load configuration objects (header, footer, etc.)
const headerConfig = getHeaderConfig('en');
const footerConfig = getFooterConfig('en');
```

### Advanced Configuration Loading

```typescript
import {
  loadContentConfig,
  loadContentConfigStrict
} from '@leadcms/sdk';

// Generic config loading with auto contentDir resolution (userUid must be valid GUID)
const menuConfig = loadContentConfig('menu', 'en', '6ba7b810-9dad-11d1-80b4-00c04fd430c8');

// Strict config loading with detailed error information (throws on missing files)
try {
  const requiredConfig = loadContentConfigStrict('layout', 'en');
} catch (error) {
  console.log('Missing config:', error.configName);
  console.log('Expected locale:', error.locale);
  console.log('Expected path:', error.message);
}
```

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

## Development

For SDK development and contributions:

```bash
# Clone and setup
git clone https://github.com/LeadCMS/leadcms.sdk.git
cd leadcms-sdk
npm install

# Development workflow
npm run build    # Build the SDK
npm run dev      # Watch mode for development
npm run test     # Run tests
npm run clean    # Clean build artifacts

# Local testing with npm link
npm link
cd ../your-test-project
npm link @leadcms/sdk
```

### Debug Mode

Enable detailed logging during development:

```bash
LEADCMS_DEBUG=true npm run build
```

### Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm run test`
5. Submit a pull request

For detailed development setup, see [DEVELOPMENT.md](./DEVELOPMENT.md).
