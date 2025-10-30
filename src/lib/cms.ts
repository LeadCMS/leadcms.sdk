import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { getConfig, type LeadCMSConfig } from "./config.js";

// Type definitions for configuration objects
export interface HeaderConfig { [key: string]: any; }
export interface FooterConfig { [key: string]: any; }

// Default language - internal fallback only when configuration is not available
const DEFAULT_LANGUAGE = "en";

// Content cache to avoid repeated file reads
interface ContentCache<T> {
  content: T | null;
  timestamp: number;
  filePath: string;
}

const contentCache = new Map<string, ContentCache<any>>();
const CONTENT_CACHE_TTL = 30000; // 30 seconds cache TTL for content files

/**
 * Check if content is a draft based on publishedAt field
 * Content is considered draft if:
 * - publishedAt is null/undefined
 * - publishedAt is a future date (after current time)
 *
 * @param content - The content to check
 * @returns true if content is draft, false otherwise
 */
export function isContentDraft(content: CMSContent): boolean {
  if (!content.publishedAt) {
    return true;
  }

  const publishedDate = content.publishedAt instanceof Date
    ? content.publishedAt
    : new Date(content.publishedAt);

  const publishedTime = publishedDate.getTime();

  // If the date is invalid (NaN), treat as draft
  if (isNaN(publishedTime)) {
    return true;
  }

  const now = Date.now();
  return publishedTime > now;
}

/**
 * Get LeadCMS configuration with fallbacks
 * This function attempts to load the LeadCMS configuration and falls back to environment variables
 * if the configuration file is not available or cannot be loaded.
 *
 * @returns Complete LeadCMS configuration object with all required fields
 */
export function getLeadCMSConfig(): LeadCMSConfig {
  try {
    return getConfig();
  } catch (error) {
    // If config loading fails, return minimal config with environment fallbacks
    return {
      url: process.env.LEADCMS_URL || process.env.NEXT_PUBLIC_LEADCMS_URL || "",
      apiKey: process.env.LEADCMS_API_KEY || "",
      defaultLanguage: process.env.LEADCMS_DEFAULT_LANGUAGE || process.env.NEXT_PUBLIC_LEADCMS_DEFAULT_LANGUAGE || DEFAULT_LANGUAGE,
      contentDir: process.env.LEADCMS_CONTENT_DIR || ".leadcms/content",
      mediaDir: process.env.LEADCMS_MEDIA_DIR || "public/media",
      enableDrafts: process.env.LEADCMS_ENABLE_DRAFTS === "true",
    };
  }
}

export interface CMSContentTemplateProps<T = CMSContent> {
  content: T;
}

export interface CMSContent {
  id: string | number;
  slug: string;
  type: string;
  title?: string;
  description?: string;
  coverImageUrl?: string;
  coverImageAlt?: string;
  language?: string;
  translationKey?: string;
  publishedAt?: Date | string;
  draft?: boolean; // Added to support draft content filtering

  [key: string]: any;
  body: string;
}

/**
 * Get all available languages from a specific content directory (internal helper)
 * @internal
 */
function getAvailableLanguagesFromDir(contentDir: string): string[] {
  const config = getLeadCMSConfig();
  const defaultLanguage = config.defaultLanguage || DEFAULT_LANGUAGE;

  try {
    const entries = fs.readdirSync(contentDir, { withFileTypes: true });
    const languages = [defaultLanguage]; // Always include default language

    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.length === 2) {
        // Assume 2-character directory names are language codes
        if (!languages.includes(entry.name)) {
          languages.push(entry.name);
        }
      }
    }

    return languages.sort();
  } catch {
    return [defaultLanguage];
  }
}

/**
 * Get all available languages from the content directory structure
 */
export function getAvailableLanguages(): string[] {
  const config = getLeadCMSConfig();
  const defaultLanguage = config.defaultLanguage || DEFAULT_LANGUAGE;
  const contentDir = config.contentDir;

  if (!contentDir) {
    return [defaultLanguage];
  }

  return getAvailableLanguagesFromDir(contentDir);
}

/**
 * Get content directory for a specific locale
 */
export function getContentDirForLocale(contentDir: string, locale?: string): string {
  const config = getLeadCMSConfig();
  const defaultLanguage = config.defaultLanguage || DEFAULT_LANGUAGE;
  const actualLocale = locale || defaultLanguage;

  if (actualLocale === defaultLanguage) {
    return contentDir;
  }

  return path.join(contentDir, actualLocale);
}

