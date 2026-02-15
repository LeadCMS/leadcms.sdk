/**
 * Shared content transformation utilities for LeadCMS SDK
 * This module provides common functionality for transforming content between
 * remote API format and local file format (MDX/JSON)
 */

import matter from 'gray-matter';
import fs from 'fs/promises';
import path from 'path';
import { getConfig } from './config.js';

export interface RemoteContentData {
  id?: number | string;
  slug: string;
  type: string;
  language?: string;
  title?: string;
  body?: string;
  isLocal?: boolean;
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string;
  [key: string]: any;
}

export interface ContentTypeMap {
  [contentType: string]: 'MDX' | 'JSON';
}

/**
 * Transform remote content data to local file format (MDX or JSON)
 * This function converts API response format to the format expected in local files
 *
 * @param remote - Remote content data from API
 * @param typeMap - Mapping of content types to their file formats
 * @returns Transformed content as string (MDX or JSON format)
 */
export async function transformRemoteToLocalFormat(
  remote: RemoteContentData,
  typeMap: ContentTypeMap = {}
): Promise<string> {
  if (!remote || typeof remote !== "object") {
    throw new Error("Invalid remote content");
  }

  const contentType = typeMap[remote.type] || 'MDX';

  if (contentType === 'MDX') {
    return transformToMDXFormat(remote);
  } else if (contentType === 'JSON') {
    return transformToJSONFormat(remote);
  } else {
    throw new Error(`Unsupported content type: ${contentType}`);
  }
}

/**
 * Transform remote content for comparison with a specific local file
 * This version only includes fields that exist in BOTH remote and local content
 * to avoid false positives when remote has additional metadata fields
 *
 * @param remote - Remote content data from API
 * @param localContent - Local file content as string
 * @param typeMap - Mapping of content types to their file formats
 * @returns Transformed content as string, matching local field structure
 */
export async function transformRemoteForComparison(
  remote: RemoteContentData,
  localContent: string,
  typeMap: ContentTypeMap = {}
): Promise<string> {
  if (!remote || typeof remote !== "object") {
    throw new Error("Invalid remote content");
  }

  const contentType = typeMap[remote.type] || 'MDX';

  if (contentType === 'MDX') {
    return transformToMDXFormatForComparison(remote, localContent);
  } else if (contentType === 'JSON') {
    return transformToJSONFormatForComparison(remote, localContent);
  } else {
    throw new Error(`Unsupported content type: ${contentType}`);
  }
}

/**
 * Transform remote content to MDX format for comparison with local content.
 * Includes ALL non-system remote fields so that field removals in local content
 * are properly detected as changes.
 */
function transformToMDXFormatForComparison(remote: RemoteContentData, localContent: string): string {
  // Validate that local content is parseable MDX, fall back to full transform if not
  try {
    matter(localContent);
  } catch (error) {
    return transformToMDXFormat(remote);
  }

  let body = remote.body || "";
  let bodyFrontmatter: Record<string, any> = {};
  let bodyContent = body;

  // Extract frontmatter from body if present
  const fmMatch = body.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fmMatch) {
    try {
      // Use matter() to parse YAML by wrapping in delimiters
      const yamlWithDelimiters = `---\n${fmMatch[1]}\n---\n`;
      bodyFrontmatter = matter(yamlWithDelimiters).data || {};
    } catch (error: any) {
      console.warn(`Failed to parse frontmatter:`, error.message);
    }
    bodyContent = body.slice(fmMatch[0].length);
  }

  // Merge frontmatter, body frontmatter takes precedence over content metadata
  const mergedFrontmatter = { ...remote, ...bodyFrontmatter };

  // Exclude system/internal fields that should not appear in local files
  const systemFields = ['body', 'isLocal'];
  systemFields.forEach(field => delete mergedFrontmatter[field]);

  // Include ALL non-system remote fields so that field removals are detected.
  // The timestamp check in matchContent already prevents false positives from
  // server-side field additions (remote newer → conflict, not comparison).

  // Filter out null and undefined values to prevent them from appearing in frontmatter
  const filteredFrontmatter = filterNullValues(mergedFrontmatter);

  // Apply media path replacements to both frontmatter and body content
  const cleanedFrontmatter = replaceApiMediaPaths(filteredFrontmatter);
  const cleanedContent = replaceApiMediaPaths(bodyContent);

  // Use gray-matter's stringify to build frontmatter + content, adding extra newline for consistency
  return matter.stringify(`\n${cleanedContent.trim()}`, cleanedFrontmatter);
}

