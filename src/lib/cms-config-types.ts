/**
 * Type definitions for the /api/config endpoint response
 * This endpoint provides information about the LeadCMS instance configuration
 */

export interface CMSConfigResponse {
  /** Authentication configuration */
  auth: {
    methods: string[];
    msal?: {
      clientId: string;
      authority: string;
      redirectUri: string;
    };
  };
  /** Available entity types (Content, Comment, Media, Contact, etc.) */
  entities: string[];
  /** Supported languages */
  languages: Array<{
    code: string;
    name: string;
  }>;
  /** CMS settings */
  settings: Record<string, string>;
  /** Default language code */
  defaultLanguage: string;
  /** Enabled modules */
  modules: string[];
  /** CMS capabilities */
  capabilities: string[];
}

/**
 * Cached CMS config with timestamp
 */
interface CMSConfigCache {
  config: CMSConfigResponse;
  timestamp: number;
}

let cmsConfigCache: CMSConfigCache | null = null;
const CMS_CONFIG_CACHE_TTL = 300000; // 5 minutes

/**
 * Set the cached CMS config
 */
export function setCMSConfig(config: CMSConfigResponse): void {
  cmsConfigCache = {
    config,
    timestamp: Date.now(),
  };
}

/**
 * Get the cached CMS config if available and not expired
 */
export function getCachedCMSConfig(): CMSConfigResponse | null {
  if (!cmsConfigCache) {
    return null;
  }

  const now = Date.now();
  if (now - cmsConfigCache.timestamp > CMS_CONFIG_CACHE_TTL) {
    // Cache expired
    cmsConfigCache = null;
    return null;
  }

  return cmsConfigCache.config;
}

/**
 * Check if an entity type is supported by the CMS
 * @param entityType - Entity type to check (case-insensitive)
 * @returns true if entity is supported, false if not or if config is not available
 */
export function isEntitySupported(entityType: string): boolean {
  const config = getCachedCMSConfig();
  if (!config || !Array.isArray(config.entities)) {
    // If config is not available, assume entity is supported (backward compatibility)
    return true;
  }

  // Case-insensitive comparison
  const entityLower = entityType.toLowerCase();
  return config.entities.some(e => e.toLowerCase() === entityLower);
}

/**
 * Check if comments are supported
 */
export function isCommentsSupported(): boolean {
  return isEntitySupported('Comment');
}

/**
 * Check if content is supported
 */
export function isContentSupported(): boolean {
  return isEntitySupported('Content');
}

/**
 * Check if media is supported
 */
export function isMediaSupported(): boolean {
  return isEntitySupported('Media');
}

/**
 * Check if email templates are supported
 */
export function isEmailTemplatesSupported(): boolean {
  return isEntitySupported('EmailTemplate') || isEntitySupported('EmailTemplates');
}
