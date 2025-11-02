# LeadCMS SDK - Development Guide

This guide covers the best practices for local development, testing, and debugging of the LeadCMS SDK.

> 📋 **Publishing**: See [GITHUB_ACTIONS.md](./GITHUB_ACTIONS.md) for automated CI/CD and npm publishing setup.

## 🚀 Quick Setup for Local Development

### Method 1: npm link (Recommended)

This is the fastest way to test your package locally with hot reloading:

```bash
# 1. In the SDK directory
cd leadcms.sdk
npm run build
npm link

# 2. Create a test project
mkdir ../leadcms-test-project
cd ../leadcms-test-project
npm init -y
npm link @leadcms/sdk

# 3. Test CLI commands
leadcms init
leadcms docker
leadcms --help
```

### Method 2: Local Installation

For testing the actual installation process:

```bash
# 1. Pack the package
npm pack

# 2. Install in test project
mkdir ../test-project
cd ../test-project
npm init -y
npm install ../leadcms.sdk/leadcms.sdk-1.0.0.tgz

# 3. Test with npx
npx leadcms init
```

## 🔄 Development Workflow

### 1. Start Watch Mode

```bash
npm run dev
```

This will:
- ✅ Compile TypeScript in watch mode
- ✅ Watch for changes in `src/scripts/` and `src/templates/`
- ✅ Auto-copy assets when they change
- ✅ Automatically update the linked global command

### 2. Test Changes

With `npm link` set up, any changes you make will be immediately available:

```bash
# Make changes to src/cli/index.ts
# Save the file
# The global 'leadcms' command is automatically updated
leadcms --help  # Test your changes
```

### 3. Test in Real Project

Create test projects to simulate real usage:

```bash
# Create different framework test projects
mkdir test-nextjs && cd test-nextjs
npm init -y
npm link @leadcms/sdk
echo '{"scripts":{"livepreview":"next dev"}}' > package.json
leadcms docker
```

## 🧪 Testing Different Scenarios

### CLI Commands Testing

```bash
# Test all CLI commands
leadcms init
leadcms docker
leadcms pull
leadcms push --help
leadcms status
leadcms --help

# Test configuration scenarios
LEADCMS_URL=test leadcms pull  # Test env vars (fetch also works as alias)
LEADCMS_URL=test leadcms status  # Test status without credentials
leadcms push --help  # Test push command help
leadcms init  # Test config file creation

# Test push functionality with sample content
cp examples/* .leadcms/content/  # Copy sample files
leadcms status  # Should detect 2 files and 2 content types
rm .leadcms/content/sample-*  # Clean up
```

### SDK Functions Testing

Create a test script to verify SDK functions:

```javascript
// test-sdk.js
const { getCMSContentBySlugForLocale, configure } = require('@leadcms/sdk');

// Test configuration
configure({
  url: 'https://test.com',
  apiKey: 'test-key',
  defaultLanguage: 'en',
  contentDir: '.leadcms/content',
  mediaDir: 'public/media',
  enableDrafts: false
});

console.log('SDK configured successfully!');
```

### Docker Templates Testing

```bash
leadcms docker
ls -la Dockerfile nginx.conf scripts/ preview/
docker build -t test-build .  # Test if Docker builds
```

## � Push/Pull Functionality

### Content Metadata Requirements

For proper push functionality, ensure your local content includes:

```yaml
---
type: "article"                    # Required: Content type
title: "Content Title"             # Required: Display title
slug: "content-slug"               # Optional: Will use filename if missing
language: "en"                     # Optional: Defaults to configured language
publishedAt: "2024-10-29T10:00:00Z" # Required: Publication timestamp
updatedAt: "2024-10-29T10:00:00Z"   # Important: Used for conflict detection
translationKey: "unique-key"       # Optional: For content translations
---
```

### Conflict Detection

The push command uses `updatedAt` timestamps from content metadata (not file system timestamps) to detect conflicts:

- **Local updatedAt** < **Remote updatedAt** = Conflict (remote is newer)
- **Local updatedAt** >= **Remote updatedAt** = Safe to update

### Testing Push Functionality

```bash
# Copy sample content to test directory
cp examples/* .leadcms/content/

# Check what would be synced (dry run)
leadcms status

# Test push with valid credentials
LEADCMS_URL=https://your-instance.com LEADCMS_API_KEY=your-key leadcms push

# Clean up test content
rm .leadcms/content/sample-*
```

## ��� Debugging Tips

### 1. CLI Debugging

Add debug logs to your CLI:

```typescript
console.log('Args:', process.argv);
console.log('Command:', command);
console.log('Template dir:', templateDir);
```

### 2. Permission Issues

If you get "permission denied" errors:

```bash
# Check permissions
ls -la dist/cli/index.js

# Fix permissions (already handled in build script)
chmod +x dist/cli/index.js
```

### 3. Template Issues

```bash
# Check if templates exist in dist
ls -la dist/templates/

# Verify template copying
npm run copy-assets
```

