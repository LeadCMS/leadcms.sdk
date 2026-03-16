import fs from "fs/promises";
import path from "path";
import axios, { AxiosResponse } from "axios";
import { getConfig, type LeadCMSConfig } from "../lib/config.js";
import { logger } from "../lib/logger.js";
import { leadCMSDataService, type UserIdentity } from "../lib/data-service.js";
import type { RemoteContext } from "../lib/remote-context.js";

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
// These are `let` so that configureDataServiceForRemote() can update them
// at runtime for multi-remote setups (ESM live bindings propagate to importers).
export let leadCMSUrl = config.url;
export let leadCMSApiKey = config.apiKey;
export const defaultLanguage = config.defaultLanguage;
export const CONTENT_DIR = path.resolve(config.contentDir);
export const MEDIA_DIR = path.resolve(config.mediaDir);
export const EMAIL_TEMPLATES_DIR = path.resolve(config.emailTemplatesDir);
export const SETTINGS_DIR = path.resolve(config.settingsDir || ".leadcms/settings");

// Fetch content types dynamically from LeadCMS API to build typeMap
// Content types are automatically detected and don't need to be configured
export async function fetchContentTypes(baseUrl?: string): Promise<Record<string, string>> {
  const effectiveUrl = baseUrl || leadCMSUrl;
  logger.verbose(`[LeadCMS] Fetching content types from API...`);
  logger.verbose(`[LeadCMS] Fetching public content types (no authentication)`);
  const url = new URL("/api/content-types", effectiveUrl);
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

/**
 * Resolve the current user identity before any API operations.
 *
 * - API key set & valid   → prints "Authenticated as …", returns UserIdentity
 * - API key set & invalid → prints auth error, calls process.exit(1)
 * - No API key            → prints "Running in anonymous mode", returns null
 *
 * Call this at the start of every CLI command so the user always sees *who*
 * is making the requests.
 *
 * @param overrideApiKey  Optional API key override (e.g., from RemoteContext).
 *                        When provided, this is used instead of the module-level key.
 */
export async function resolveIdentity(overrideApiKey?: string): Promise<UserIdentity | null> {
  const effectiveApiKey = overrideApiKey ?? leadCMSApiKey;
  if (!effectiveApiKey) {
    console.log('👤 Running in anonymous mode');
    return null;
  }

  try {
    const user = await leadCMSDataService.getUserMe();
    console.log(`🔑 Authenticated as ${user.displayName} (${user.email})`);
    return user;
  } catch (error: any) {
    if (error.status === 401 || error.response?.status === 401) {
      console.error('\n❌ Authentication failed: API key is invalid or expired');
      console.error('\n💡 To fix this:');
      console.error('   • Run: leadcms login');
      console.error('   • Or update LEADCMS_API_KEY in your .env file');
      process.exit(1);
    }

    // Non-auth errors (network, server down) – warn but proceed
    console.warn(`⚠️  Could not verify identity: ${error.message}`);
    console.log('🔑 Proceeding with configured API key');
    return { displayName: 'Unknown', email: '', userName: '' };
  }
}

/**
 * Require an authenticated user. Calls resolveIdentity() and exits if
 * the user is anonymous (no API key).
 *
 * Use this for write operations (push) that cannot run anonymously.
 *
 * @param overrideApiKey  Optional API key override (e.g., from RemoteContext).
 */
export async function requireAuthenticatedUser(overrideApiKey?: string): Promise<UserIdentity> {
  const identity = await resolveIdentity(overrideApiKey);

  if (!identity) {
    console.error('\n❌ This operation requires authentication.');
    console.error('\n💡 To authenticate:');
    console.error('   • Set LEADCMS_API_KEY in your .env file');
    console.error('   • Or run: leadcms login');
    process.exit(1);
  }

  return identity;
}

/**
 * Set up the data service for a specific RemoteContext and resolve identity.
 * Use at the start of CLI commands when --remote is specified.
 */
export function configureDataServiceForRemote(ctx: RemoteContext): void {
  leadCMSDataService.configureForRemote(ctx.url, ctx.apiKey);

  // Also update module-level vars so scripts that import leadCMSUrl / leadCMSApiKey
  // directly (pull-settings, fetch-comments, fetch-email-templates, push-settings)
  // pick up the correct values via ESM live bindings.
  leadCMSUrl = ctx.url;
  leadCMSApiKey = ctx.apiKey;
}

/**
 * @deprecated Use requireAuthenticatedUser() instead – it also verifies the
 * token is valid by calling /api/users/me before proceeding.
 */
export function requireApiKeyOrExit(): void {
  if (!leadCMSApiKey) {
    console.error('\n❌ Push operations require authentication.');
    console.error('\n💡 To push changes, you need to configure an API key:');
    console.error('   • Set LEADCMS_API_KEY in your .env file');
    console.error('   • Or run: leadcms login');
    process.exit(1);
  }
}
