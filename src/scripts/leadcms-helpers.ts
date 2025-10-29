import fs from "fs/promises";
import path from "path";
import yaml from "js-yaml";
import axios, { AxiosResponse } from "axios";
import { getConfig, type LeadCMSConfig } from "../lib/config.js";

// Type definitions
interface ContentType {
  uid: string;
  format: string;
}

interface ContentItem {
  id?: number; // Optional for new content that hasn't been created yet
  slug: string;
  type: string;
  language?: string;
  createdAt?: string;
  updatedAt?: string;
  body?: string;
  [key: string]: any;
}

// Use the main configuration system instead of duplicating logic
const config = getConfig();

// Use configuration with environment variable fallbacks
export const leadCMSUrl = config.url;
export const leadCMSApiKey = config.apiKey;
export const defaultLanguage = config.defaultLanguage;
export const CONTENT_DIR = path.resolve(config.contentDir);
export const MEDIA_DIR = path.resolve(config.mediaDir);

// Fetch content types dynamically from LeadCMS API to build typeMap
// Content types are automatically detected and don't need to be configured
export async function fetchContentTypes(): Promise<Record<string, string>> {
  console.log(`[LeadCMS] Fetching content types from API...`);
  const url = new URL("/api/content-types", leadCMSUrl);
  url.searchParams.set("filter[limit]", "100");

  try {
    const res: AxiosResponse<ContentType[]> = await axios.get(url.toString(), {
      headers: { Authorization: `Bearer ${leadCMSApiKey}` },
    });

    const types = res.data;
    const typeMap: Record<string, string> = {};
    for (const t of types) {
      typeMap[t.uid] = t.format;
    }

    console.log(`[LeadCMS] Detected ${Object.keys(typeMap).length} content types:`, Object.keys(typeMap).join(', '));
    return typeMap;
  } catch (error: any) {
    console.error(`[LeadCMS] Failed to fetch content types:`, error.message);
    return {};
  }
}

export function extractMediaUrlsFromContent(content: ContentItem): string[] {
  console.log(`[LeadCMS] Extracting media URLs from content: ${content}`);
  const urls = new Set<string>();
  const body = content.body || "";
  const regex = /["'\(](\/api\/media\/[^"'\)\s]+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(body))) {
    urls.add(match[1]);
  }

  if (content.coverImageUrl && content.coverImageUrl.startsWith("/api/media/")) {
    urls.add(content.coverImageUrl);
  }

  return Array.from(urls);
}

// Direct media download without meta.json dependency
export async function downloadMediaFileDirect(
  mediaUrl: string,
  destPath: string,
  leadCMSUrl: string,
  leadCMSApiKey: string
): Promise<boolean> {
  await fs.mkdir(path.dirname(destPath), { recursive: true });

  const fullUrl = mediaUrl.startsWith("http") ? mediaUrl : leadCMSUrl.replace(/\/$/, "") + mediaUrl;
  const headers = { Authorization: `Bearer ${leadCMSApiKey}` };

  try {
    const res = await axios.get(fullUrl, {
      responseType: "arraybuffer",
      headers,
      validateStatus: (status) =>
        (status >= 200 && status < 300) || status === 404,
    });

    if (res.status === 404) {
      // Remove file if not found on server
      try {
        await fs.unlink(destPath);
        console.log(`Deleted missing file: ${destPath}`);
      } catch {}
      return false;
    }

    await fs.writeFile(destPath, res.data);
    return true;
  } catch (err: any) {
    console.error(`Failed to download ${mediaUrl}:`, err.message);
    throw err;
  }
}

// Old downloadMediaFile function removed - replaced with downloadMediaFileDirect
// No longer using meta.json for media file caching, using sync API instead

export function buildFrontmatter(content: Record<string, any>): string {
  const omit = ["body"];
  const fm = Object.fromEntries(
    Object.entries(content).filter(([k, v]) => !omit.includes(k) && v !== undefined && v !== null)
  );
  return `---\n${yaml.dump(fm)}---`;
}

export function replaceApiMediaPaths(obj: any): any {
  if (typeof obj === "string") {
    return obj.replace(/\/api\/media\//g, "/media/");
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

interface SaveContentFileOptions {
  content: ContentItem;
  typeMap?: Record<string, string>;
  contentDir: string;
  previewSlug?: string;
}

export async function saveContentFile({
  content,
  typeMap,
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

  const contentType = typeMap
    ? typeMap[content.type || '']
    : content.format || (content.body ? "MDX" : "JSON");
  const cleanedContent = replaceApiMediaPaths(content);

  // Inject draft: true when previewSlug is provided (indicates draft content)
  if (previewSlug) {
    cleanedContent.draft = true;
  }

  // Determine the target directory based on language
  let targetContentDir = contentDir;
  const contentLanguage = content.language || defaultLanguage;

  if (contentLanguage !== defaultLanguage) {
    // Save non-default language content in language-specific folder
    targetContentDir = path.join(contentDir, contentLanguage);
  }

  if (contentType === "MDX") {
    const filePath = path.join(targetContentDir, `${slug}.mdx`);
    let body = cleanedContent.body || "";
    let bodyFrontmatter: Record<string, any> = {};
    let bodyContent = body;

    // Extract frontmatter from body if present
    const fmMatch = body.match(/^---\n([\s\S]*?)\n---\n?/);
    if (fmMatch) {
      try {
        bodyFrontmatter = (yaml.load(fmMatch[1]) as Record<string, any>) || {};
      } catch (error: any) {
        console.warn(`[LeadCMS] Failed to parse frontmatter in body for ${slug}:`, error.message);
      }
      bodyContent = body.slice(fmMatch[0].length);
    }

    // Merge frontmatters, body frontmatter takes precedence over content metadata
    const mergedFrontmatter = { ...cleanedContent, ...bodyFrontmatter };
    delete mergedFrontmatter.body;
    const frontmatterStr = buildFrontmatter(mergedFrontmatter);
    const mdx = `${frontmatterStr}\n\n${bodyContent.replace(/\/api\/media\//g, "/media/").trim()}\n`;

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, mdx, "utf8");
    return filePath;
  } else {
    let bodyObj: Record<string, any> = {};
    try {
      bodyObj = cleanedContent.body ? JSON.parse(cleanedContent.body) : {};
    } catch {
      bodyObj = {};
    }

    const merged = { ...bodyObj };
    for (const [k, v] of Object.entries(cleanedContent)) {
      if (k !== "body") merged[k] = v;
    }

    const filePath = path.join(targetContentDir, `${slug}.json`);
    const jsonStr = JSON.stringify(merged, null, 2);

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, jsonStr, "utf8");
    return filePath;
  }
}

// Export types for use in other modules
export type { LeadCMSConfig, ContentType, ContentItem, SaveContentFileOptions };
