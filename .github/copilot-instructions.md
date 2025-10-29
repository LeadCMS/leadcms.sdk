# LeadCMS SDK - GitHub Copilot Instructions

## Project Overview

**LeadCMS SDK** is a comprehensive, framework-agnostic TypeScript/JavaScript SDK for integrating with LeadCMS. It provides clean access to content through simple functions that work with any framework or static site generator.

## Core Architecture Principles

### 1. Framework-Agnostic Design
- **Primary Goal**: Work seamlessly across all JavaScript frameworks (Next.js, Astro, Gatsby, Nuxt, vanilla JS)
- **API Design**: Simple, functional API that doesn't impose framework-specific patterns
- **Build vs Runtime**: Clear separation between build-time (static generation) and runtime (SSR/API) usage

### 2. TypeScript-First Development
- **Strict Types**: All functions have comprehensive TypeScript definitions
- **Interface Consistency**: Consistent interface patterns across all modules
- **Generic Support**: Proper generic types for content and configuration objects
- **Export Strategy**: Named exports for tree-shaking optimization

### 3. Content Transformation & Synchronization
- **Bidirectional Sync**: Support for both pulling content from LeadCMS and pushing local changes
- **Format Agnostic**: Handle both MDX and JSON content formats seamlessly
- **Conflict Resolution**: Intelligent conflict detection using timestamp comparison
- **System Fields**: Clear separation between user content fields and internal system fields

## Key Components

### `/src/lib/` - Core Library
- **`cms.ts`** - Main content access functions (getCMSContentBySlug, getAllContentRoutes, etc.)
- **`config.ts`** - Configuration management with environment variable support
- **`data-service.ts`** - Data access layer with API/mock mode switching
- **`content-transformation.ts`** - Shared content transformation utilities (avoid duplication)

### `/src/scripts/` - Content Management
- **`push-leadcms-content.ts`** - Push/status operations with conflict detection
- **`fetch-leadcms-content.mjs`** - Pull operations for downloading content
- **`leadcms-helpers.mjs`** - Shared utilities for content processing
- **`sse-watcher.mjs`** - Real-time content watching with Server-Sent Events

### `/src/cli/` - Command Line Interface
- **`index.ts`** - CLI entry point with command parsing and routing

## Development Guidelines

### 1. Error Handling Strategy
- **Graceful Degradation**: Functions should return `null` or empty arrays rather than throwing
- **Detailed Logging**: Use debug logging for development, minimal logging for production
- **Strict Mode**: Provide `*Strict` variants that throw detailed errors for debugging
- **Type Safety**: Prefer compile-time type checking over runtime assertions

### 2. Testing Approach
- **Mock Mode**: Comprehensive mock data service for testing without external dependencies
- **Shared Test Utilities**: Use shared transformation functions to avoid test code duplication
- **Real-World Scenarios**: Test with actual user data patterns and edge cases
- **Integration Tests**: Test CLI commands with mock API responses

## Content Model

### Content Structure
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

### File Format Conventions
- **MDX Files**: YAML frontmatter + Markdown content
- **JSON Files**: Pure JSON with optional nested content structure
- **Localization**: Content in `content/{locale}/` subdirectories
- **User Drafts**: Files with `-{userUid}` suffix for user-specific drafts

## Configuration Management

### Priority Order
1. **Environment Variables** (highest priority) - for sensitive data like API keys
2. **Configuration File** (`leadcms.config.json`) - for project-specific settings
3. **Programmatic Configuration** - for runtime overrides
4. **Defaults** (lowest priority) - sensible defaults for all settings

### Environment Variable Patterns
```bash
# Primary configuration
LEADCMS_URL=https://your-leadcms-instance.com
LEADCMS_API_KEY=your-api-key

# Alternative patterns (framework-specific)
NEXT_PUBLIC_LEADCMS_URL=https://your-leadcms-instance.com

# Development/testing modes
LEADCMS_USE_MOCK=true
LEADCMS_DEBUG=true
NODE_ENV=test
```

## CLI Design Patterns

### Command Structure
- **Consistent Naming**: Use clear, action-oriented command names
- **Option Flags**: Support both short (`-f`) and long (`--force`) flags
- **Dry Run Support**: Always provide `--dry-run` or equivalent for destructive operations
- **Progress Feedback**: Show clear progress and completion messages

