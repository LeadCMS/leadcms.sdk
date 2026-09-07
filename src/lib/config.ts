import fs from "fs";
import path from "path";
import type { RemoteConfig } from "./remote-context.js";
import {
  DEFAULT_SITE_NAME,
  DEFAULT_SITE_ROOT,
  expandSiteRoot,
  hasSitesBlock,
  selectSiteName,
  validateSitesBlock,
  type LeadCMSConfigFile,
  type SiteConfig,
} from "./site-context.js";

export interface LeadCMSConfig {
  /** LeadCMS instance URL (single-remote mode) */
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
  /** Settings directory path (relative to project root) */
  settingsDir: string;
  /** Segments directory path (relative to project root) */
  segmentsDir: string;
  /** Sequences directory path (relative to project root) */
  sequencesDir: string;
  /** Redirects directory path (relative to project root) */
  redirectsDir: string;
  /**
   * Module written by `leadcms watch` so a dev server notices content edits.
   * Point this somewhere the site's bundler will resolve, and import it from a
   * page. Relative to the project root.
   */
  contentRevisionFile?: string;
  /**
   * Language → base URL mapping for domain-per-language deployments.
   * Key = language code, value = full base URL (no trailing slash).
   * Example: { "en": "https://en.example.com", "de": "https://de.example.com" }
   */
  languageDomains?: Record<string, string>;
  /** Redirects map generation settings */
  redirects?: {
    /**
     * Output directory for generated redirect map files (relative to project root).
     * The SDK writes `{outputDir}/301.map` and `{outputDir}/302.map`.
     * Default: "redirects"
     */
    outputDir?: string;
    /**
     * Path template for resolving ContentSlug-type redirects.
     * Tokens: {language}, {slug}, {domain}. Default: "/{language}/{slug}"
     */
    pathPattern?: string;
    /**
     * Controls whether generated map entries match paths with and without a trailing slash.
     * - "strict" (default): emit only the exact resolved path
     * - "both": emit two entries per redirect — one with trailing slash and one without,
     *   so `/news/1/` and `/news/1` both trigger the redirect
     */
    trailingSlash?: "strict" | "both";
  };
  /** Enable draft content support */
  enableDrafts: boolean;
  /** Force preview mode on/off (overrides environment detection) */
  preview?: boolean;
  /** Named remote CMS instances (multi-remote mode) */
  remotes?: Record<string, RemoteConfig>;
  /** Default remote name (used when --remote is not specified) */
  defaultRemote?: string;
  /**
   * Active site name. "default" in single-site mode (no `sites` block).
   * Set via `--site`, `configure({ site })`, `LEADCMS_SITE` or `defaultSite`.
   */
  site?: string;
  /** Named sites (multi-site mode); see site-context.ts */
  sites?: Record<string, SiteConfig>;
  /** Default site name (used when --site is not specified) */
  defaultSite?: string;
}

/** Options for building the effective configuration of one site. @internal */
export interface EffectiveConfigOptions {
  /** Explicit site to resolve; beats `configure({ site })` and `LEADCMS_SITE` */
  site?: string;
  /** Raw config file contents to use instead of reading the file (tests) */
  file?: LeadCMSConfigFile;
  /** Apply `LEADCMS_*` environment overrides (default: true) */
  env?: boolean;
}

let globalConfig: LeadCMSConfig | null = null;

// Configuration cache to avoid repeated file reads. Caches the raw file;
// site resolution happens on every call from that cached file.
interface ConfigCache {
  config: LeadCMSConfigFile;
  timestamp: number;
  filePath: string;
}

const configCache = new Map<string, ConfigCache>();
const CACHE_TTL = 60000; // 1 minute cache TTL

// Debug logging control
const DEBUG_LOGGING =
  process.env.LEADCMS_DEBUG === "true" || process.env.NODE_ENV === "development";

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Partial<LeadCMSConfig> = {
  defaultLanguage: "en",
  contentDir: ".leadcms/content",
  commentsDir: ".leadcms/comments",
  mediaDir: "public/media",
  emailTemplatesDir: ".leadcms/email-templates",
  settingsDir: ".leadcms/settings",
  segmentsDir: ".leadcms/segments",
  sequencesDir: ".leadcms/sequences",
  redirectsDir: ".leadcms/redirects",
  contentRevisionFile: ".leadcms/content-revision.js",
  enableDrafts: false,
};