/**
 * Get all content slugs for a specific locale with draft filtering options (internal helper)
 * @internal
 */
function getAllContentSlugsForLocaleFromDir(
  contentDir: string,
  locale?: string,
  contentTypes?: readonly string[],
  includeDrafts?: boolean | null,
  draftUserUid?: string | null
): string[] {
  const config = getLeadCMSConfig();
  const defaultLanguage = config.defaultLanguage;
  const localeContentDir = getContentDirForLocale(contentDir, locale);

  let slugs: string[];
  if (locale === defaultLanguage) {
    // For default language, we need to exclude language subdirectories
    slugs = getAllContentSlugsExcludingLanguageDirs(localeContentDir, contentTypes, contentDir);
  } else {
    // For other languages, just get all content from their directory
    slugs = getAllContentSlugsFromDir(localeContentDir, contentTypes);
  }

  // Apply draft filtering logic
  return applyDraftFiltering(slugs, includeDrafts, draftUserUid, contentDir, locale);
}

/**
 * Get all content slugs for a specific locale with draft filtering options
 * @param locale - Locale code
 * @param contentTypes - Optional array of content types to filter
 * @param includeDrafts - Whether to include draft content (default: null = false)
 * @param draftUserUid - Specific user UID for draft content (only relevant if includeDrafts is true)
 */
export function getAllContentSlugsForLocale(
  locale?: string,
  contentTypes?: readonly string[],
  includeDrafts?: boolean | null,
  draftUserUid?: string | null
): string[] {
  const config = getLeadCMSConfig();
  const contentDir = config.contentDir;

  if (!contentDir) {
    console.warn('[LeadCMS] No contentDir configured. Please set up your LeadCMS configuration.');
    return [];
  }

  return getAllContentSlugsForLocaleFromDir(contentDir, locale, contentTypes, includeDrafts, draftUserUid);
}

/**
 * Apply draft filtering logic to a list of slugs
 * @param slugs - Array of all slugs
 * @param includeDrafts - Whether to include draft content (null/false = filter out drafts)
 * @param draftUserUid - Specific user UID for draft content (only relevant if includeDrafts is true)
 * @param contentDir - Content directory to load content from for publishedAt checking
 * @param locale - Locale for content loading
 */
function applyDraftFiltering(
  slugs: string[],
  includeDrafts?: boolean | null,
  draftUserUid?: string | null,
  contentDir?: string,
  locale?: string
): string[] {
  // If includeDrafts is false or null, filter out all draft content
  if (!includeDrafts) {
    let filteredSlugs = filterOutDraftSlugs(slugs);

    // Also filter based on publishedAt if contentDir is available
    if (contentDir) {
      filteredSlugs = filteredSlugs.filter(slug => {
        const localeContentDir = getContentDirForLocale(contentDir, locale);
        const content = getCMSContentBySlugFromDir(slug, localeContentDir);
        return content && !isContentDraft(content);
      });
    }

    return filteredSlugs;
  }

  // If includeDrafts is true and draftUserUid is specified,
  // return base content with user's drafts overriding the originals
  // User-specific drafts are always included regardless of publishedAt
  if (draftUserUid) {
    return getBaseContentWithUserDraftOverrides(slugs, draftUserUid);
  }

  // If includeDrafts is true but no specific user UID, return all slugs as-is
  return slugs;
}

/**
 * Filter out draft slugs (those that have a corresponding base slug)
 * Uses GUID pattern detection since userUid is always a GUID
 */
function filterOutDraftSlugs(slugs: string[]): string[] {
  // GUID pattern: 8-4-4-4-12 hexadecimal characters with a preceding dash
  // Example: some-slug-550e8400-e29b-41d4-a716-446655440000
  const draftSlugPattern = /-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  return slugs.filter(slug => {
    const isDraft = draftSlugPattern.test(slug);
    return !isDraft;
  });
}

/**
 * Get base content slugs with user-specific draft overrides
 * Returns base slugs, but when content is fetched, user's version will be preferred
 * Also includes user-only drafts (drafts that don't have a base version)
 */
