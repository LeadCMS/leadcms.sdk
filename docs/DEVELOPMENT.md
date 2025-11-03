# LeadCMS SDK - Development Guide

This guide covers SDK development, testing, and local development workflows. For publishing and CI/CD, see [GITHUB_ACTIONS.md](./GITHUB_ACTIONS.md).

## 🚀 Quick Setup

### Using npm link (Recommended)

```bash
# 1. In the SDK directory
cd leadcms.sdk
npm install
npm run build
npm link

# 2. Create a test project
mkdir ../test-project
cd ../test-project
npm init -y
npm link @leadcms/sdk

# 3. Test CLI commands
leadcms --help
leadcms init
```

## 🔄 Development Workflow

### Watch Mode

```bash
npm run dev
```

This will:
- Compile TypeScript in watch mode
- Auto-copy templates when changed
- Update the global `leadcms` command automatically

### Testing Changes

With `npm link` set up, changes are immediately available:

```bash
# Make changes to src/cli/index.ts
# Save the file
# Test immediately
leadcms --help
```

## 🧪 Testing

### Run Tests

```bash
# All tests
npm test

# With coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

### Test Coverage

Current coverage: **60%** (144 tests)

Coverage reports are generated in `coverage/` directory.

## 🔍 Debugging

### CLI Debugging

Add debug logs:

```typescript
console.log('[DEBUG] Args:', process.argv);
console.log('[DEBUG] Command:', command);
```

### Common Issues

**Permission denied:**
```bash
chmod +x dist/cli/index.js
```

**Templates not found:**
```bash
# Verify templates exist
ls -la dist/templates/
```

**npm link not working:**
```bash
# Unlink and relink
npm unlink -g @leadcms/sdk
npm link
npm list -g --depth=0
```

## 📦 Testing Package Distribution

### Before Publishing

```bash
# 1. Clean build
npm run clean
npm run build

# 2. Pack and inspect
npm pack
tar -tzf leadcms-sdk-*.tgz

# 3. Test from tarball
mkdir ../test-install
cd ../test-install
npm install ../leadcms.sdk/leadcms-sdk-*.tgz
npx leadcms --help
```

## 🔧 SDK Testing Script

Create `test-sdk.js`:

```javascript
const { getCMSContentBySlugForLocale, configure } = require('@leadcms/sdk');

configure({
  url: 'https://test.com',
  defaultLanguage: 'en',
  contentDir: '.leadcms/content',
  mediaDir: 'public/media'
});

console.log('✅ SDK configured successfully');
```

## 🎯 Release Process

Use the automated release script:

```bash
# Patch release (1.0.0 → 1.0.1)
./scripts/release.sh patch

# Minor release (1.0.0 → 1.1.0)
./scripts/release.sh minor "Add new features"

# Major release (1.0.0 → 2.0.0)
./scripts/release.sh major "Breaking changes"
```

**Next Steps:**
1. Script creates tag and pushes to GitHub
2. Create GitHub release from the tag
3. GitHub Actions automatically publishes to npm

For detailed publishing setup, see [GITHUB_ACTIONS.md](./GITHUB_ACTIONS.md).

## 🚨 Common Issues

### "command not found: leadcms"
```bash
npm link
which leadcms
```

### ES Module Import Issues
Use ES module syntax at top of files:
```typescript
// ✅ Do this
import { someFunction } from './module.js';

// ❌ Not this
const { someFunction } = require('./module.js');
```

### Environment Variables Not Loading
```bash
# Ensure .env exists
echo "LEADCMS_URL=https://your-instance.com" > .env
cat .env
```

## 📚 Package Managers

### npm
```bash
npm link @leadcms/sdk
```

### yarn
```bash
yarn link @leadcms/sdk
```

### pnpm
```bash
pnpm link --global @leadcms/sdk
```

## Related Documentation

- [GITHUB_ACTIONS.md](./GITHUB_ACTIONS.md) - CI/CD and publishing setup
- [README.md](../README.md) - Main SDK documentation
- [INTERACTIVE_INIT.md](./INTERACTIVE_INIT.md) - Init command details
