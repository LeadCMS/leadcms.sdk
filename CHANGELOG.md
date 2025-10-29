# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.0] - 2024-10-29

### 🎉 Major Features Added

#### Draft Content Handling
- **NEW**: Complete draft content support based on `publishedAt` field
- **NEW**: User-specific draft overrides with GUID-based file naming
- **NEW**: Draft filtering functions (`isContentDraft`, `filterOutDraftSlugs`)
- **NEW**: Draft inclusion options for all content retrieval functions
- **NEW**: Support for future-dated content (scheduled publishing)

#### Multi-language Support Improvements
- **FIXED**: Translation content retrieval now correctly handles default language
- **IMPROVED**: `getContentTranslations` function now properly excludes language directories for default locale
- **ENHANCED**: Better locale directory resolution and error handling

#### Comprehensive Testing Infrastructure
- **NEW**: Complete unit test suite with 62 test cases
- **NEW**: Extensive fixture data with realistic content scenarios
- **NEW**: Date mocking system for consistent time-based testing
- **NEW**: GUID pattern validation for user-specific content
- **NEW**: Multi-locale test coverage (English/Spanish)

#### CI/CD Integration
- **NEW**: GitHub Actions workflows for automated testing
- **NEW**: Multi-Node.js version testing (18, 20, 22)
- **NEW**: Coverage reporting with LCOV, HTML, and Clover formats
- **NEW**: JUnit XML test result reporting for GitHub Actions
- **NEW**: Automatic coverage comments on pull requests
- **NEW**: Test result visibility in GitHub Actions UI
- **NEW**: Coverage artifacts archiving (30-day retention)
- **NEW**: Optional Codecov integration support

### 🔧 Technical Improvements

#### Code Quality
- **ADDED**: Jest testing framework with TypeScript support
- **ADDED**: `jest-junit` reporter for CI integration
- **IMPROVED**: Error handling for missing locale directories
- **ENHANCED**: Type safety and validation throughout the codebase
- **FIXED**: NaN date handling in draft detection logic

#### Documentation
- **NEW**: Comprehensive CI/CD setup guide (`docs/CI_CD_SETUP.md`)
- **NEW**: Draft handling documentation (`DRAFT_HANDLING.md`)
- **UPDATED**: README with CI/CD integration section
- **ADDED**: Status badges for CI and test workflows
- **ENHANCED**: Installation and usage examples

### 🐛 Bug Fixes
- **FIXED**: Translation function returning incorrect locale content
- **FIXED**: Draft content filtering not respecting `includeDrafts` parameter
- **FIXED**: Language directory traversal issues in content discovery
- **FIXED**: Invalid date handling causing runtime errors

### 📦 Dependencies
- **ADDED**: `jest@^29.0.0` - Testing framework
- **ADDED**: `@types/jest@^29.0.0` - Jest TypeScript definitions
- **ADDED**: `jest-junit@^16.0.0` - JUnit XML reporter for CI
- **ADDED**: `ts-jest@^29.0.0` - TypeScript Jest preset

### ⚡ Performance
- **IMPROVED**: Content discovery with better directory filtering
- **OPTIMIZED**: Translation lookup to avoid duplicate content reading
- **ENHANCED**: Memory usage in test environments with proper mocking

### 🔒 Security
- **ADDED**: Proper input validation for user UIDs (GUID format)
- **ENHANCED**: File system access validation
- **IMPROVED**: Error handling to prevent information leakage

---

## [1.2.91] - Previous Release
- Previous functionality and features
- (Add previous changelog entries as needed)