function getBaseContentWithUserDraftOverrides(slugs: string[], draftUserUid: string): string[] {
  // First, get all base slugs (non-draft)
  const baseSlugs = filterOutDraftSlugs(slugs);
  const result: string[] = [...baseSlugs]; // Start with all base slugs

  // Find user-only drafts (drafts that don't have a corresponding base slug)
  const userDraftPattern = new RegExp(`-${draftUserUid}$`);
  const userDrafts = slugs.filter(slug => userDraftPattern.test(slug));

  for (const userDraft of userDrafts) {
    const baseSlug = userDraft.replace(userDraftPattern, '');
    // If this is a user-only draft (no base version exists), add the base slug
    if (!baseSlugs.includes(baseSlug)) {
      result.push(baseSlug);
    }
  }

  return result;
}

function getAllContentSlugsExcludingLanguageDirs(
  contentDir: string,
  contentTypes?: readonly string[],
  rootContentDir?: string
): string[] {
  const config = getLeadCMSConfig();
  // Get available languages from the root content directory to know which directories to exclude
  const availableLanguages = rootContentDir
    ? getAvailableLanguagesFromDir(rootContentDir)
    : [config.defaultLanguage];

  function walk(dir: string, prefix = ""): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const slugs: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Skip language directories when we're in the root content directory
        const defaultLanguage = config.defaultLanguage;
        if (
          prefix === "" &&
          availableLanguages.includes(entry.name) &&
          entry.name !== defaultLanguage
        ) {
          continue;
        }

        const subSlugs = walk(
          path.join(dir, entry.name),
          prefix ? `${prefix}/${entry.name}` : entry.name
        );
        slugs.push(...subSlugs);
      } else if (entry.isFile() && (entry.name.endsWith(".mdx") || entry.name.endsWith(".json"))) {
        const ext = entry.name.endsWith(".mdx") ? ".mdx" : ".json";
        const slug = (prefix ? `${prefix}/` : "") + entry.name.replace(new RegExp(`\\${ext}$`), "");

        // If content types filter is provided, check the file's type
        if (contentTypes && contentTypes.length > 0) {
          const filePath = path.join(dir, entry.name);
          try {
            const fileType = getFileTypeOptimized(filePath, ext);
            // Only include if the type matches the filter
            if (fileType && contentTypes.includes(fileType)) {
              slugs.push(slug);
            }
          } catch {
            // Skip files that can't be parsed
            continue;
          }
        } else {
          // No filter, include all files
          slugs.push(slug);
        }
      }
    }
    return slugs;
  }
  return walk(contentDir);
}

/**
 * Get content by slug for a specific locale with optional draft support
 * @param slug - Content slug
 * @param locale - Locale code
 * @param userUid - Optional user UID for draft content
 * @param includeDrafts - Whether to include content that is draft based on publishedAt (default: false)
 */
export function getCMSContentBySlugForLocaleWithDraftSupport(
  slug: string,
  locale: string,
  userUid?: string | null,
  includeDrafts: boolean = false
): CMSContent | null {
  const config = getLeadCMSConfig();
  const contentDir = config.contentDir;

  if (!contentDir) {
    console.warn('[LeadCMS] No contentDir configured. Please set up your LeadCMS configuration.');
    return null;
  }

  // If userUid is provided and this isn't already a draft slug, try draft version first
  if (userUid && !extractUserUidFromSlug(slug)) {
    const draftSlug = `${slug}-${userUid}`;
    const draftContent = getCMSContentBySlugForLocaleFromDir(draftSlug, contentDir, locale);
    if (draftContent) {
      // Always return user-specific draft content when found, ignoring publishedAt logic
      return draftContent;
    }
  }

  // Fall back to regular content
  const content = getCMSContentBySlugForLocaleFromDir(slug, contentDir, locale);

  // Filter out drafts by default unless explicitly requested
  if (content && !includeDrafts && isContentDraft(content)) {
    return null;
  }

  return content;
}

/**
 * Get content by slug for a specific locale (internal helper)
 * @internal
 */
function getCMSContentBySlugForLocaleFromDir(
  slug: string,
  contentDir: string,
  locale?: string
): CMSContent | null {
  const localeContentDir = getContentDirForLocale(contentDir, locale);
  const content = getCMSContentBySlugFromDir(slug, localeContentDir);

  if (content) {
    // Ensure the locale is set on the content object
    content.language = content.language || locale;
  }

  return content;
}