/**
 * Transform remote content to JSON format for comparison with local content.
 * Includes ALL non-system remote fields so that field removals in local content
 * are properly detected as changes.
 */
function transformToJSONFormatForComparison(remote: RemoteContentData, localContent: string): string {
  // Validate that local content is parseable JSON, fall back to full transform if not
  try {
    JSON.parse(localContent);
  } catch (error) {
    return transformToJSONFormat(remote);
  }

  let bodyObj: Record<string, any> = {};

  try {
    bodyObj = remote.body ? JSON.parse(remote.body) : {};
  } catch {
    bodyObj = {};
  }

  // Apply URL transformation to the body object first
  const transformedBodyObj = replaceApiMediaPaths(bodyObj);
  const merged = { ...transformedBodyObj };

  // Exclude system/internal fields that should not appear in local files
  const systemFields = ['body', 'isLocal'];

  // Include ALL non-system remote fields so that field removals are detected.
  // The timestamp check in matchContent already prevents false positives from
  // server-side field additions (remote newer → conflict, not comparison).
  for (const [k, v] of Object.entries(remote)) {
    if (!systemFields.includes(k)) {
      merged[k] = replaceApiMediaPaths(v);
    }
  }

  // Filter out null and undefined values to prevent them from appearing in JSON
  const filteredMerged = filterNullValues(merged);

  return JSON.stringify(filteredMerged, null, 2);
}

/**
 * Transform remote content to MDX format with frontmatter
 */
function transformToMDXFormat(remote: RemoteContentData): string {
  let body = remote.body || "";
  let bodyFrontmatter: Record<string, any> = {};
  let bodyContent = body;

  // Extract frontmatter from body if present
  const fmMatch = body.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fmMatch) {
    try {
      // Use matter() to parse YAML by wrapping in delimiters
      const yamlWithDelimiters = `---\n${fmMatch[1]}\n---\n`;
      bodyFrontmatter = matter(yamlWithDelimiters).data || {};
    } catch (error: any) {
      console.warn(`Failed to parse frontmatter:`, error.message);
    }
    bodyContent = body.slice(fmMatch[0].length);
  }

  // Merge frontmatter, body frontmatter takes precedence over content metadata
  const mergedFrontmatter = { ...remote, ...bodyFrontmatter };

  // Exclude system/internal fields that should not appear in local files
  // Only exclude truly internal fields, not user content fields like timestamps
  const systemFields = ['body', 'isLocal'];
  systemFields.forEach(field => delete mergedFrontmatter[field]);

  // Filter out null and undefined values to prevent them from appearing in frontmatter
  const filteredFrontmatter = filterNullValues(mergedFrontmatter);

  // Apply media path replacements to both frontmatter and body content
  const cleanedFrontmatter = replaceApiMediaPaths(filteredFrontmatter);
  const cleanedContent = replaceApiMediaPaths(bodyContent);

  // Use gray-matter's stringify to build frontmatter + content, adding extra newline for consistency
  return matter.stringify(`\n${cleanedContent.trim()}`, cleanedFrontmatter);
}

/**
 * Transform remote content to JSON format
 */
function transformToJSONFormat(remote: RemoteContentData): string {
  let bodyObj: Record<string, any> = {};

  try {
    bodyObj = remote.body ? JSON.parse(remote.body) : {};
  } catch {
    bodyObj = {};
  }

  // Apply URL transformation to the body object first
  const transformedBodyObj = replaceApiMediaPaths(bodyObj);
  const merged = { ...transformedBodyObj };

  // Exclude system/internal fields that should not appear in local files
  // Only exclude truly internal fields, not user content fields like timestamps
  const systemFields = ['body', 'isLocal'];

  for (const [k, v] of Object.entries(remote)) {
    if (!systemFields.includes(k)) {
      merged[k] = replaceApiMediaPaths(v);
    }
  }

  // Filter out null and undefined values to prevent them from appearing in JSON
  const filteredMerged = filterNullValues(merged);

  return JSON.stringify(filteredMerged, null, 2);
}

/**
 * Replace API media paths with local media paths
 * Converts /api/media/ paths to /media/ paths
 * Only transforms paths that start with /api/media/ (not in the middle of URLs)
 */
