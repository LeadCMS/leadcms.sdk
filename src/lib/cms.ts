import fs from "fs";
import path from "path";
import matter from "gray-matter";
// Type definitions for configuration objects
export interface HeaderConfig { [key: string]: any; }
export interface FooterConfig { [key: string]: any; }
export interface ContactConfig { [key: string]: any; }
export interface DashedCardConfig { [key: string]: any; }


// Default language from environment or fallback to 'en'
export const DEFAULT_LANGUAGE = process.env.NEXT_PUBLIC_LEADCMS_DEFAULT_LANGUAGE || "en";

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
  publishedAt?: Date;
  draft?: boolean; // Added to support draft content filtering

  [key: string]: any;
  body: string;
}

/**
 * Get all available languages from the content directory structure
 */
export function getAvailableLanguages(contentDir: string): string[] {
  try {
    const entries = fs.readdirSync(contentDir, { withFileTypes: true });
    const languages = [DEFAULT_LANGUAGE]; // Always include default language

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
    return [DEFAULT_LANGUAGE];
  }
}

/**
 * Get content directory for a specific locale
 */
export function getContentDirForLocale(contentDir: string, locale: string): string {
  if (locale === DEFAULT_LANGUAGE) {
    return contentDir;
  }
  return path.join(contentDir, locale);
}

/**
 * Get all content slugs for a specific locale with draft filtering options
 * @param contentDir - Content directory path
 * @param locale - Locale code
 * @param contentTypes - Optional array of content types to filter
 * @param includeDrafts - Whether to include draft content (default: null = false)
 * @param draftUserUid - Specific user UID for draft content (only relevant if includeDrafts is true)
 */
export function getAllContentSlugsForLocale(
  contentDir: string,
  locale: string,
  contentTypes?: string[],
  includeDrafts?: boolean | null,
  draftUserUid?: string | null
): string[] {
  const localeContentDir = getContentDirForLocale(contentDir, locale);

  let slugs: string[];
  if (locale === DEFAULT_LANGUAGE) {
    // For default language, we need to exclude language subdirectories
    slugs = getAllContentSlugsExcludingLanguageDirs(localeContentDir, contentTypes, contentDir);
  } else {
    // For other languages, just get all content from their directory
    slugs = getAllContentSlugs(localeContentDir, contentTypes);
  }

  // Apply draft filtering logic
  return applyDraftFiltering(slugs, includeDrafts, draftUserUid);
}

/**
 * Apply draft filtering logic to a list of slugs
 * @param slugs - Array of all slugs
 * @param includeDrafts - Whether to include draft content (null/false = filter out drafts)
 * @param draftUserUid - Specific user UID for draft content (only relevant if includeDrafts is true)
 */
