# GitHub Actions & CI/CD Setup

This guide explains how to set up automated testing and publishing for the LeadCMS SDK.

## Workflows

### Build & Test (`.github/workflows/build-and-test.yml`)

**Triggers:** Push/PR to main/develop branches

**Features:**
- Tests on Node.js 18, 20, 22
- Jest test execution with coverage
- Package validation
- CLI functionality tests
- Docker template generation tests
- Coverage reports and PR comments

### Publish (`.github/workflows/publish.yml`)

**Triggers:** GitHub releases, manual dispatch

**Features:**
- Automated npm publishing
- Provenance tracking
- Version validation
- Deployment summaries

## Setup

### 1. Create NPM Token

```bash
npm login
npm token create --type=automation
```

Choose "Automation" type for CI/CD.

### 2. Configure GitHub

1. Push code to GitHub
2. Go to `Settings` → `Secrets and variables` → `Actions`
3. Add `NPM_TOKEN` secret with your token

## Publishing

### Using Release Script (Recommended)

```bash
# Patch (1.0.0 → 1.0.1)
./scripts/release.sh patch

# Minor (1.0.0 → 1.1.0)
./scripts/release.sh minor "Add features"

# Major (1.0.0 → 2.0.0)
./scripts/release.sh major "Breaking changes"
```

### Manual Release

```bash
# 1. Create and push tag
git tag v1.0.0
git push origin v1.0.0

# 2. Create GitHub release from tag
# GitHub Actions will automatically publish to npm
```

## Testing

### Local

```bash
# Run tests
npm test

# With coverage
npm run test:coverage

# CI mode
./tests/run-tests.sh
```

### CI

Tests run automatically on:
- Every push to main/develop
- Every pull request
- Before publishing

## Verification

After publishing:

```bash
# Check npm registry
npm view @leadcms/sdk

# Test installation
npm install -g @leadcms/sdk@latest
leadcms --help
```

## Monitoring

- **Actions tab** - View workflow runs
- **npm package page** - Download statistics
- **Coverage reports** - Archived as artifacts

## Troubleshooting

### NPM_TOKEN Invalid
```
Error: Unable to authenticate
```
**Solution:** Regenerate token and update GitHub secret

### Permission Denied
```
Error: 403 Forbidden
```
**Solution:** Verify package name and token permissions

### Build Failures
```
Error: Cannot find module
```
**Solution:** Check dependencies in package.json

## Security

✅ Use automation tokens for CI/CD  
✅ Enable 2FA on npm account  
✅ Regularly rotate tokens  
✅ Use provenance publishing  
✅ Monitor download activity

## Related Documentation

- [DEVELOPMENT.md](./DEVELOPMENT.md) - Local development guide
- [README.md](../README.md) - Main documentation
