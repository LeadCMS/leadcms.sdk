// Main exports
export * from './lib/cms.js';
export * from './lib/config.js';

// LeadCMS SDK - Framework-agnostic content management
//
// Core functions for accessing LeadCMS content:
// - getCMSContentBySlugForLocale() - Get content by slug
// - getAllContentSlugsForLocale() - Get all content slugs
// - getAllContentRoutes() - Get all routes for static generation
// - getAvailableLanguages() - Get supported languages
//
// Configuration options:
// 1. leadcms.config.json file (recommended)
// 2. Environment variables (fallback)
// 3. Programmatic configuration using configure()
//
// CLI utilities:
// - npx leadcms init      - Initialize configuration
// - npx leadcms fetch     - Fetch content from LeadCMS
// - npx leadcms watch     - Watch for real-time updates
// - npx leadcms generate-env - Generate environment file
