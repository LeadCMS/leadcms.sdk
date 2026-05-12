/**
 * Generate redirect map files from local redirects.yaml.
 *
 * Reads <redirectsDir>/redirects.yaml, resolves paths for each redirect, and
 * writes two plain map files to the output directory:
 *   - {outputDir}/301.map  — permanent redirects
 *   - {outputDir}/302.map  — temporary redirects
 *
 * Each file contains bare "from" "to" pairs (one per line):
 *   "/old-path" "/new-path"
 *   "/another"  "https://external.com"
 *
 * These files are consumed by nginx or other tools — the SDK does not embed
 * any nginx-specific wrapper syntax.
 *
 * ContentSlug and ContentId sources/targets are resolved to paths using
 * config.redirects.pathPattern (default: "/{language}/{slug}").
 * If config.languageDomains is set, the {domain} token is also resolved.
 *
 * Language filtering:
 *   - If LEADCMS_DEFAULT_LANGUAGE env var or --language flag is set, only redirects
 *     whose resolved source language matches are included for ContentSlug and ContentId.
 *   - InternalPath redirects are always included regardless of language filter.
 *
 * No remote connection is required — generation works entirely from local files.
 * ContentId resolution uses API credentials from the environment if configured.
 */

import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import yaml from "js-yaml";
import { REDIRECTS_DIR, singleLanguage } from "./leadcms-helpers.js";
import { getConfig } from "../lib/config.js";
import { leadCMSDataService } from "../lib/data-service.js";
import { logger } from "../lib/logger.js";
import type { LocalRedirect, LocalRedirectsFile, RedirectKind } from "../lib/automation-types.js";
import {
  detectSourceType,
  detectTargetType,
  redirectSurrogateKey,
  flattenRedirectsFile,
  injectDefaultLanguage,
} from "../lib/automation-types.js";

export interface GenerateRedirectsMapOptions {
  /** Override output directory path. */
  outputDir?: string;
  /** Filter redirects to this language only (for ContentSlug/ContentId). */
  language?: string;
  dryRun?: boolean;
}

interface ResolvedRedirect {
  from: string;
  to: string;
  kind: RedirectKind;
}

// ── Helpers ────────────────────────────────────────────────────────────

function getRedirectsFilePath(): string {
  return path.join(REDIRECTS_DIR, "redirects.yaml");
}

async function readLocalRedirects(): Promise<LocalRedirect[]> {
  const filePath = getRedirectsFilePath();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = yaml.load(raw) as LocalRedirectsFile | null;
    if (parsed && typeof parsed === "object") {
      const flat = flattenRedirectsFile(parsed);
      return singleLanguage ? injectDefaultLanguage(flat, singleLanguage) : flat;
    }
  } catch {
    /* file doesn't exist */
  }
  return [];
}

function applyPathPattern(
  pattern: string,
  language: string,
  slug: string,
  languageDomains?: Record<string, string>
): string {
  const domain = languageDomains && language ? (languageDomains[language] ?? "") : "";
  return pattern
    .replace("{language}", language)
    .replace("{slug}", slug)
    .replace("{domain}", domain);
}

// Content lookup cache: id → { language, slug } | null
const contentCache = new Map<number, { language: string; slug: string } | null>();

async function resolveContentId(
  contentId: number
): Promise<{ language: string; slug: string } | null> {
  if (contentCache.has(contentId)) {
    return contentCache.get(contentId)!;
  }

  try {
    const item = await leadCMSDataService.getContentById(contentId);
    if (item && item.language && item.slug) {
      const result = { language: String(item.language), slug: String(item.slug) };
      contentCache.set(contentId, result);
      return result;
    }
  } catch (_error: unknown) {
    const error = _error as Error;
    logger.verbose(
      `[generate-redirects-map] Could not resolve content #${contentId}: ${error.message}`
    );
  }

  contentCache.set(contentId, null);
  return null;
}

// ── Resolution ─────────────────────────────────────────────────────────

async function resolveFrom(
  r: LocalRedirect,
  pathPattern: string,
  languageDomains: Record<string, string> | undefined,
  filterLanguage: string | undefined
): Promise<string | null> {
  const sourceType = detectSourceType(r);

  if (sourceType === "InternalPath") {
    return r.fromPath ?? null;
  }

  if (sourceType === "ContentSlug") {
    const lang = r.fromLanguage ?? "";
    const slug = r.fromSlug ?? "";
    if (filterLanguage && lang !== filterLanguage) return null;
    return applyPathPattern(pathPattern, lang, slug, languageDomains);
  }

  if (sourceType === "ContentId") {
    if (r.fromContentId == null) return null;
    const resolved = await resolveContentId(r.fromContentId);
    if (!resolved) {
      console.warn(
        `   ⚠️  Could not resolve content #${r.fromContentId} for redirect [${redirectSurrogateKey(r)}] — skipping`
      );
      return null;
    }
    if (filterLanguage && resolved.language !== filterLanguage) return null;
    return applyPathPattern(pathPattern, resolved.language, resolved.slug, languageDomains);
  }

  return null;
}