/**
 * Get content by slug for a specific locale
 */
export function getCMSContentBySlugForLocale(
  slug: string,
  locale?: string,
  includeDrafts: boolean = false
): CMSContent | null {
  const config = getLeadCMSConfig();
  const contentDir = config.contentDir;

  if (!contentDir) {
    console.warn('[LeadCMS] No contentDir configured. Please set up your LeadCMS configuration.');
    return null;
  }

  const content = getCMSContentBySlugForLocaleFromDir(slug, contentDir, locale);

  // Filter out drafts by default unless explicitly requested
  if (content && !includeDrafts && isContentDraft(content)) {
    return null;
  }

  return content;
}

/**
 * Get all translations of a content item by translationKey
 * @param translationKey - The translation key to search for
 * @param includeDrafts - Whether to include draft content (default: false)
 */
export function getContentTranslations(
  translationKey: string,
  includeDrafts: boolean = false
): { locale: string; content: CMSContent }[] {
  const config = getLeadCMSConfig();
  const contentDir = config.contentDir;

  if (!contentDir) {
    console.warn('[LeadCMS] No contentDir configured. Please set up your LeadCMS configuration.');
    return [];
  }

  const languages = getAvailableLanguagesFromDir(contentDir);
  const translations: { locale: string; content: CMSContent }[] = [];

  for (const locale of languages) {
    const localeContentDir = getContentDirForLocale(contentDir, locale);

    // Search for content with matching translationKey
    try {
      const slugs = getAllContentSlugsForLocaleFromDir(contentDir, locale, undefined, includeDrafts);
      for (const slug of slugs) {
        const content = getCMSContentBySlugFromDir(slug, localeContentDir);
        if (content && content.translationKey === translationKey) {
          // Filter out drafts by default unless explicitly requested
          if (!includeDrafts && isContentDraft(content)) {
            continue;
          }

          content.language = content.language || locale;
          translations.push({ locale, content });
          break; // Found the translation for this locale
        }
      }
    } catch {
      // Skip if locale directory doesn't exist or can't be read
      continue;
    }
  }

  return translations;
}

/**
 * Get all content routes for all locales in a framework-agnostic format
 * Returns an array of route objects with locale and slug information
 * @param contentTypes - Optional array of content types to filter
 * @param includeDrafts - Whether to include draft content (default: false)
 * @param draftUserUid - Specific user UID for draft content (only relevant if includeDrafts is true)
 */
export function getAllContentRoutes(
  contentTypes?: readonly string[],
  includeDrafts: boolean = false,
  draftUserUid?: string | null
): { locale: string; slug: string; slugParts: string[]; isDefaultLocale: boolean; path: string }[] {
  const config = getLeadCMSConfig();
  const contentDir = config.contentDir;
  const defaultLanguage = config.defaultLanguage;

  if (!contentDir) {
    console.warn('[LeadCMS] No contentDir configured. Please set up your LeadCMS configuration.');
    return [];
  }

  const languages = getAvailableLanguagesFromDir(contentDir);
  const allRoutes: { locale: string; slug: string; slugParts: string[]; isDefaultLocale: boolean; path: string }[] = [];

  for (const locale of languages) {
    const slugs = getAllContentSlugsForLocaleFromDir(contentDir, locale, contentTypes, includeDrafts, draftUserUid);

    for (const slug of slugs) {
      const isDefaultLocale = locale === defaultLanguage;
      const slugParts = slug.split("/");
      const path = isDefaultLocale ? `/${slug}` : `/${locale}/${slug}`;

      allRoutes.push({
        locale,
        slug,
        slugParts,
        isDefaultLocale,
        path
      });
    }
  }

  return allRoutes;
}

/**
 * Extract userUid from a draft slug if it exists
 * @param slug - The slug to check for userUid
 * @returns userUid if found, null otherwise
 */
export function extractUserUidFromSlug(slug: string): string | null {
  // GUID pattern: 8-4-4-4-12 hexadecimal characters with a preceding dash
  const draftSlugPattern = /-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

  const match = slug.match(draftSlugPattern);
  return match ? match[1] : null;
}