function applyDraftFiltering(
  slugs: string[],
  includeDrafts?: boolean | null,
  draftUserUid?: string | null
): string[] {
  // If includeDrafts is false or null, filter out all draft content
  if (!includeDrafts) {
    return filterOutDraftSlugs(slugs);
  }

  // If includeDrafts is true but no specific user UID, return all slugs as-is
  if (!draftUserUid) {
    return slugs;
  }

  // If includeDrafts is true and draftUserUid is specified,
  // return base content with user's drafts overriding the originals
  return getBaseContentWithUserDraftOverrides(slugs, draftUserUid);
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
 * Returns only the user's draft versions when they exist, otherwise the base content
 */
function getBaseContentWithUserDraftOverrides(slugs: string[], draftUserUid: string): string[] {
  // First, get all base slugs (non-draft)
  const baseSlugs = filterOutDraftSlugs(slugs);

  // For each base slug, check if user has a draft version and prefer it
  const result: string[] = [];

  for (const baseSlug of baseSlugs) {
    const userDraftSlug = `${baseSlug}-${draftUserUid}`;

    // If user has a draft version, use it; otherwise use the base version
    if (slugs.includes(userDraftSlug)) {
      result.push(userDraftSlug);
    } else {
      result.push(baseSlug);
    }
  }

  return result;
}

function getAllContentSlugsExcludingLanguageDirs(
  contentDir: string,
  contentTypes?: string[],
  rootContentDir?: string
): string[] {
  // Get available languages from the root content directory to know which directories to exclude
  const availableLanguages = rootContentDir
    ? getAvailableLanguages(rootContentDir)
    : [DEFAULT_LANGUAGE];

  function walk(dir: string, prefix = ""): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const slugs: string[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Skip language directories when we're in the root content directory
        if (
          prefix === "" &&
          availableLanguages.includes(entry.name) &&
          entry.name !== DEFAULT_LANGUAGE
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
 * @param contentDir - Content directory path
 * @param locale - Locale code
 * @param userUid - Optional user UID for draft content
 */
export function getCMSContentBySlugForLocaleWithDraftSupport(
  slug: string,
  contentDir: string,
  locale: string,
  userUid?: string | null
): CMSContent | null {
  // If userUid is provided and this isn't already a draft slug, try draft version first
  if (userUid && !extractUserUidFromSlug(slug)) {
    const draftSlug = `${slug}-${userUid}`;
    const draftContent = getCMSContentBySlugForLocale(draftSlug, contentDir, locale);
    if (draftContent) {
      return draftContent;
    }
  }

  // Fall back to regular content
  return getCMSContentBySlugForLocale(slug, contentDir, locale);
}

/**
 * Get content by slug for a specific locale
 */
export function getCMSContentBySlugForLocale(
  slug: string,
  contentDir: string,
  locale: string
): CMSContent | null {
  const localeContentDir = getContentDirForLocale(contentDir, locale);
  const content = getCMSContentBySlug(slug, localeContentDir);

  if (content) {
    // Ensure the locale is set on the content object
    content.language = content.language || locale;
  }

  return content;
}

/**
 * Get all translations of a content item by translationKey
 */
export function getContentTranslations(
  translationKey: string,
  contentDir: string
): { locale: string; content: CMSContent }[] {
  const languages = getAvailableLanguages(contentDir);
  const translations: { locale: string; content: CMSContent }[] = [];

  for (const locale of languages) {
    const localeContentDir = getContentDirForLocale(contentDir, locale);

    // Search for content with matching translationKey
    try {
      const slugs = getAllContentSlugs(localeContentDir);
      for (const slug of slugs) {
        const content = getCMSContentBySlug(slug, localeContentDir);
        if (content && content.translationKey === translationKey) {
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
 * Generate static params for all locales and content
 */
export function generateStaticParamsForAllLocales(
  contentDir: string,
  contentTypes?: string[],
  includeDrafts?: boolean | null,
  draftUserUid?: string | null
): { locale?: string; slug: string[] }[] {
  const languages = getAvailableLanguages(contentDir);
  const allParams: { locale?: string; slug: string[] }[] = [];

  for (const locale of languages) {
    const slugs = getAllContentSlugsForLocale(contentDir, locale, contentTypes, includeDrafts, draftUserUid);

    for (const slug of slugs) {
      if (locale === DEFAULT_LANGUAGE) {
        // Default language doesn't need locale prefix
        allParams.push({ slug: slug.split("/") });
      } else {
        // Non-default languages get locale prefix
        allParams.push({ locale, slug: slug.split("/") });
      }
    }
  }

  return allParams;
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

export function getAllContentSlugs(contentDir: string, contentTypes?: string[]): string[] {
  function walk(dir: string, prefix = ""): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
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

export function getCMSContentBySlug(slug: string, contentDir: string): CMSContent | null {
  // Try both .mdx and .json extensions
  const mdxPath = path.join(contentDir, `${slug}.mdx`);
  const jsonPath = path.join(contentDir, `${slug}.json`);

  try {
    // Try MDX first - combine existence check with read operation
    try {
      const file = fs.readFileSync(mdxPath, "utf8");
      const { data, content } = matter(file);
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

    // If userUid is provided, try draft version first
    if (userUid) {
      const draftConfigPath = path.join(localeContentDir, `${configName}-${userUid}.json`);
      if (fs.existsSync(draftConfigPath)) {
        const draftConfigContent = fs.readFileSync(draftConfigPath, "utf-8");
        return JSON.parse(draftConfigContent) as T;
      }
    }

    // Fall back to regular config file
    const configPath = path.join(localeContentDir, `${configName}.json`);
    if (!fs.existsSync(configPath)) {
      return null;
    }

    const configContent = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(configContent) as T;
  } catch (error) {
    console.error(`Error loading ${configName} config for locale ${locale}:`, error);
    return null;
  }
}

/**
 * Load header configuration for a specific locale with optional draft support
 * @param contentDir - Content directory path
 * @param locale - Locale code
 * @param userUid - Optional user UID for draft content
 */
export function getHeaderConfig(contentDir: string, locale: string, userUid?: string | null): HeaderConfig | null {
  return loadConfigWithDraftSupport<HeaderConfig>(contentDir, locale, 'header', userUid);
}

/**
 * Load footer configuration for a specific locale with optional draft support
 * @param contentDir - Content directory path
 * @param locale - Locale code
 * @param userUid - Optional user UID for draft content
 */
export function getFooterConfig(contentDir: string, locale: string, userUid?: string | null): FooterConfig | null {
  return loadConfigWithDraftSupport<FooterConfig>(contentDir, locale, 'footer', userUid);
}

/**
 * Load contact configuration for a specific locale with optional draft support
 * @param contentDir - Content directory path
 * @param locale - Locale code
 * @param userUid - Optional user UID for draft content
 */
export function getContactConfig(contentDir: string, locale: string, userUid?: string | null): ContactConfig | null {
  return loadConfigWithDraftSupport<ContactConfig>(contentDir, locale, 'contact', userUid);
}

/**
 * Load dashed card configuration for a specific locale with optional draft support
 * @param contentDir - Content directory path
 * @param locale - Locale code
 * @param userUid - Optional user UID for draft content
 */
export function getDashedCardConfig(contentDir: string, locale: string, userUid?: string | null): DashedCardConfig | null {
  return loadConfigWithDraftSupport<DashedCardConfig>(contentDir, locale, 'dashed-card', userUid);
}

/**
 * Get the current locale from a path
 */
export function getLocaleFromPath(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length > 0) {
    const firstSegment = segments[0];
    // Check if the first segment is a known locale
    const knownLocales = ["en", "ru", "cs"]; // Add more locales as needed
    if (knownLocales.includes(firstSegment)) {
      return firstSegment;
    }
  }
  return DEFAULT_LANGUAGE;
}

/**
 * Make a link locale-aware by adding the current locale prefix
 */
export function makeLocaleAwareLink(href: string, currentLocale: string): string {
  // Don't modify external links or anchors
  if (href.startsWith("http") || href.startsWith("#")) {
    return href;
  }

  // If it's the default language, don't add prefix
  if (currentLocale === DEFAULT_LANGUAGE) {
    return href;
  }

  // If the href already starts with the locale, don't double-add it
  if (href.startsWith(`/${currentLocale}/`)) {
    return href;
  }

  // Add locale prefix
  return `/${currentLocale}${href.startsWith("/") ? "" : "/"}${href}`;
}