/**
 * Load configuration from multiple sources in priority order:
 * 1. Programmatically set config (via configure())
 * 2. Config file (leadcms.config.js/json)
 * 3. Environment variables
 * 4. Default values
 */
/**
 * Resolve configuration without requiring a remote.
 *
 * Commands that only touch local files — watching content, generating the
 * revision module — have no use for `url`/`apiKey`, and demanding them would
 * lock out projects that develop against committed content with no CMS
 * reachable. Use `loadConfig()` whenever the remote is actually needed.
 */
export function loadLocalConfig(): LeadCMSConfig {
  return buildConfig();
}

export function loadConfig(): LeadCMSConfig {
  const cleanConfig = buildConfig();
  validateConfig(cleanConfig);
  return cleanConfig;
}

function buildConfig(options: EffectiveConfigOptions = {}): LeadCMSConfig {
  const cwd = process.cwd();
  const applyEnv = options.env !== false;

  // 1. Load the raw config file (cached) — top-level keys plus any `sites` block
  const configFile: LeadCMSConfigFile = options.file ?? loadConfigFile(cwd);

  // 2. Resolve the active site. Site selection happens on every call from the
  //    cached file, so switching LEADCMS_SITE within one process takes effect
  //    immediately.
  const multiSite = hasSitesBlock(configFile);
  if (multiSite) {
    const { errors, warnings } = validateSitesBlock(configFile);
    if (errors.length > 0) {
      throw new Error(`LeadCMS configuration errors:\n${errors.join("\n")}`);
    }
    warnOnce(warnings);
  }
  const requestedSite = options.site || globalConfig?.site || process.env.LEADCMS_SITE || undefined;
  const siteName = selectSiteName(configFile, requestedSite);
  const { sites, defaultSite, ...topLevel } = configFile;
  const site: SiteConfig | undefined = multiSite ? sites![siteName] : undefined;
  const { root: siteRoot, ...siteKeys } = site ?? {};

  // 3. Load from environment variables
  const configFromEnv = applyEnv ? loadConfigFromEnv() : {};

  // 4. Merge all sources with proper precedence. Later entries win:
  //    defaults ← top-level file keys ← site root expansion ← explicit site
  //    keys ← environment variables ← programmatic configure().
  //    Environment variables override config file (for security-sensitive data).
  //    In single-site mode there is no expansion: DEFAULT_CONFIG already equals
  //    the expansion of ".leadcms", so a top-level contentDir keeps winning.
  const mergedConfig = {
    ...DEFAULT_CONFIG,
    ...topLevel, // Config file settings
    ...(site ? expandSiteRoot(siteRoot ?? DEFAULT_SITE_ROOT) : {}),
    ...siteKeys, // Explicit per-site keys
    ...configFromEnv, // Environment variables override config file
    ...globalConfig, // Programmatic config takes precedence
  };

  // Remove undefined values and ensure required fields
  const cleanConfig: LeadCMSConfig = {
    url: (mergedConfig.url || "").replace(/\/+$/, ""),
    apiKey: mergedConfig.apiKey, // Optional - undefined if not provided
    defaultLanguage: mergedConfig.defaultLanguage || DEFAULT_CONFIG.defaultLanguage!,
    contentDir: mergedConfig.contentDir || DEFAULT_CONFIG.contentDir!,
    commentsDir: mergedConfig.commentsDir || DEFAULT_CONFIG.commentsDir!,
    mediaDir: mergedConfig.mediaDir || DEFAULT_CONFIG.mediaDir!,
    emailTemplatesDir: mergedConfig.emailTemplatesDir || DEFAULT_CONFIG.emailTemplatesDir!,
    settingsDir: mergedConfig.settingsDir || DEFAULT_CONFIG.settingsDir!,
    segmentsDir: mergedConfig.segmentsDir || DEFAULT_CONFIG.segmentsDir!,
    sequencesDir: mergedConfig.sequencesDir || DEFAULT_CONFIG.sequencesDir!,
    redirectsDir: mergedConfig.redirectsDir || DEFAULT_CONFIG.redirectsDir!,
    contentRevisionFile: mergedConfig.contentRevisionFile || DEFAULT_CONFIG.contentRevisionFile!,
    languageDomains: mergedConfig.languageDomains,
    redirects: mergedConfig.redirects,
    enableDrafts: mergedConfig.enableDrafts || DEFAULT_CONFIG.enableDrafts!,
    preview: mergedConfig.preview, // Optional - undefined if not provided
    remotes: mergedConfig.remotes,
    defaultRemote: mergedConfig.defaultRemote,
    site: siteName,
    sites: multiSite ? sites : undefined,
    defaultSite: multiSite ? defaultSite : undefined,
  };

  return cleanConfig;
}