export function getAllContentSlugs(
  contentTypes?: readonly string[],
  includeDrafts: boolean = false
): string[] {
  const config = getLeadCMSConfig();
  const contentDir = config.contentDir;

  if (!contentDir) {
    console.warn('[LeadCMS] No contentDir configured. Please set up your LeadCMS configuration.');
    return [];
  }

  const allSlugs = getAllContentSlugsFromDir(contentDir, contentTypes);

  // Always filter out user-specific draft slugs (with GUID pattern) - these should never appear in general listings
  let filteredSlugs = filterOutDraftSlugs(allSlugs);

  // Filter out draft content based on publishedAt if includeDrafts is false
  if (!includeDrafts) {
    // Then filter based on publishedAt
    return filteredSlugs.filter(slug => {
      const content = getCMSContentBySlugFromDir(slug, contentDir);
      return content && !isContentDraft(content);
    });
  }

  return filteredSlugs;
}

function getAllContentSlugsFromDir(contentDir: string, contentTypes?: readonly string[]): string[] {
  function walk(dir: string, prefix = ""): string[] {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error: any) {
      // If directory doesn't exist or can't be read, return empty array
      if (error.code === 'ENOENT' || error.code === 'EACCES') {
        return [];
      }
      throw error;
    }

    const slugs: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subSlugs = walk(
          path.join(dir, entry.name),
          prefix ? `${prefix}/${entry.name}` : entry.name
        );
        slugs.push(...subSlugs);
      } else if (entry.isFile() && (entry.name.endsWith(".mdx") || entry.name.endsWith(".json"))) {
        const ext = entry.name.endsWith(".mdx") ? ".mdx" : ".json";
        const slug = (prefix ? `${prefix}/` : "") + entry.name.replace(new RegExp(`\\${ext}$`), "");

        // If content types filter is provided, check the file's type
        if (contentTypes && contentTypes.length > 0) {
          const filePath = path.join(dir, entry.name);
          try {
            const fileType = getFileTypeOptimized(filePath, ext);
            // Only include if the type matches the filter
            if (fileType && contentTypes.includes(fileType)) {
              slugs.push(slug);
            }
          } catch {
            // Skip files that can't be parsed
            continue;
          }
        } else {
          // No filter, include all files
          slugs.push(slug);
        }
      }
    }
    return slugs;
  }
  return walk(contentDir);
}

export function getCMSContentBySlug(slug: string, includeDrafts: boolean = false): CMSContent | null {
  const config = getLeadCMSConfig();
  const contentDir = config.contentDir;

  if (!contentDir) {
    console.warn('[LeadCMS] No contentDir configured. Please set up your LeadCMS configuration.');
    return null;
  }

  const content = getCMSContentBySlugFromDir(slug, contentDir);

  // Filter out drafts by default unless explicitly requested
  if (content && !includeDrafts && isContentDraft(content)) {
    return null;
  }

  return content;
}

function getCMSContentBySlugFromDir(slug: string, contentDir: string): CMSContent | null {
  // Try both .mdx and .json extensions
  const mdxPath = path.join(contentDir, `${slug}.mdx`);
  const jsonPath = path.join(contentDir, `${slug}.json`);

  try {
    // Try MDX first - combine existence check with read operation
    try {
      const file = fs.readFileSync(mdxPath, "utf8");
      const { data, content } = matter(file);

      // Convert publishedAt string to Date if present
      if (data.publishedAt && typeof data.publishedAt === 'string') {
        data.publishedAt = new Date(data.publishedAt);
      }

      return {
        ...data,
        slug,
        body: content,
      } as CMSContent;
    } catch (mdxError: any) {
      // If MDX doesn't exist or can't be read, try JSON
      if (mdxError.code !== "ENOENT") {
        // If it's not a "file not found" error, rethrow
        throw mdxError;
      }
    }

    // Try JSON
    try {
      const file = fs.readFileSync(jsonPath, "utf8");
      const data = JSON.parse(file);

      // Convert publishedAt string to Date if present
      if (data.publishedAt && typeof data.publishedAt === 'string') {
        data.publishedAt = new Date(data.publishedAt);
      }

      return {
        ...data,
        slug,
      } as CMSContent;
    } catch (jsonError: any) {
      // If JSON doesn't exist or can't be read, return null
      if (jsonError.code === "ENOENT") {
        return null;
      }
      // If it's a parse error or other issue, rethrow
      throw jsonError;
    }
  } catch {
    return null;
  }
}

