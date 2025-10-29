# 🚀 LeadCMS SDK v1.3.0 - Major Feature Release

## 🎉 What's New

This is a **major feature release** that introduces comprehensive draft content handling, extensive testing infrastructure, and professional CI/CD integration.

### ✨ Major Features

#### 📝 Draft Content Support
- **Complete draft handling** based on `publishedAt` field logic
- **User-specific draft overrides** with GUID-based file naming (`content-550e8400-e29b-41d4-a716-446655440000.mdx`)
- **Future-dated content** support for scheduled publishing
- **Draft filtering functions** (`isContentDraft`, `filterOutDraftSlugs`)
- **Draft inclusion options** for all content retrieval functions

#### 🌍 Multi-Language Improvements  
- **Fixed translation bugs** where default language was returning wrong content
- **Enhanced locale handling** with proper directory exclusion for default language
- **Better error handling** for missing locale directories
- **Improved content discovery** across multiple languages

#### 🧪 Comprehensive Testing
- **62 comprehensive unit tests** covering all core functionality
- **Realistic fixture data** with published/draft/future content scenarios
- **Multi-locale test coverage** (English/Spanish)
- **Date mocking system** for consistent time-based testing
- **GUID validation** for user-specific content

#### 🔄 CI/CD Integration
- **GitHub Actions workflows** for automated testing and publishing
- **Multi-Node.js testing** (versions 18, 20, 22)
- **Coverage reporting** with LCOV, HTML, and Clover formats
- **Test result visibility** directly in GitHub Actions UI
- **Automatic PR coverage comments** showing coverage changes
- **JUnit XML reporting** for professional test result display

### 🐛 Critical Bug Fixes
- **Translation function fix**: Resolved issue where English locale was returning Spanish content
- **Draft parameter handling**: Fixed `includeDrafts` parameter not being passed correctly
- **Date validation**: Enhanced handling of invalid dates and NaN values
- **Locale directory traversal**: Improved content discovery to avoid duplicate results

### 🔧 Technical Improvements
- **Jest testing framework** with full TypeScript support
- **Enhanced error handling** throughout the codebase
- **Type safety improvements** with better validation
- **Performance optimizations** in content discovery
- **Memory usage improvements** in test environments

### 📚 Documentation
- **Comprehensive CI/CD setup guide** (`docs/CI_CD_SETUP.md`)
- **Draft handling documentation** (`DRAFT_HANDLING.md`)
- **Updated README** with CI/CD integration details
- **Status badges** for build and test workflows

## 📦 Installation

```bash
# For build-time usage (recommended)
npm install --save-dev @leadcms/sdk@^1.3.0

# For runtime usage
npm install @leadcms/sdk@^1.3.0

# Global CLI installation
npm install -g @leadcms/sdk@^1.3.0
```

## 🚨 Breaking Changes
None! This release maintains full backward compatibility with existing code.

## 📈 Statistics
- **62 unit tests** with comprehensive coverage
- **77% line coverage** on core CMS functionality
- **Multiple output formats** for coverage reporting
- **Cross-platform tested** on macOS, Linux, and Windows
- **Multi-Node.js support** (18, 20, 22)

## 🔗 Links
- **NPM Package**: https://www.npmjs.com/package/@leadcms/sdk
- **Documentation**: [README.md](https://github.com/LeadCMS/leadcms.sdk/blob/main/README.md)
- **CI/CD Guide**: [docs/CI_CD_SETUP.md](https://github.com/LeadCMS/leadcms.sdk/blob/main/docs/CI_CD_SETUP.md)
- **Draft Handling**: [DRAFT_HANDLING.md](https://github.com/LeadCMS/leadcms.sdk/blob/main/DRAFT_HANDLING.md)

## 🙏 Thank You
This release represents a significant step forward in making LeadCMS SDK more robust, well-tested, and production-ready. The comprehensive test suite ensures reliability, while the CI/CD integration provides confidence in every change.

---

**Full Changelog**: https://github.com/LeadCMS/leadcms.sdk/compare/v1.2.91...v1.3.0