import fs from "fs";
import path from "path";

export interface LeadCMSConfig {
  /** LeadCMS instance URL */
  url: string;
  /** LeadCMS API key (optional - when not provided, only public content is accessible) */
  apiKey?: string;
  /** Default language for content */
  defaultLanguage: string;
  /** Content directory path (relative to project root) */
  contentDir: string;
  /** Comments directory path (relative to project root) */
  commentsDir: string;
  /** Media directory path (relative to project root) */
  mediaDir: string;
  /** Email templates directory path (relative to project root) */
  emailTemplatesDir: string;
  /** Enable draft content support */
  enableDrafts: boolean;
  /** Force preview mode on/off (overrides environment detection) */
  preview?: boolean;
}

let globalConfig: LeadCMSConfig | null = null;

// Configuration cache to avoid repeated file reads
interface ConfigCache {
  config: LeadCMSConfig;
  timestamp: number;
  filePath: string;
}

const configCache = new Map<string, ConfigCache>();
const CACHE_TTL = 60000; // 1 minute cache TTL

// Debug logging control
const DEBUG_LOGGING = process.env.LEADCMS_DEBUG === 'true' || process.env.NODE_ENV === 'development';

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Partial<LeadCMSConfig> = {
  defaultLanguage: "en",
  contentDir: ".leadcms/content",
  commentsDir: ".leadcms/comments",
  mediaDir: "public/media",
  emailTemplatesDir: ".leadcms/email-templates",
  enableDrafts: false,
};

/**
 * Load configuration from multiple sources in priority order:
 * 1. Programmatically set config (via configure())
 * 2. Config file (leadcms.config.js/json)
 * 3. Environment variables
 * 4. Default values
 */
export function loadConfig(): LeadCMSConfig {
  const cwd = process.cwd();

  // 1. Try to load from config file
  const configFromFile = loadConfigFile(cwd);

  // 2. Load from environment variables
  const configFromEnv = loadConfigFromEnv();

  // 3. Merge all sources with proper precedence
  // Environment variables override config file (for security-sensitive data)
  const mergedConfig = {
    ...DEFAULT_CONFIG,
    ...configFromFile,     // Config file settings
    ...configFromEnv,      // Environment variables override config file
    ...globalConfig,       // Programmatic config takes precedence
  };

  // Remove undefined values and ensure required fields
  const cleanConfig: LeadCMSConfig = {
    url: mergedConfig.url || "",
    apiKey: mergedConfig.apiKey, // Optional - undefined if not provided
    defaultLanguage: mergedConfig.defaultLanguage || DEFAULT_CONFIG.defaultLanguage!,
    contentDir: mergedConfig.contentDir || DEFAULT_CONFIG.contentDir!,
    commentsDir: mergedConfig.commentsDir || DEFAULT_CONFIG.commentsDir!,
    mediaDir: mergedConfig.mediaDir || DEFAULT_CONFIG.mediaDir!,
    emailTemplatesDir: mergedConfig.emailTemplatesDir || DEFAULT_CONFIG.emailTemplatesDir!,
    enableDrafts: mergedConfig.enableDrafts || DEFAULT_CONFIG.enableDrafts!,
    preview: mergedConfig.preview, // Optional - undefined if not provided
  };

  validateConfig(cleanConfig);
  return cleanConfig;
}

/**
 * Set configuration programmatically
 */
export function configure(config: Partial<LeadCMSConfig>): void {
  globalConfig = { ...globalConfig, ...config } as LeadCMSConfig;
}

/**
 * Check if preview mode is enabled
 * Priority order:
 * 1. Global configuration (set via configure({ preview: true/false }))
 * 2. Environment variables (LEADCMS_PREVIEW=false overrides development mode)
 * 3. Development mode (NODE_ENV === 'development')
 *
 * @returns true if preview mode is enabled, false otherwise
 */
export function isPreviewMode(): boolean {
  // 1. Check global configuration override
  if (globalConfig?.preview !== undefined) {
    return globalConfig.preview;
  }

  // 2. Check LEADCMS_PREVIEW=false override
  if (process.env.LEADCMS_PREVIEW === "false") {
    return false;
  }

  // 3. Check if we're in development mode
  return process.env.NODE_ENV === "development";
}



/**
 * Get current configuration
 */
export function getConfig(): LeadCMSConfig {
  return loadConfig();
}

/**
 * Load configuration from file with caching
 */