/**
 * Optimized function to extract file type without reading the entire file content.
 * For MDX files, it reads only the frontmatter section.
 * For JSON files, it attempts to read just enough to find the type field.
 */
function getFileTypeOptimized(filePath: string, ext: string): string | undefined {
  if (ext === ".mdx") {
    return extractTypeFromMDXFrontmatter(filePath);
  } else if (ext === ".json") {
    return extractTypeFromJSON(filePath);
  }
  return undefined;
}

/**
 * Reads only the frontmatter section of an MDX file to extract the type.
 * This is much more efficient than parsing the entire file.
 */
function extractTypeFromMDXFrontmatter(filePath: string): string | undefined {
  try {
    const file = fs.readFileSync(filePath, "utf8");
    // Quick check if file starts with frontmatter
    if (!file.startsWith("---\n") && !file.startsWith("---\r\n")) {
      return undefined;
    }

    // Find the end of frontmatter
    let endIndex = file.indexOf("\n---\n", 4);
    if (endIndex === -1) {
      endIndex = file.indexOf("\r\n---\r\n", 4);
    }
    if (endIndex === -1) {
      return undefined;
    }

    // Extract and parse only the frontmatter
    const frontmatterContent = file.slice(4, endIndex);
    const { data } = matter(`---\n${frontmatterContent}\n---`);

    return data.type;
  } catch {
    return undefined;
  }
}

/**
 * Attempts to extract the type field from a JSON file without parsing the entire content.
 * Uses streaming approach for large files.
 */
function extractTypeFromJSON(filePath: string): string | undefined {
  try {
    const file = fs.readFileSync(filePath, "utf8");

    // For small files, just parse normally
    if (file.length < 100) {
      const data = JSON.parse(file);
      return data.type;
    }

    // For larger files, try to find the type field early in the content
    // This is a simple optimization - look for "type": in the first part of the file
    const typeMatch = file.match(/"type"\s*:\s*"([^"]+)"/);
    if (typeMatch) {
      return typeMatch[1];
    }

    // Fallback to full parsing if quick match fails
    const data = JSON.parse(file);
    return data.type;
  } catch {
    return undefined;
  }
}

/**
 * Generic helper function to load configuration JSON files with draft support
 * @param contentDir - Content directory path
 * @param locale - Locale code
 * @param configName - Name of the config file (e.g., 'header', 'footer', 'contact')
 * @param userUid - Optional user UID for draft content
 * @returns Parsed config object or null if not found
 */
function loadConfigWithDraftSupport<T>(
  contentDir: string,
  locale: string,
  configName: string,
  userUid?: string | null
): T | null {
  try {
    const localeContentDir = getContentDirForLocale(contentDir, locale);
    let targetPath: string;
    let cacheKey: string;

    // If userUid is provided, try draft version first
    if (userUid) {
      const draftConfigPath = path.join(localeContentDir, `${configName}-${userUid}.json`);
      cacheKey = `${draftConfigPath}:${locale}:${configName}:${userUid}`;

      // Check cache first for draft
      const cached = contentCache.get(cacheKey);
      const now = Date.now();

      if (cached && (now - cached.timestamp) < CONTENT_CACHE_TTL) {
        return cached.content;
      }

      if (fs.existsSync(draftConfigPath)) {
        const draftConfigContent = fs.readFileSync(draftConfigPath, "utf-8");
        const parsed = JSON.parse(draftConfigContent) as T;

        // Cache the result
        contentCache.set(cacheKey, {
          content: parsed,
          timestamp: now,
          filePath: draftConfigPath,
        });

        return parsed;
      }
    }

    // Fall back to regular config file
    const configPath = path.join(localeContentDir, `${configName}.json`);
    cacheKey = `${configPath}:${locale}:${configName}`;

    // Check cache for regular config
    const cached = contentCache.get(cacheKey);
    const now = Date.now();

    if (cached && (now - cached.timestamp) < CONTENT_CACHE_TTL) {
      return cached.content;
    }

    if (!fs.existsSync(configPath)) {
      // Cache the null result too to avoid repeated file system checks
      contentCache.set(cacheKey, {
        content: null,
        timestamp: now,
        filePath: configPath,
      });

      // Provide detailed error information about what's missing
      const error = new Error(`Missing configuration file: '${configName}' for locale '${locale}' at path: ${configPath}`);
      error.name = 'MissingConfigurationFile';
      (error as any).configName = configName;
      (error as any).locale = locale;
      (error as any).filePath = configPath;

      throw error;
    }

    const configContent = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(configContent) as T;

    // Cache the result
    contentCache.set(cacheKey, {
      content: parsed,
      timestamp: now,
      filePath: configPath,
    });

    return parsed;
  } catch (error) {
    // If it's our custom MissingConfigurationFile error, provide more context
    if (error instanceof Error && error.name === 'MissingConfigurationFile') {
      console.error(`[LeadCMS] ${error.message}`);
      // Re-throw with more context for debugging
      const detailedError = new Error(`Missing configuration files - configName: '${configName}', locale: '${locale}', expected path: ${path.join(getContentDirForLocale(contentDir, locale), `${configName}.json`)}`);
      detailedError.name = 'MissingConfigurationFile';
      (detailedError as any).configName = configName;
      (detailedError as any).locale = locale;
      (detailedError as any).originalError = error;
      throw detailedError;
    }

    // For other errors (JSON parsing, file system, etc.)
    console.error(`[LeadCMS] Error loading ${configName} config for locale ${locale}:`, error);
    const wrappedError = new Error(`Failed to load configuration '${configName}' for locale '${locale}': ${error instanceof Error ? error.message : String(error)}`);
    wrappedError.name = 'ConfigurationLoadError';
    (wrappedError as any).configName = configName;
    (wrappedError as any).locale = locale;
    (wrappedError as any).originalError = error;
    throw wrappedError;
  }
}

