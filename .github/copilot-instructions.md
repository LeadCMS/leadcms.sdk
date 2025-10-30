# LeadCMS SDK - GitHub Copilot Instructions

**LeadCMS SDK** is a framework-agnostic TypeScript/JavaScript SDK for LeadCMS integration. This document outlines principles for developing and maintaining the SDK itself, not for end-user consumption.

## Architecture Principles

- **Framework-Agnostic**: Work seamlessly across Next.js, Astro, Gatsby, Nuxt, vanilla JS
- **TypeScript-First**: Strict types, consistent interfaces, named exports for tree-shaking
- **Bidirectional Sync**: Handle MDX/JSON formats with conflict detection and timestamp comparison

## Code Organization

### Core Structure
- **`/src/lib/`** - Main library (`cms.ts`, `config.ts`, `data-service.ts`, transformations)
- **`/src/scripts/`** - Content operations (push, pull, helpers, SSE watcher)  
- **`/src/cli/`** - Command line interface
- **`/tests/`** - Test suites: core, feature-specific, integration, validation (144 tests, 60% coverage)

## Development Guidelines

### Test-Driven Development (TDD)
- **Test-First**: Always write failing tests before implementing features or fixes
- **Bug Fix Protocol**: Reproduce bug with test → fix → verify
- **Coverage Goal**: Improve from current 60% to >80%
- **Test Data**: Minimal, generic, privacy-compliant test data only

### Error Handling
- **Public APIs**: Return `null`/empty arrays, don't throw
- **Strict Variants**: Provide `*Strict` functions that throw detailed errors
- **Logging**: Debug mode for development, minimal for production

## Content Model

```typescript
interface CMSContent {
  id?: number;
  slug: string;
  type: string;
  title: string;
  body: string;
  language?: string;
  publishedAt?: Date | string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
  [key: string]: any; // Allow additional user-defined fields
}
```

### File Formats
- **MDX**: YAML frontmatter + content
- **JSON**: Pure JSON structure
- **Localization**: Both formats in `content/{locale}/` subdirectories
- **User Drafts**: Both formats support `-{userUid}` suffix

## Configuration

**Priority**: Environment Variables → Config File → Programmatic → Defaults

```bash
LEADCMS_URL=https://instance.com
LEADCMS_API_KEY=key
LEADCMS_USE_MOCK=true  # Testing
```

## CLI Design

- **Consistent naming**: Clear, action-oriented commands with short/long flags (`-f`/`--force`)
- **Dry run support**: `--dry-run` for destructive operations
- **Git-style output**: Clear status messages with progress feedback

## Performance & Security

### Caching
- Config files: 60s, Content: 30s, Process-level caching for builds

### Security
- **API Keys**: Environment variables only, never hardcode
- **Validation**: GUID format, prevent path traversal, sanitize content

## Common Anti-Patterns to Avoid

### ❌ Testing Anti-Patterns
```typescript
// DON'T: Implement features without tests
export function newFeature() {
  // Implementation without corresponding tests
} // ❌ No test coverage

// DON'T: Write tests after implementation
it('should work', () => {
  // Test written after feature is already working
  expect(existingFeature()).toBeTruthy(); // ❌ Not TDD
});

// DON'T: Use overly complex test data
const complexTestData = {
  // 50+ lines of unnecessary test data
}; // ❌ Should be minimal and focused
```

### ❌ Error Handling Anti-Patterns
```typescript
// DON'T: Throw on missing content in public APIs
if (!content) {
  throw new Error('Content not found'); // ❌ Should return null for user-facing APIs
}

// DON'T: Swallow errors silently
try {
  parseContent();
} catch (e) {
  // ❌ Silent failure - should at least log
}

// DON'T: Generic error messages
throw new Error('Something went wrong'); // ❌ Provide context
```

### ❌ Code Organization Anti-Patterns
```typescript
// DON'T: Mix business logic with framework-specific code
export function getNextJSContent(slug: string) {} // ❌ Not framework-agnostic

// DON'T: Inconsistent return types
export function getContent(slug: string): CMSContent | undefined | null {} // ❌ Pick one pattern

// DON'T: Violate single responsibility principle
export function fetchParseValidateAndCacheContent() {} // ❌ Does too many things
```

### ❌ Development Workflow Anti-Patterns
```typescript
// DON'T: Skip tests for "simple" bug fixes
// "This is just a one-line fix, no need for a test" // ❌ All changes need tests

// DON'T: Write implementation-specific tests
expect(mockFunction).toHaveBeenCalledWith(/* specific implementation details */); // ❌ Too tightly coupled

// DON'T: Leave TODO comments in production code
// TODO: Fix this later // ❌ Should be tracked in issues or fixed immediately
```

## SDK Development Workflow

### 1. Feature Development Process
1. **Requirement Analysis**: Understand the feature requirements and edge cases
2. **Test Planning**: Design test cases that cover all scenarios including edge cases
3. **Test Implementation**: Write comprehensive failing tests first
4. **Feature Implementation**: Implement minimal code to make tests pass
5. **Refactoring**: Clean up code while maintaining test coverage
6. **Integration Testing**: Ensure feature works with existing functionality

### 2. Bug Fix Protocol
1. **Issue Reproduction**: Create a test that demonstrates the bug
2. **Root Cause Analysis**: Understand why the bug occurs
3. **Test Creation**: Write a test that fails due to the bug
4. **Fix Implementation**: Make minimal changes to fix the issue
5. **Regression Testing**: Ensure fix doesn't break existing functionality
6. **Documentation Update**: Update relevant documentation if needed

### 3. Code Quality Standards
- **TypeScript Strict Mode**: Use strict TypeScript settings for type safety
- **Interface Consistency**: Maintain consistent API patterns across modules
- **Generic Types**: Use proper generic types for reusable functions
- **Pure Functions**: Prefer pure functions where possible for easier testing
- **Dependency Injection**: Use dependency injection for better testability

### 4. Testing Best Practices
- **Test Isolation**: Each test should be independent and not rely on others
- **Descriptive Names**: Test names should clearly describe what they test
- **Arrange-Act-Assert**: Structure tests with clear setup, execution, and verification
- **Edge Case Coverage**: Test boundary conditions and error scenarios
- **Mock Strategy**: Mock external dependencies but test core logic thoroughly

## Current Development Practices

### Test Coverage & Quality
- **Current Coverage**: 60% across all modules with 144 comprehensive tests
- **Mock Data Service**: Comprehensive `data-service.ts` with scenario-based testing
- **CI/CD Integration**: GitHub Actions with automated testing on Node.js 18, 20, 22
- **Jest Configuration**: TypeScript support, coverage reporting, JUnit XML output

### Code Organization Patterns
- **Framework Agnostic**: All functions work across Next.js, Astro, Gatsby, Nuxt, vanilla JS
- **TypeScript Strict**: Full type safety with comprehensive interface definitions
- **Modular Architecture**: Clear separation between core library, CLI, and content management
- **Configuration Management**: Environment-based config with fallback hierarchy

### Development Tools & Practices
- **Build System**: TypeScript compilation with template copying and executable permissions
- **Testing Framework**: Jest with ts-jest, multiple test categories and scenarios
- **Package Distribution**: NPM package with CLI binary and TypeScript declarations
- **Documentation**: Comprehensive README, development guides, and API documentation

This document serves as a guide for GitHub Copilot and contributors to understand the project's architecture, patterns, and best practices. Follow these principles when suggesting code changes or implementing new features.