function loadConfigFile(cwd: string = process.cwd()): Partial<LeadCMSConfig> {
  const possiblePaths = [
    path.join(cwd, "leadcms.config.js"),
    path.join(cwd, "leadcms.config.mjs"),
    path.join(cwd, "leadcms.config.json"),
    path.join(cwd, ".leadcmsrc.json"),
    path.join(cwd, ".leadcmsrc"),
  ].filter(Boolean) as string[];

  for (const configFilePath of possiblePaths) {
    try {
      if (!fs.existsSync(configFilePath)) continue;

      // Check cache first
      const cacheKey = `${configFilePath}:${cwd}`;
      const cached = configCache.get(cacheKey);
      const now = Date.now();

      if (cached && (now - cached.timestamp) < CACHE_TTL) {
        // Return cached config without logging to reduce noise
        return cached.config;
      }

      const ext = path.extname(configFilePath);
      let config: LeadCMSConfig;

      if (ext === ".json" || configFilePath.endsWith(".leadcmsrc")) {
        // JSON config
        const content = fs.readFileSync(configFilePath, "utf-8");
        config = JSON.parse(content);
      } else if (ext === ".js" || ext === ".mjs") {
        // JavaScript config (require won't work in ESM, but this is a starting point)
        try {
          // For now, we'll handle JS configs in the CLI layer
          console.warn(`[LeadCMS] JavaScript config files not yet supported in browser environments: ${configFilePath}`);
          continue;
        } catch (error) {
          console.warn(`[LeadCMS] Failed to load JS config: ${configFilePath}`, error);
          continue;
        }
      } else {
        continue;
      }

      // Cache the loaded config
      configCache.set(cacheKey, {
        config,
        timestamp: now,
        filePath: configFilePath,
      });

      // Only log once when actually loading from file, and only in debug mode
      if (!cached && DEBUG_LOGGING) {
        console.log(`[LeadCMS] Loaded configuration from: ${configFilePath}`);
      }

      return config;
    } catch (error) {
      console.warn(`[LeadCMS] Failed to load config from ${configFilePath}:`, error);
      continue;
    }
  }

  return {};
}

/**
 * Load configuration from environment variables
 */
function loadConfigFromEnv(): Partial<LeadCMSConfig> {
  const config: Partial<LeadCMSConfig> = {};

  // Support both generic and Next.js specific env vars
  if (process.env.LEADCMS_URL || process.env.NEXT_PUBLIC_LEADCMS_URL) {
    config.url = process.env.LEADCMS_URL || process.env.NEXT_PUBLIC_LEADCMS_URL;
  }

  if (process.env.LEADCMS_API_KEY) {
    config.apiKey = process.env.LEADCMS_API_KEY;
  }

  if (process.env.LEADCMS_DEFAULT_LANGUAGE || process.env.NEXT_PUBLIC_LEADCMS_DEFAULT_LANGUAGE) {
    config.defaultLanguage = process.env.LEADCMS_DEFAULT_LANGUAGE || process.env.NEXT_PUBLIC_LEADCMS_DEFAULT_LANGUAGE;
  }

  if (process.env.LEADCMS_CONTENT_DIR) {
    config.contentDir = process.env.LEADCMS_CONTENT_DIR;
  }

  if (process.env.LEADCMS_COMMENTS_DIR) {
    config.commentsDir = process.env.LEADCMS_COMMENTS_DIR;
  }

  if (process.env.LEADCMS_MEDIA_DIR) {
    config.mediaDir = process.env.LEADCMS_MEDIA_DIR;
  }

  if (process.env.LEADCMS_EMAIL_TEMPLATES_DIR) {
    config.emailTemplatesDir = process.env.LEADCMS_EMAIL_TEMPLATES_DIR;
  }

  if (process.env.LEADCMS_ENABLE_DRAFTS) {
    config.enableDrafts = process.env.LEADCMS_ENABLE_DRAFTS === "true";
  }

  if (process.env.LEADCMS_PREVIEW) {
    config.preview = process.env.LEADCMS_PREVIEW === "true";
  }

  return config;
}

/**
 * Validate configuration
 */
function validateConfig(config: LeadCMSConfig): void {
  const errors: string[] = [];

  if (!config.url) {
    errors.push("Missing required configuration: url");
  }

  if (config.url && !isValidUrl(config.url)) {
    errors.push("Invalid URL format: url");
  }

  // API key is now optional - warn if not provided
  if (!config.apiKey && DEBUG_LOGGING) {
    console.warn("[LeadCMS] No API key provided - only public content will be accessible");
  }

  if (errors.length > 0) {
    throw new Error(`LeadCMS configuration errors:\n${errors.join("\n")}`);
  }
}

/**
 * Simple URL validation
 */
function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}


