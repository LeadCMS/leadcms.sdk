import fs from "fs/promises";
import path from "path";
import axios, { AxiosResponse } from "axios";
import { getConfig, type LeadCMSConfig } from "../lib/config.js";
import { logger } from "../lib/logger.js";

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
export const EMAIL_TEMPLATES_DIR = path.resolve(config.emailTemplatesDir);

// Fetch content types dynamically from LeadCMS API to build typeMap
// Content types are automatically detected and don't need to be configured
export async function fetchContentTypes(): Promise<Record<string, string>> {
  logger.verbose(`[LeadCMS] Fetching content types from API...`);
  logger.verbose(`[LeadCMS] Fetching public content types (no authentication)`);
  const url = new URL("/api/content-types", leadCMSUrl);
  url.searchParams.set("filter[limit]", "100");

  try {
    // SECURITY: Never send API key for read operations
    // Content types should only return public types
    const res: AxiosResponse<ContentType[]> = await axios.get(url.toString());

    const types = res.data;
    const typeMap: Record<string, string> = {};
    for (const t of types) {
      typeMap[t.uid] = t.format;
    }

    logger.verbose(`[LeadCMS] Detected ${Object.keys(typeMap).length} content types:`, Object.keys(typeMap).join(', '));
    return typeMap;
  } catch (error: any) {
    console.error(`[LeadCMS] Failed to fetch content types:`, error.message);
    return {};
  }
}

export function extractMediaUrlsFromContent(content: ContentItem): string[] {
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

  const foundUrls = Array.from(urls);
  if (foundUrls.length > 0) {
    logger.verbose(`[LeadCMS] Extracted ${foundUrls.length} media URL(s) from content: ${content.slug || content.id}`);
  }

  return foundUrls;
}

// Direct media download without meta.json dependency
export async function downloadMediaFileDirect(
  mediaUrl: string,
  destPath: string,
  leadCMSUrl: string,
  leadCMSApiKey?: string
): Promise<boolean> {
  await fs.mkdir(path.dirname(destPath), { recursive: true });

  const fullUrl = mediaUrl.startsWith("http") ? mediaUrl : leadCMSUrl.replace(/\/$/, "") + mediaUrl;

  // SECURITY: Never send API key for media downloads
  // Media files should be publicly accessible
  // Note: leadCMSApiKey parameter kept for backward compatibility but not used

  try {
    const res = await axios.get(fullUrl, {
      responseType: "arraybuffer",
      validateStatus: (status) =>
        (status >= 200 && status < 300) || status === 404,
    });

    if (res.status === 404) {
      // Remove file if not found on server
      try {
        await fs.unlink(destPath);
        logger.verbose(`Deleted missing file: ${destPath}`);
      } catch { }
      return false;
    }

    await fs.writeFile(destPath, res.data);
    return true;
  } catch (err: any) {
    console.error(`Failed to download ${mediaUrl}:`, err.message);
    throw err;
  }
}

// Export types for use in other modules
export type { ContentItem };