/**
 * Build the effective configuration for one site.
 *
 * Used by `site-context.ts` to resolve, list and describe sites. Prefer
 * `getConfig()` / `loadLocalConfig()` everywhere else: they return the same
 * object for the active site.
 *
 * @internal
 */
export function resolveEffectiveConfig(options: EffectiveConfigOptions = {}): LeadCMSConfig {
  return buildConfig(options);
}

/**
 * The raw config file as written on disk (cached), without site resolution
 * or environment overrides. Used to enumerate sites.
 *
 * @internal
 */
export function loadRawConfigFile(): LeadCMSConfigFile {
  return loadConfigFile(process.cwd());
}

const warnedOnce = new Set<string>();

/** Print each configuration warning once per process. */
function warnOnce(messages: string[]): void {
  for (const message of messages) {
    if (warnedOnce.has(message)) continue;
    warnedOnce.add(message);
    console.warn(`[LeadCMS] ${message}`);
  }
}

/**
 * Set configuration programmatically.
 *
 * `configure({ site: "zenith" })` selects a site at the same precedence as
 * other programmatic config: above `LEADCMS_SITE` and `defaultSite`.
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
function loadConfigFile(cwd: string = process.cwd()): LeadCMSConfigFile {
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

      if (cached && now - cached.timestamp < CACHE_TTL) {
        // Return cached config without logging to reduce noise
        return cached.config;
      }

      const ext = path.extname(configFilePath);
      let config: LeadCMSConfigFile;

      if (ext === ".json" || configFilePath.endsWith(".leadcmsrc")) {
        // JSON config
        const content = fs.readFileSync(configFilePath, "utf-8");
        config = JSON.parse(content);
      } else if (ext === ".js" || ext === ".mjs") {
        // JavaScript config (require won't work in ESM, but this is a starting point)
        try {
          // For now, we'll handle JS configs in the CLI layer
          console.warn(
            `[LeadCMS] JavaScript config files not yet supported in browser environments: ${configFilePath}`
          );
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
    config.defaultLanguage =
      process.env.LEADCMS_DEFAULT_LANGUAGE || process.env.NEXT_PUBLIC_LEADCMS_DEFAULT_LANGUAGE;
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

  if (process.env.LEADCMS_SETTINGS_DIR) {
    config.settingsDir = process.env.LEADCMS_SETTINGS_DIR;
  }

  if (process.env.LEADCMS_SEGMENTS_DIR) {
    config.segmentsDir = process.env.LEADCMS_SEGMENTS_DIR;
  }

  if (process.env.LEADCMS_SEQUENCES_DIR) {
    config.sequencesDir = process.env.LEADCMS_SEQUENCES_DIR;
  }

  if (process.env.LEADCMS_REDIRECTS_DIR) {
    config.redirectsDir = process.env.LEADCMS_REDIRECTS_DIR;
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

  // In multi-remote mode, url is optional (comes from remotes block)
  if (config.remotes && Object.keys(config.remotes).length > 0) {
    // Validate remotes
    for (const [name, remote] of Object.entries(config.remotes)) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
        errors.push(
          `Invalid remote name "${name}": must be lowercase alphanumeric with hyphens, starting with a letter or digit`
        );
      }
      if (!remote.url) {
        errors.push(`Remote "${name}" is missing required "url" field`);
      } else if (!isValidUrl(remote.url)) {
        errors.push(`Remote "${name}" has invalid URL: ${remote.url}`);
      }
    }

    // Validate defaultRemote
    if (config.defaultRemote) {
      if (!config.remotes[config.defaultRemote]) {
        errors.push(
          `"defaultRemote" references "${config.defaultRemote}" but no such remote is configured`
        );
      }
    } else {
      errors.push(
        `"remotes" is configured but "defaultRemote" is not set. Add "defaultRemote" to your config.`
      );
    }
  } else {
    // Single-remote mode — url is required
    if (!config.url) {
      const siteName = config.site && config.site !== DEFAULT_SITE_NAME ? config.site : undefined;
      errors.push(
        siteName
          ? `Site "${siteName}" has no "remotes" configured and no LEADCMS_URL is set`
          : "Missing required configuration: url"
      );
    }

    if (config.url && !isValidUrl(config.url)) {
      errors.push("Invalid URL format: url");
    }
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
