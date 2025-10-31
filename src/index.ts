// Main exports
export * from './lib/cms.js';
export * from './lib/config.js';
export * from './lib/locale-utils.js';
export * from './lib/comment-types.js';
export * from './lib/cms-config-types.js';

// Export only public comment tree types (functions are exported from cms.js)
export type { CommentTreeNode, CommentTreeOptions, CommentStatistics, CommentSortOrder } from './lib/comment-utils.js';

// LeadCMS SDK - Framework-agnostic content management
//
// Core functions for accessing LeadCMS content:
// - getCMSContentBySlugForLocale() - Get content by slug
// - getAllContentSlugsForLocale() - Get all content slugs
// - getAllContentRoutes() - Get all routes for static generation
// - getAvailableLanguages() - Get supported languages
//
// Comments API:
// - getComments() - Get comments for any commentable entity
// - getCommentsForContent() - Get comments for a specific content item
// - getCommentsStrict() - Get comments with strict error handling
// - getCommentsForContentStrict() - Get comments for content with strict error handling
// - getCommentsTree() - Get comments as a hierarchical tree structure with sorting and filtering
// - getCommentsTreeForContent() - Get comments tree for content (convenience wrapper)
//
// Note: Tree building utilities (buildCommentTree, flattenCommentTree, filterComments, etc.)
// are internal implementation details and not part of the public API. Use getCommentsTree()
// and getCommentsTreeForContent() for all tree operations.
//
// Locale utilities:
// - isValidLocaleCode() - Validate locale directory names
//
// Configuration options:
// 1. leadcms.config.json file (recommended)
// 2. Environment variables (fallback)
// 3. Programmatic configuration using configure()
//
// CLI utilities:
// - npx leadcms init      - Initialize configuration
// - npx leadcms pull      - Pull content and comments from LeadCMS
// - npx leadcms pull-comments - Pull only comments from LeadCMS
// - npx leadcms fetch     - Alias for pull (backward compatibility)
// - npx leadcms watch     - Watch for real-time updates
// - npx leadcms generate-env - Generate environment file