/**
 * Convenience function to load configuration with automatic contentDir resolution
 * Uses the configured contentDir from the LeadCMS configuration system
 * @param configName - Name of the config file (e.g., 'header', 'footer', 'contact', 'navigation')
 * @param locale - Locale code (optional, uses default language from config if not provided)
 * @param userUid - Optional user UID for draft content
 * @returns Parsed config object or null if not found
 */
export function loadContentConfig<T>(
  configName: string,
  locale?: string,
  userUid?: string | null
): T | null {
  const config = getLeadCMSConfig();
  const actualLocale = locale || config.defaultLanguage;
  const contentDir = config.contentDir;

  if (!actualLocale) {
    throw new Error('[LeadCMS] No default language configured. Please set up your LeadCMS configuration with a defaultLanguage.');
  }

  if (!contentDir) {
    console.warn('[LeadCMS] No contentDir configured. Please set up your LeadCMS configuration.');
    return null;
  }

  try {
    return loadConfigWithDraftSupport<T>(contentDir, actualLocale, configName, userUid);
  } catch (error) {
    // Handle missing configuration files gracefully
    if (error instanceof Error && error.name === 'MissingConfigurationFile') {
      // In debug mode, provide helpful message for any missing config
      if (process.env.LEADCMS_DEBUG === 'true' || process.env.NODE_ENV === 'development') {
        console.warn(`[LeadCMS] Configuration '${configName}' not found for locale '${actualLocale}'. If you don't use this config, you can ignore this warning.`);
      }
      return null;
    }

    // For other errors, re-throw to provide debugging info
    throw error;
  }
}

/**
 * Load header configuration for a specific locale with optional draft support
 * @param contentDir - Content directory path
 * @param locale - Locale code
 * @param userUid - Optional user UID for draft content
 * @internal
 */
function getHeaderConfigInternal(contentDir: string, locale: string, userUid?: string | null): HeaderConfig | null {
  try {
    return loadConfigWithDraftSupport<HeaderConfig>(contentDir, locale, 'header', userUid);
  } catch (error) {
    // Handle missing configuration files gracefully for internal functions
    if (error instanceof Error && error.name === 'MissingConfigurationFile') {
      return null;
    }
    throw error;
  }
}

/**
 * Load footer configuration for a specific locale with optional draft support
 * @param contentDir - Content directory path
 * @param locale - Locale code
 * @param userUid - Optional user UID for draft content
 * @internal
 */