### 4. npm link Issues

If `npm link` isn't working:

```bash
# Unlink and relink
npm unlink -g @leadcms/sdk
npm link

# Check global packages
npm list -g --depth=0
```

## 📦 Testing Package Distribution

### Before Publishing

```bash
# 1. Clean build
npm run clean
npm run build

# 2. Test the package
npm pack
tar -tzf leadcms.sdk-1.0.0.tgz  # Check contents

# 3. Test installation from tarball
mkdir test-install
cd test-install
npm install ../leadcms.sdk-1.0.0.tgz
npx leadcms --help
```

### File Structure Validation

Ensure these files exist in the distribution:

```
dist/
├── cli/
│   └── index.js (executable)
├── lib/
│   ├── cms.js
│   ├── cms.d.ts
│   └── config.js
├── scripts/
│   ├── *.js files (compiled from TypeScript)
│   └── inject-runtime-env.sh (executable)
└── templates/
    ├── docker/
    └── scripts/
```

## 🔄 Automated Testing Setup

Create a test script for common scenarios:

```bash
#!/bin/bash
# test-local.sh

set -e

echo "🧪 Testing LeadCMS SDK locally..."

# Build
npm run build

# Test CLI
echo "✅ Testing CLI help"
./dist/cli/index.js --help

# Test in temporary directory
TEST_DIR=$(mktemp -d)
cd "$TEST_DIR"

echo "✅ Testing init command"
echo "n" | leadcms init
test -f leadcms.config.json || exit 1

echo "✅ Testing docker command"
leadcms docker
test -f Dockerfile || exit 1
test -f preview/Dockerfile || exit 1

echo "🎉 All tests passed!"
cd - && rm -rf "$TEST_DIR"
```

## 🚨 Common Issues & Solutions

### 1. "command not found: leadcms"
```bash
# Solution: Ensure npm link was successful
npm link
which leadcms  # Should show global path
```

### 2. "permission denied"
```bash
# Solution: Fix file permissions
npm run fix-permissions
```

### 3. Templates not found
```bash
# Solution: Ensure assets are copied
npm run copy-assets
ls -la dist/templates/
```

### 4. Changes not reflected
```bash
# Solution: Check if dev mode is running
npm run dev  # Should show watch mode active
```

### 6. ES Module Import Issues ("require is not defined")
```bash
# Problem: Dynamic require() calls in ES modules fail at runtime
# Solution: Use proper ES module imports at the top of files
# ❌ Don't do this:
const { someFunction } = require('./module.js');

# ✅ Do this instead:
import { someFunction } from './module.js';
```

### 7. "Status check failed: Invalid URL" or "Using real API mode: undefined"
```bash
# Problem: Environment variables aren't being loaded
# Solution: Ensure .env file exists in your project root
echo "LEADCMS_URL=https://your-instance.com" > .env
echo "LEADCMS_API_KEY=your-api-key" >> .env

# Or use environment variables directly:
LEADCMS_URL=https://your-instance.com LEADCMS_API_KEY=your-key leadcms status

# Check if .env file exists and is properly formatted:
cat .env
```

### 8. Error messages showing "Push failed" when running status
```bash
# This was fixed in recent versions - update your SDK:
npm update @leadcms/sdk
# Should now show "Status check failed" for status command errors
```

## 📚 Testing Different Package Managers

### npm
```bash
npm link @leadcms/sdk
leadcms --help
```

### yarn
```bash
yarn link @leadcms/sdk
leadcms --help
```

### pnpm
```bash
pnpm link --global @leadcms/sdk
leadcms --help
```

## 🎯 Performance Testing

Monitor build and runtime performance:

```bash
# Build time
time npm run build

# CLI startup time
time leadcms --help

# Package size
du -sh dist/
npm pack --dry-run
```

## 🚀 Release Process

### Quick Release (Automated)

Use the provided release script:

```bash
# Patch release (1.0.0 → 1.0.1)
./scripts/release.sh patch

# Minor release (1.0.0 → 1.1.0)  
./scripts/release.sh minor "Add new features"

# Major release (1.0.0 → 2.0.0)
./scripts/release.sh major "Breaking changes"
```

### Manual Release

```bash
# 1. Update version
npm version patch  # or minor/major

# 2. Push to GitHub
git push origin main --tags

# 3. Create GitHub release (triggers automated npm publish)
# Go to: https://github.com/LeadCMS/leadcms.sdk/releases
```

### Publishing Workflow

1. **Local Development** → Use `npm link` for testing
2. **GitHub Push** → CI validates build on multiple Node versions  
3. **GitHub Release** → Automatically publishes to npm
4. **Verification** → Check npm registry and test installation

> 📚 **Full CI/CD Guide**: See [GITHUB_ACTIONS.md](./GITHUB_ACTIONS.md) for complete setup instructions.

This development setup ensures fast iteration, comprehensive testing, and reliable debugging for the LeadCMS SDK! 🚀