export function replaceApiMediaPaths(obj: any): any {
  if (typeof obj === "string") {
    // Only replace /api/media/ that appears at the start of a path or after whitespace/quotes
    // This prevents replacing /api/media/ inside external URLs like https://example.com/api/media/
    return obj.replace(/(^|[\s"'\(\)\[\]>])\/api\/media\//g, "$1/media/");
  } else if (Array.isArray(obj)) {
    return obj.map(replaceApiMediaPaths);
  } else if (typeof obj === "object" && obj !== null) {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = replaceApiMediaPaths(v);
    }
    return out;
  }
  return obj;
}

/**
 * Replace local media paths with API media paths (reverse transformation for push)
 * Converts /media/ paths to /api/media/ paths
 * Only transforms paths that start with /media/ (not in the middle of URLs)
 */
export function replaceLocalMediaPaths(obj: any): any {
  if (typeof obj === "string") {
    // Only replace /media/ that appears at the start of a path or after whitespace/quotes
    // This prevents replacing /media/ inside external URLs like https://example.com/media/
    return obj.replace(/(^|[\s"'\(\)\[\]>])\/media\//g, "$1/api/media/");
  } else if (Array.isArray(obj)) {
    return obj.map(replaceLocalMediaPaths);
  } else if (typeof obj === "object" && obj !== null) {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = replaceLocalMediaPaths(v);
    }
    return out;
  }
  return obj;
}

/**
 * Normalize content for comparison by handling whitespace differences
 */
export function normalizeContentForComparison(content: string): string {
  return content
    .trim()
    .replace(/\r\n/g, '\n')  // Normalize line endings
    .replace(/\s+\n/g, '\n') // Remove trailing whitespace on lines
    .replace(/\n\n+/g, '\n\n'); // Normalize multiple newlines to double newlines
}

/**
 * Compare two content strings after normalization
 * Returns true if contents are different
 */
export function hasContentDifferences(content1: string, content2: string): boolean {
  const normalized1 = normalizeContentForComparison(content1);
  const normalized2 = normalizeContentForComparison(content2);
  return normalized1 !== normalized2;
}

/**
 * Filter out null and undefined values from an object
 * This prevents empty/null fields from appearing in frontmatter
 */
function filterNullValues(obj: Record<string, any>): Record<string, any> {
  const filtered: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && value !== undefined) {
      filtered[key] = value;
    }
  }
  return filtered;
}

/**
 * Options for saving content files
 */
export interface SaveContentFileOptions {
  content: RemoteContentData;
  typeMap?: Record<string, string>;
  contentDir: string;
  previewSlug?: string;
}

/**
 * Save content file using shared transformation logic
 * This function combines transformation and file writing operations
 *
 * @param options - Configuration options for saving the content file
 * @returns Promise that resolves to the file path if successful, undefined otherwise
 */
export async function saveContentFile({
  content,
  typeMap = {},
  contentDir,
  previewSlug
}: SaveContentFileOptions): Promise<string | undefined> {
  if (!content || typeof content !== "object") {
    console.warn("[LeadCMS] Skipping undefined or invalid content:", content);
    return;
  }

  const slug = previewSlug || content.slug;
  if (!slug) {
    console.warn("[LeadCMS] Skipping content with missing slug:", content);
    return;
  }

  // Inject draft: true when previewSlug is provided (indicates draft content)
  const contentToTransform = previewSlug ? { ...content, draft: true } : content;

  // Convert typeMap to the format expected by shared transformation
  const contentTypeMap: ContentTypeMap = {};
  for (const [key, value] of Object.entries(typeMap)) {
    contentTypeMap[key] = value === 'JSON' ? 'JSON' : 'MDX';
  }

  // Use shared transformation logic
  const transformedContent = await transformRemoteToLocalFormat(contentToTransform, contentTypeMap);

  // Determine the target directory based on language
  const config = getConfig();
  let targetContentDir = contentDir;
  const contentLanguage = content.language || config.defaultLanguage;

  if (contentLanguage !== config.defaultLanguage) {
    // Save non-default language content in language-specific folder
    targetContentDir = path.join(contentDir, contentLanguage);
  }

  // Determine file extension based on content type
  const contentType = contentTypeMap[content.type] || 'MDX';
  const extension = contentType === 'MDX' ? '.mdx' : '.json';
  const filePath = path.join(targetContentDir, `${slug}${extension}`);

  // Ensure directory exists and write the file
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, transformedContent, "utf8");

  return filePath;
}