function getFooterConfigInternal(contentDir: string, locale: string, userUid?: string | null): FooterConfig | null {
  try {
    return loadConfigWithDraftSupport<FooterConfig>(contentDir, locale, 'footer', userUid);
  } catch (error) {
    // Handle missing configuration files gracefully for internal functions
    if (error instanceof Error && error.name === 'MissingConfigurationFile') {
      return null;
    }
    throw error;
  }
}

/**
 * Load header configuration using configured contentDir
 * @param locale - Locale code (optional, uses default language from config if not provided)
 * @param userUid - Optional user UID for draft content
 */
export function getHeaderConfig(locale?: string, userUid?: string | null): HeaderConfig | null {
  return loadContentConfig<HeaderConfig>('header', locale, userUid);
}

/**
 * Load footer configuration using configured contentDir
 * @param locale - Locale code (optional, uses default language from config if not provided)
 * @param userUid - Optional user UID for draft content
 */
export function getFooterConfig(locale?: string, userUid?: string | null): FooterConfig | null {
  return loadContentConfig<FooterConfig>('footer', locale, userUid);
}

/**
 * Get the current locale from a path
 * @param pathname - The pathname to extract locale from
 * @param contentDir - Content directory path (optional, uses configured contentDir if not provided)
 */
export function getLocaleFromPath(pathname: string): string {
  const config = getLeadCMSConfig();
  const contentDir = config.contentDir;
  const defaultLanguage = config.defaultLanguage;

  if (!defaultLanguage) {
    throw new Error('[LeadCMS] No default language configured. Please set up your LeadCMS configuration with a defaultLanguage.');
  }

  const segments = pathname.split("/").filter(Boolean);
  if (segments.length > 0) {
    const firstSegment = segments[0];

    // If we have a content directory, get available languages from it
    if (contentDir) {
      try {
        const knownLocales = getAvailableLanguagesFromDir(contentDir);
        if (knownLocales.includes(firstSegment)) {
          return firstSegment;
        }
      } catch {
        // If we can't read available languages, fall back to checking if it's not the default
        if (firstSegment.length === 2 && firstSegment !== defaultLanguage) {
          return firstSegment;
        }
      }
    } else {
      // Fallback: assume 2-character segments that aren't the default language are locales
      if (firstSegment.length === 2 && firstSegment !== defaultLanguage) {
        return firstSegment;
      }
    }
  }
  return defaultLanguage;
}

/**
 * Make a link locale-aware by adding the current locale prefix
 * @param href - The href to make locale-aware
 * @param currentLocale - The current locale
 */
export function makeLocaleAwareLink(href: string, currentLocale: string): string {
  // Don't modify external links or anchors
  if (href.startsWith("http") || href.startsWith("#")) {
    return href;
  }

  const config = getLeadCMSConfig();
  const defaultLanguage = config.defaultLanguage;

  if (!defaultLanguage) {
    throw new Error('[LeadCMS] No default language configured. Please set up your LeadCMS configuration with a defaultLanguage.');
  }

  // If it's the default language, don't add prefix
  if (currentLocale === defaultLanguage) {
    return href;
  }

  // If the href already starts with the locale, don't double-add it
  if (href.startsWith(`/${currentLocale}/`)) {
    return href;
  }

  // Add locale prefix
  return `/${currentLocale}${href.startsWith("/") ? "" : "/"}${href}`;
}

/**
 * Load configuration with detailed error information for debugging
 * Unlike loadContentConfig, this throws descriptive errors instead of returning null
 * @param configName - Name of the config file
 * @param locale - Locale code (optional, uses default language from config if not provided)
 * @param userUid - Optional user UID for draft content
 * @returns Parsed config object (never returns null)
 * @throws {Error} With detailed information about missing files including configName, locale, and expected path
 */
export function loadContentConfigStrict<T>(
  configName: string,
  locale?: string,
  userUid?: string | null
): T {
  const config = getLeadCMSConfig();
  const actualLocale = locale || config.defaultLanguage;
  const contentDir = config.contentDir;

  if (!actualLocale) {
    throw new Error('[LeadCMS] No default language configured. Please set up your LeadCMS configuration with a defaultLanguage.');
  }

  if (!contentDir) {
    throw new Error('[LeadCMS] No contentDir configured. Please set up your LeadCMS configuration.');
  }

  // This will throw detailed errors with configName, locale, and path information
  return loadConfigWithDraftSupport<T>(contentDir, actualLocale, configName, userUid) as T;
}

