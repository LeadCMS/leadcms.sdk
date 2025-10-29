# GitHub Actions Setup for LeadCMS SDK

This guide explains how to set up automated CI/CD for the LeadCMS SDK using GitHub Actions.

## 🚀 Overview

The repository includes two GitHub Actions workflows:

1. **CI Workflow** (`.github/workflows/ci.yml`) - Runs on every push and PR
2. **Publish Workflow** (`.github/workflows/publish.yml`) - Runs on releases

## 📋 Prerequisites

### 1. NPM Account Setup

1. Create an account on [npmjs.com](https://www.npmjs.com)
2. Enable 2FA on your npm account
3. Create an access token:
   ```bash
   npm login
   npm token create --type=automation
   ```
   **Important**: Choose "Automation" type for CI/CD usage

### 2. GitHub Repository Setup

1. Push your code to GitHub:
   ```bash
   git add .
   git commit -m "Initial commit with GitHub Actions"
   git push origin main
   ```

2. Set up npm token as a repository secret:
   - Go to your GitHub repository
   - Navigate to `Settings` → `Secrets and variables` → `Actions`
   - Click `New repository secret`
   - Name: `NPM_TOKEN`
   - Value: Your npm automation token from step 1

## 🔄 Workflow Details

### CI Workflow (Continuous Integration)

**Triggers:**
- Push to `main` or `develop` branches
- Pull requests to `main` or `develop` branches

**What it does:**
- ✅ Tests on Node.js versions 18, 20, and 22
- ✅ Builds the project
- ✅ Verifies CLI functionality
- ✅ Tests Docker template generation
- ✅ Validates package structure
- ✅ Checks TypeScript compilation

### Publish Workflow (Release & Deployment)

**Triggers:**
- GitHub releases (recommended)
- Manual workflow dispatch

**What it does:**
- ✅ Builds the project
- ✅ Runs tests
- ✅ Verifies package contents
- ✅ Publishes to npm with provenance
- ✅ Creates deployment summary

## 📦 Publishing Process

### Method 1: GitHub Releases (Recommended)

1. **Create a release:**
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

2. **Or via GitHub UI:**
   - Go to your repository on GitHub
   - Click `Releases` → `Create a new release`
   - Choose a tag version (e.g., `v1.0.0`)
   - Fill in release notes
   - Click `Publish release`

3. **Automatic publishing:**
   - GitHub Actions will automatically build and publish to npm
   - Check the `Actions` tab for progress

### Method 2: Manual Dispatch

1. Go to `Actions` tab in your GitHub repository
2. Select `Publish to NPM` workflow
3. Click `Run workflow`
4. Optionally specify a version number
5. Click `Run workflow`

## 🔍 Verification

After publishing, verify your package:

1. **Check npm registry:**
   ```bash  
   npm view @leadcms/sdk
   ```

2. **Test installation:**
   ```bash
   npm install -g @leadcms/sdk@latest
   leadcms --help
   ```

3. **Check GitHub deployment:**
   - Actions tab should show successful deployment
   - Package should appear in repository's right sidebar

## 🛠️ Local Testing Before Publishing

Always test locally before creating a release:

```bash
# 1. Build and test
npm run build
npm test

# 2. Test the package locally
npm pack
tar -tzf *.tgz  # Verify contents

# 3. Test CLI
./dist/cli/index.js --help
./dist/cli/index.js docker

# 4. Test in a clean environment
mkdir /tmp/test-install
cd /tmp/test-install
npm install /path/to/your/package.tgz
npx leadcms --help
```

## 📊 Monitoring & Maintenance

### GitHub Actions Dashboard

Monitor your workflows:
- `Actions` tab shows all workflow runs
- Green checkmarks = successful builds
- Red X = failed builds (click for details)

### npm Analytics

Track package usage:
- [npm package page](https://www.npmjs.com/package/@leadcms/sdk)
- Download statistics
- Version adoption rates

## 🚨 Troubleshooting

### Common Issues

**1. NPM_TOKEN Invalid**
```
Error: Unable to authenticate, need: Basic
```
**Solution:** Regenerate npm token and update GitHub secret

**2. Permission Denied**
```
Error: 403 Forbidden - PUT https://registry.npmjs.org/@leadcms%2fsdk
```
**Solution:** Check npm package name isn't taken, verify token permissions

**3. Build Failures**
```
Error: Cannot find module
```
**Solution:** Ensure all dependencies are in package.json, not devDependencies

**4. CLI Not Executable**
```
Error: permission denied
```
**Solution:** Verify fix-permissions script runs in build process

### Debug Steps

1. **Check workflow logs:**
   - Go to Actions tab
   - Click on failed workflow
   - Expand failing step

2. **Test locally:**
   ```bash
   npm run build
   npm pack --dry-run
   ```

3. **Verify package structure:**
   ```bash
   ls -la dist/
   file dist/cli/index.js
   ```

## 🔐 Security Best Practices

1. **Use automation tokens** for CI/CD (not personal tokens)
2. **Enable 2FA** on npm account
3. **Regularly rotate tokens** (npm tokens don't expire by default)
4. **Use provenance** publishing (included in workflow)
5. **Monitor package downloads** for unusual activity

## 📈 Advanced Configuration

### Conditional Publishing

Only publish on version changes:

```yaml
- name: Check if version changed
  id: version-check
  run: |
    CURRENT_VERSION=$(npm view @leadcms/sdk version 2>/dev/null || echo "0.0.0")
    PACKAGE_VERSION=$(node -p "require('./package.json').version")
    if [ "$CURRENT_VERSION" = "$PACKAGE_VERSION" ]; then
      echo "skip=true" >> $GITHUB_OUTPUT
    fi
    
- name: Publish to NPM
  if: steps.version-check.outputs.skip != 'true'
  run: npm publish --provenance --access public
```

### Beta Releases

For pre-release versions:

```yaml
- name: Publish beta
  if: contains(github.ref, 'beta')
  run: npm publish --tag beta --provenance --access public
```

### Multiple Package Registries

Publish to multiple registries:

```yaml
- name: Publish to GitHub Registry
  run: |
    echo "@leadcms:registry=https://npm.pkg.github.com" >> .npmrc
    npm publish
  env:
    NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## 🎯 Next Steps

1. **Set up branch protection** rules for main branch
2. **Add semantic versioning** with conventional commits
3. **Set up automated changelog** generation
4. **Add code coverage** reporting
5. **Set up dependabot** for dependency updates

Your LeadCMS SDK is now ready for automated publishing! 🚀