### Status Output Format
```bash
# Git-style status output
Changes to be synced (3 files):
        new file:   article      [en]    new-blog-post
        modified:   page         [en]    about-us (ID: 123)
        renamed:    doc          [en]    old-name -> new-name (ID: 456)

⚠️  Unmerged conflicts (1 file):
        conflict:   article      [en]    conflicted-post
                    Remote content was updated after local content
```

## Performance Considerations

### Caching Strategy
- **Configuration Files**: Cache for 60 seconds to improve build performance
- **Content Files**: Cache for 30 seconds to balance freshness and performance
- **Process-Level Caching**: Cache within the same Node.js process execution
- **Build-Time Optimization**: Minimize file system operations during static generation

### Memory Management
- **Lazy Loading**: Load content files only when requested
- **Stream Processing**: Use streams for large file operations
- **Garbage Collection**: Avoid memory leaks in long-running processes

## Security Guidelines

### API Key Management
- **Environment Variables Only**: Never hardcode API keys in source code
- **Local Configuration**: Warn users against putting secrets in config files
- **Docker Templates**: Provide secure environment injection patterns

### Input Validation
- **GUID Validation**: Validate user UIDs as proper GUID format
- **Path Traversal**: Prevent directory traversal in file operations
- **Content Sanitization**: Validate content types and formats

## Common Anti-Patterns to Avoid

### ❌ Configuration Anti-Patterns
```typescript
// DON'T: Hardcode sensitive configuration
const config = {
  apiKey: 'hardcoded-api-key', // ❌ Security risk
  url: 'https://hardcoded-url.com' // ❌ Not flexible
};

// DON'T: Mix system and user fields
const excludedFields = ['body', 'createdAt', 'publishedAt']; // ❌ Excludes user data
```

### ❌ Error Handling Anti-Patterns
```typescript
// DON'T: Throw on missing content
if (!content) {
  throw new Error('Content not found'); // ❌ Should return null
}

// DON'T: Swallow errors silently
try {
  parseContent();
} catch (e) {
  // ❌ Silent failure - log the error at minimum
}
```

### ❌ API Design Anti-Patterns
```typescript
// DON'T: Framework-specific patterns
export function getNextJSContent(slug: string) {} // ❌ Not framework-agnostic

// DON'T: Inconsistent return types
export function getContent(slug: string): CMSContent | undefined | null {} // ❌ Pick one
```

## Testing Philosophy

### Mock Data Strategy
- **Environment Detection**: Automatically enable mock mode for testing environments
- **Scenario-Based**: Provide different mock scenarios (conflicts, updates, etc.)
- **Real Data Patterns**: Mock data should reflect real-world usage patterns
- **CLI Integration**: Test CLI commands with mock responses

### Test Organization
- **Core Functionality**: `cms.test.ts` for main content access functions
- **Advanced Features**: `cms-advanced.test.ts` for complex scenarios
- **Push/Status Operations**: `push-status.test.ts` for synchronization logic
- **Shared Utilities**: Avoid duplicating test transformation logic

## Documentation Standards

### README Structure
- **Quick Start**: Installation and basic usage examples
- **Framework Examples**: Show integration with popular frameworks
- **CLI Reference**: Complete command documentation with examples
- **API Reference**: Comprehensive function documentation

### Code Documentation
- **JSDoc Comments**: All public functions should have comprehensive JSDoc
- **Type Annotations**: Use descriptive type names and interfaces
- **Example Usage**: Include usage examples in function documentation
- **Error Scenarios**: Document what errors functions might throw/return

## Release & Deployment

### Version Strategy
- **Semantic Versioning**: Follow semver for all releases
- **Breaking Changes**: Clearly document breaking changes in CHANGELOG
- **Deprecation Policy**: Provide migration guides for deprecated features
- **CLI Compatibility**: Maintain backward compatibility for CLI commands

### CI/CD Pipeline
- **Multi-Node Testing**: Test on Node.js 18, 20, and 22
- **Coverage Requirements**: Maintain high test coverage (>80%)
- **Type Checking**: Ensure TypeScript compilation across all Node versions
- **Integration Tests**: Test CLI functionality with mock data

This document serves as a guide for GitHub Copilot and contributors to understand the project's architecture, patterns, and best practices. Follow these principles when suggesting code changes or implementing new features.