async function resolveTo(
  r: LocalRedirect,
  pathPattern: string,
  languageDomains: Record<string, string> | undefined
): Promise<string | null> {
  const targetType = detectTargetType(r);

  if (targetType === "ExternalUrl") {
    return r.toUrl ?? null;
  }

  if (targetType === "InternalPath") {
    return r.toPath ?? null;
  }

  if (targetType === "ContentSlug") {
    const lang = r.toLanguage ?? "";
    const slug = r.toSlug ?? "";
    return applyPathPattern(pathPattern, lang, slug, languageDomains);
  }

  if (targetType === "ContentId") {
    if (r.toContentId == null) return null;
    const resolved = await resolveContentId(r.toContentId);
    if (!resolved) {
      console.warn(
        `   ⚠️  Could not resolve target content #${r.toContentId} for redirect [${redirectSurrogateKey(r)}] — skipping`
      );
      return null;
    }
    return applyPathPattern(pathPattern, resolved.language, resolved.slug, languageDomains);
  }

  return null;
}

// ── Plain map file generation ──────────────────────────────────────────

/**
 * Build the contents of a redirect map file suitable for nginx `include`.
 *
 * Each entry is a semicolon-terminated "from" "to" pair so the file can be
 * included directly inside a nginx `map` block:
 *
 *   map $request_uri $redirect_301 {
 *     default "";
 *     include /etc/nginx/redirects/301.map;
 *   }
 */
function buildMapFile(redirects: ResolvedRedirect[], kind: RedirectKind): string {
  const filtered = redirects.filter((r) => r.kind === kind);
  const statusCode = kind === "Permanent" ? 301 : 302;
  const lines: string[] = [
    `# LeadCMS ${statusCode} redirect map`,
    `# Generated: ${new Date().toISOString()}`,
  ];

  if (filtered.length > 0) {
    lines.push("");
    for (const r of filtered) {
      lines.push(`${JSON.stringify(r.from)} ${JSON.stringify(r.to)};`);
    }
  }

  return lines.join("\n") + "\n";
}

// ── Main export ────────────────────────────────────────────────────────

export async function generateRedirectsMap(
  options: GenerateRedirectsMapOptions = {}
): Promise<void> {
  const { outputDir: outputDirArg, language: languageArg, dryRun = false } = options;

  const config = getConfig();
  const pathPattern = config.redirects?.pathPattern ?? "/{language}/{slug}";
  const languageDomains = config.languageDomains;
  const filterLanguage =
    languageArg || process.env.LEADCMS_DEFAULT_LANGUAGE || config.defaultLanguage;

  const outputDir = path.resolve(outputDirArg ?? config.redirects?.outputDir ?? "redirects");
  const file301 = path.join(outputDir, "301.map");
  const file302 = path.join(outputDir, "302.map");

  const locals = await readLocalRedirects();

  if (locals.length === 0) {
    console.log("   ℹ️  No local redirects found — nothing to generate.");
    return;
  }

  logger.verbose(`[generate-redirects-map] Processing ${locals.length} redirects`);
  if (filterLanguage) {
    logger.verbose(`[generate-redirects-map] Language filter: ${filterLanguage}`);
  }

  const resolved: ResolvedRedirect[] = [];

  for (const r of locals) {
    const from = await resolveFrom(r, pathPattern, languageDomains, filterLanguage || undefined);
    if (!from) continue;

    const to = await resolveTo(r, pathPattern, languageDomains);
    if (!to) continue;

    resolved.push({ from, to, kind: r.kind });
  }

  const permanent = resolved.filter((r) => r.kind === "Permanent");
  const temporary = resolved.filter((r) => r.kind === "Temporary");

  console.log(
    `   ✅ Resolved ${resolved.length} redirect(s) (${permanent.length} permanent, ${temporary.length} temporary)`
  );

  if (dryRun) {
    console.log(`\n   🔍 Dry run — output directory would be: ${outputDir}`);
    if (permanent.length > 0) {
      console.log(`\n--- ${file301} ---\n${buildMapFile(resolved, "Permanent")}`);
    }
    if (temporary.length > 0) {
      console.log(`\n--- ${file302} ---\n${buildMapFile(resolved, "Temporary")}`);
    }
    return;
  }

  await fs.mkdir(outputDir, { recursive: true });

  const written: string[] = [];

  if (permanent.length > 0) {
    await fs.writeFile(file301, buildMapFile(resolved, "Permanent"), "utf8");
    written.push(`301.map (${permanent.length} entries)`);
  } else {
    try {
      await fs.unlink(file301);
      logger.verbose(`[generate-redirects-map] Removed stale ${file301}`);
    } catch {
      /* file didn't exist — nothing to do */
    }
  }

  if (temporary.length > 0) {
    await fs.writeFile(file302, buildMapFile(resolved, "Temporary"), "utf8");
    written.push(`302.map (${temporary.length} entries)`);
  } else {
    try {
      await fs.unlink(file302);
      logger.verbose(`[generate-redirects-map] Removed stale ${file302}`);
    } catch {
      /* file didn't exist — nothing to do */
    }
  }

  for (const w of written) {
    console.log(`   📄 Written: ${path.join(outputDir, w.split(" ")[0])}`);
  }
}
