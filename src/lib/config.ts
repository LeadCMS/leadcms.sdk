import fs from "fs";
import path from "path";

export interface LeadCMSConfig {
  /** LeadCMS instance URL */
  url: string;
  /** LeadCMS API key */
  apiKey: string;
  /** Default language for content */
  defaultLanguage?: string;
  /** Content directory path (relative to project root) */
  contentDir?: string;
  /** Media directory path (relative to project root) */
  mediaDir?: string;
  /** Enable draft content support */
  enableDrafts?: boolean;
}

export interface LeadCMSConfigOptions extends Partial<LeadCMSConfig> {
  /** Custom config file path */
  configPath?: string;
  /** Working directory for resolving paths */
  cwd?: string;
}

let globalConfig: Partial<LeadCMSConfig> | null = null;

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Partial<LeadCMSConfig> = {
  defaultLanguage: "en",
  contentDir: ".leadcms/content",
  mediaDir: "public/media",
  enableDrafts: false,
};

/**
 * Load configuration from multiple sources in priority order:
 * 1. Programmatically set config (via configure())
 * 2. Config file (leadcms.config.js/json)
 * 3. Environment variables
 * 4. Default values
 */
export function loadConfig(options: LeadCMSConfigOptions = {}): LeadCMSConfig {
  const cwd = options.cwd || process.cwd();

  // 1. Try to load from config file
  const configFromFile = loadConfigFile(options.configPath, cwd);

  // 2. Load from environment variables
  const configFromEnv = loadConfigFromEnv();

  // 3. Merge all sources with proper precedence
  const mergedConfig = {
    ...DEFAULT_CONFIG,
    ...configFromEnv,
    ...configFromFile,
    ...globalConfig, // Programmatic config takes precedence
    ...options, // Options passed to this function take highest precedence
  };

  // Remove undefined values and ensure required fields
  const cleanConfig: LeadCMSConfig = {
    url: mergedConfig.url || "",
    apiKey: mergedConfig.apiKey || "",
    defaultLanguage: mergedConfig.defaultLanguage || DEFAULT_CONFIG.defaultLanguage!,
    contentDir: mergedConfig.contentDir || DEFAULT_CONFIG.contentDir!,
    mediaDir: mergedConfig.mediaDir || DEFAULT_CONFIG.mediaDir!,
    enableDrafts: mergedConfig.enableDrafts || DEFAULT_CONFIG.enableDrafts!,
  };

  validateConfig(cleanConfig);
  return cleanConfig;
}

/**
 * Set configuration programmatically
 */
export function configure(config: Partial<LeadCMSConfig>): void {
  globalConfig = { ...globalConfig, ...config };
}

/**
 * Reset configuration (useful for testing)
 */
export function resetConfig(): void {
  globalConfig = null;
}

/**
 * Get current configuration
 */
export function getConfig(options?: LeadCMSConfigOptions): LeadCMSConfig {
  return loadConfig(options);
}

/**
 * Load configuration from file
 */
function loadConfigFile(configPath?: string, cwd: string = process.cwd()): Partial<LeadCMSConfig> {
  const possiblePaths = [
    configPath,
    path.join(cwd, "leadcms.config.js"),
    path.join(cwd, "leadcms.config.mjs"),
    path.join(cwd, "leadcms.config.json"),
    path.join(cwd, ".leadcmsrc.json"),
    path.join(cwd, ".leadcmsrc"),
  ].filter(Boolean) as string[];

  for (const configFilePath of possiblePaths) {
    try {
      if (!fs.existsSync(configFilePath)) continue;

      const ext = path.extname(configFilePath);
      let config: Partial<LeadCMSConfig>;

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

      console.log(`[LeadCMS] Loaded configuration from: ${configFilePath}`);
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

  if (process.env.LEADCMS_MEDIA_DIR) {
    config.mediaDir = process.env.LEADCMS_MEDIA_DIR;
  }

  if (process.env.LEADCMS_ENABLE_DRAFTS) {
    config.enableDrafts = process.env.LEADCMS_ENABLE_DRAFTS === "true";
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

  if (!config.apiKey) {
    errors.push("Missing required configuration: apiKey");
  }

  if (config.url && !isValidUrl(config.url)) {
    errors.push("Invalid URL format: url");
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

/**
 * Generate a sample configuration file
 */
export function generateConfigFile(filePath: string = "leadcms.config.json"): string {
  const sampleConfig: LeadCMSConfig = {
    url: "https://your-leadcms-instance.com",
    apiKey: "your-api-key-here",
    defaultLanguage: "en",
    contentDir: ".leadcms/content",
    mediaDir: "public/media",
    enableDrafts: false
  };

  const content = JSON.stringify(sampleConfig, null, 2);
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}
