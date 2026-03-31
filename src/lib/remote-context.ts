/**
 * Multi-remote support for LeadCMS SDK.
 *
 * Provides the concept of named remotes (similar to git remotes), each
 * representing a CMS instance with its own URL, API key, sync tokens,
 * ID mapping, and metadata.
 */

import path from "path";
import fs from "fs/promises";
import { getConfig, type LeadCMSConfig } from "./config.js";

// ── Types ──────────────────────────────────────────────────────────────

/** Configuration for a single named remote in leadcms.config.json */
export interface RemoteConfig {
  /** CMS instance URL */
  url: string;
}

/** Resolved context for a remote — everything needed to interact with it */
export interface RemoteContext {
  /** Remote name (e.g., "production", "develop", or "default" for single-remote) */
  name: string;
  /** CMS instance URL (trailing slashes stripped) */
  url: string;
  /** API key (resolved from env vars) */
  apiKey?: string;
  /** Whether this is the default remote */
  isDefault: boolean;
  /** Absolute path to remote state directory: .leadcms/remotes/{name}/ */
  stateDir: string;
}

// ── Internal constants ─────────────────────────────────────────────────

const REMOTES_BASE_DIR = ".leadcms/remotes";

// ── Resolution ─────────────────────────────────────────────────────────

/**
 * Resolve a RemoteContext from the current configuration.
 *
 * - Single-remote mode (no `remotes` in config): returns a synthetic
 *   "default" remote built from the flat `url` / `apiKey` fields.
 * - Multi-remote mode: looks up the named remote (or `defaultRemote`
 *   when `remoteName` is undefined).
 *
 * @param remoteName  Explicit remote name, e.g. from `--remote` CLI flag.
 *                    When omitted the default remote is used.
 * @param config      Optional config override (for testing). Falls back
 *                    to `getConfig()`.
 */
export function resolveRemote(
  remoteName?: string,
  config?: LeadCMSConfig,
): RemoteContext {
  const cfg = config ?? getConfig();

  // ── Single-remote mode ───────────────────────────────────────────
  if (!cfg.remotes || Object.keys(cfg.remotes).length === 0) {
    if (remoteName && remoteName !== "default") {
      throw new Error(
        `Remote "${remoteName}" is not configured. ` +
        `Add a "remotes" block to your leadcms config file to use named remotes.`,
      );
    }
    return {
      name: "default",
      url: (cfg.url || "").replace(/\/+$/, ""),
      apiKey: cfg.apiKey ?? resolveApiKeyFromEnv("default"),
      isDefault: true,
      stateDir: path.resolve(REMOTES_BASE_DIR, "default"),
    };
  }

  // ── Multi-remote mode ────────────────────────────────────────────
  // Resolution priority (when remoteName not explicitly provided):
  // 1. remoteName argument (from --remote CLI flag)
  // 2. LEADCMS_REMOTE env var
  // 3. URL match: LEADCMS_URL / NEXT_PUBLIC_LEADCMS_URL against configured remotes
  // 4. defaultRemote from config
  const name = remoteName
    ?? process.env.LEADCMS_REMOTE
    ?? resolveRemoteByUrl(cfg)
    ?? cfg.defaultRemote;
  if (!name) {
    throw new Error(
      `No remote specified and no "defaultRemote" configured. ` +
      `Either pass --remote <name> or set "defaultRemote" in your config.`,
    );
  }

  const remote = cfg.remotes[name];
  if (!remote) {
    const available = Object.keys(cfg.remotes).join(", ");
    throw new Error(
      `Remote "${name}" is not configured. Available remotes: ${available}`,
    );
  }

  const isDefault = name === cfg.defaultRemote;

  return {
    name,
    url: (remote.url || "").replace(/\/+$/, ""),
    apiKey: resolveApiKeyFromEnv(name),
    isDefault,
    stateDir: path.resolve(REMOTES_BASE_DIR, name),
  };
}

/**
 * List all configured remotes. Returns an empty array in single-remote mode.
 */
export function listRemotes(config?: LeadCMSConfig): RemoteContext[] {
  const cfg = config ?? getConfig();

  if (!cfg.remotes || Object.keys(cfg.remotes).length === 0) {
    // Single-remote mode — return the implicit default
    return [resolveRemote(undefined, cfg)];
  }

  return Object.keys(cfg.remotes).map((name) => resolveRemote(name, cfg));
}

// ── API key resolution ────────────────────────────────────────────────

/**
 * Find a remote whose URL matches LEADCMS_URL or NEXT_PUBLIC_LEADCMS_URL.
 * Returns the matching remote name, or undefined if no match.
 */
function resolveRemoteByUrl(cfg: LeadCMSConfig): string | undefined {
  const envUrl = (process.env.LEADCMS_URL || process.env.NEXT_PUBLIC_LEADCMS_URL || '').replace(/\/+$/, '');
  if (!envUrl || !cfg.remotes) return undefined;

  for (const [name, remote] of Object.entries(cfg.remotes)) {
    if ((remote.url || '').replace(/\/+$/, '') === envUrl) {
      return name;
    }
  }
  return undefined;
}

/**
 * Resolve the API key for a remote from environment variables.
 *
 * Resolution order:
 * 1. `LEADCMS_REMOTE_{NAME}_API_KEY` (remote-specific)
 * 2. `LEADCMS_API_KEY` (generic fallback for any remote)
 *
 * NOTE: NEXT_PUBLIC_* prefixed keys are intentionally NOT checked here.
 * API keys must never be exposed to the browser via NEXT_PUBLIC_.
 */
function resolveApiKeyFromEnv(
  remoteName: string,
): string | undefined {
  const envName = remoteName.toUpperCase().replace(/-/g, "_");
  const remoteSpecific = process.env[`LEADCMS_REMOTE_${envName}_API_KEY`];
  if (remoteSpecific) return remoteSpecific;

  return process.env.LEADCMS_API_KEY;
}

// ── Path helpers ──────────────────────────────────────────────────────

/** Absolute path to a sync token file for a given remote + entity type. */
export function syncTokenPath(
  ctx: RemoteContext,
  entityType: "content" | "media" | "comments" | "email-templates" | "segments" | "sequences",
): string {
  return path.join(ctx.stateDir, `${entityType}-sync-token`);
}

/** Absolute path to the metadata.json for a given remote. */
export function metadataMapPath(ctx: RemoteContext): string {
  return path.join(ctx.stateDir, "metadata.json");
}

/**
 * Build a canonical content key used for display / logging.
 * Format: `{language}/{slug}`
 */
export function contentKey(language: string, slug: string): string {
  return `${language}/${slug}`;
}

/**
 * Build a canonical email template key used for display / logging.
 * Format: `{language}/{name}`
 */
export function emailTemplateKey(language: string, name: string): string {
  return `${language}/${name}`;
}

/**
 * Build a canonical comment key used for display / logging.
 * Format: `{language}/{translationKey}`
 */
export function commentKey(language: string, translationKey: string): string {
  return `${language}/${translationKey}`;
}

/**
 * Remove other entries in a nested `section` that already claim the given `id`.
 * Called by setRemoteId / setEmailTemplateRemoteId to enforce 1-to-1
 * mapping between keys and IDs.
 */
function deduplicateSection(
  section: Record<string, Record<string, MetadataEntry>>,
  incomingLang: string,
  incomingSlug: string,
  id: number | string,
): void {
  for (const [lang, slugs] of Object.entries(section)) {
    for (const [slug, entry] of Object.entries(slugs)) {
      if ((lang !== incomingLang || slug !== incomingSlug) && entry.id != null && String(entry.id) === String(id)) {
        delete slugs[slug];
      }
    }
    if (Object.keys(slugs).length === 0) {
      delete section[lang];
    }
  }
}

/**
 * Deduplicate a nested section on read: if multiple keys map to the same
 * ID, keep only the last one (file order) and drop earlier duplicates.
 */
function deduplicateSectionOnRead(section: Record<string, Record<string, MetadataEntry>>): void {
  // id → { lang, slug } (last wins)
  const seen = new Map<string, { lang: string; slug: string }>();
  for (const [lang, slugs] of Object.entries(section)) {
    for (const [slug, entry] of Object.entries(slugs)) {
      if (entry.id != null) {
        seen.set(String(entry.id), { lang, slug });
      }
    }
  }
  // Remove entries that are not the winner for their ID
  for (const [lang, slugs] of Object.entries(section)) {
    for (const [slug, entry] of Object.entries(slugs)) {
      if (entry.id == null) continue;
      const winner = seen.get(String(entry.id));
      if (winner && (winner.lang !== lang || winner.slug !== slug)) {
        delete slugs[slug];
      }
    }
    if (Object.keys(slugs).length === 0) {
      delete section[lang];
    }
  }
}

/**
 * Sort a nested map: language keys sorted alphabetically,
 * and slugs within each language sorted alphabetically.
 */
function sortNestedMap<T>(map: Record<string, Record<string, T>>): Record<string, Record<string, T>> {
  const sorted: Record<string, Record<string, T>> = {};
  for (const lang of Object.keys(map).sort()) {
    sorted[lang] = {};
    for (const slug of Object.keys(map[lang]).sort()) {
      sorted[lang][slug] = map[lang][slug];
    }
  }
  return sorted;
}

/**
 * Sort a flat map: keys sorted alphabetically.
 */
function sortFlatMap<T>(map: Record<string, T>): Record<string, T> {
  const sorted: Record<string, T> = {};
  for (const key of Object.keys(map).sort()) {
    sorted[key] = map[key];
  }
  return sorted;
}

/** Look up the remote ID for a content item. */
export function lookupRemoteId(
  map: MetadataMap,
  language: string,
  slug: string,
): number | string | undefined {
  return map.content[language]?.[slug]?.id;
}

/** Set the remote ID for a content item.
 *  Enforces uniqueness: if another key already maps to the same ID,
 *  that stale mapping is removed so only one key owns each ID.
 */
export function setRemoteId(
  map: MetadataMap,
  language: string,
  slug: string,
  id: number | string,
): void {
  deduplicateSection(map.content, language, slug, id);
  if (!map.content[language]) map.content[language] = {};
  const current = map.content[language][slug] || {};
  map.content[language][slug] = { ...current, id };
}

/**
 * Reverse-lookup: find the content entry (language + slug) that owns a given
 * remote ID.  Returns undefined when the ID is not tracked in the map.
 */
/**
 * Generic reverse-lookup: given an ID, find which key owns it in a nested
 * metadata section (language → key → entry).
 * Used by content (slug), emailTemplates (name), sequences (name).
 */
export function findInNestedMetadataSection(
  section: Record<string, Record<string, MetadataEntry>> | undefined,
  id: number | string,
): { language: string; key: string } | undefined {
  if (!section) return undefined;
  const idStr = String(id);
  for (const [lang, entries] of Object.entries(section)) {
    for (const [key, entry] of Object.entries(entries)) {
      if (entry.id != null && String(entry.id) === idStr) {
        return { language: lang, key };
      }
    }
  }
  return undefined;
}

/**
 * Generic reverse-lookup: given an ID, find which key owns it in a flat
 * metadata section (key → entry).
 * Used by segments.
 */
export function findInFlatMetadataSection(
  section: Record<string, MetadataEntry> | undefined,
  id: number | string,
): { key: string } | undefined {
  if (!section) return undefined;
  const idStr = String(id);
  for (const [key, entry] of Object.entries(section)) {
    if (entry.id != null && String(entry.id) === idStr) {
      return { key };
    }
  }
  return undefined;
}

/** Reverse-lookup: find the content slug + language that owns a remote ID. */
export function findContentByRemoteId(
  map: MetadataMap,
  id: number | string,
): { language: string; slug: string } | undefined {
  const result = findInNestedMetadataSection(map.content, id);
  return result ? { language: result.language, slug: result.key } : undefined;
}

/** Reverse-lookup: find the email template name + language that owns a remote ID. */
export function findEmailTemplateByRemoteId(
  map: MetadataMap,
  id: number | string,
): { language: string; name: string } | undefined {
  const result = findInNestedMetadataSection(map.emailTemplates, id);
  return result ? { language: result.language, name: result.key } : undefined;
}

/** Reverse-lookup: find the segment name that owns a remote ID. */
export function findSegmentByRemoteId(
  map: MetadataMap,
  id: number | string,
): { name: string } | undefined {
  const result = findInFlatMetadataSection(map.segments, id);
  return result ? { name: result.key } : undefined;
}

/** Reverse-lookup: find the sequence name + language that owns a remote ID. */
export function findSequenceByRemoteId(
  map: MetadataMap,
  id: number | string,
): { language: string; name: string } | undefined {
  const result = findInNestedMetadataSection(map.sequences, id);
  return result ? { language: result.language, name: result.key } : undefined;
}

/** Look up the remote ID for an email template. */
export function lookupEmailTemplateRemoteId(
  map: MetadataMap,
  language: string,
  name: string,
): number | string | undefined {
  return map.emailTemplates?.[language]?.[name]?.id;
}

/** Set the remote ID for an email template.
 *  Enforces uniqueness: if another key already maps to the same ID,
 *  that stale mapping is removed so only one key owns each ID.
 */
export function setEmailTemplateRemoteId(
  map: MetadataMap,
  language: string,
  name: string,
  id: number | string,
): void {
  if (!map.emailTemplates) map.emailTemplates = {};
  deduplicateSection(map.emailTemplates, language, name, id);
  if (!map.emailTemplates[language]) map.emailTemplates[language] = {};
  const current = map.emailTemplates[language][name] || {};
  map.emailTemplates[language][name] = { ...current, id };
}

// ── Metadata Map ──────────────────────────────────────────────────────

/** Timestamps stored per content item per remote. */
export interface MetadataEntry {
  id?: number | string;
  createdAt?: string;
  updatedAt?: string;
}

/** Structure of .leadcms/remotes/{name}/metadata.json */
export interface MetadataMap {
  content: Record<string, Record<string, MetadataEntry>>;
  emailTemplates?: Record<string, Record<string, MetadataEntry>>;
  comments?: Record<string, Record<string, MetadataEntry>>;
  segments?: Record<string, MetadataEntry>;
  sequences?: Record<string, Record<string, MetadataEntry>>;
}

/** Read the metadata-map for a remote. Returns empty map if file doesn't exist. */
export async function readMetadataMap(ctx: RemoteContext): Promise<MetadataMap> {
  try {
    const data = await fs.readFile(metadataMapPath(ctx), "utf-8");
    const parsed = JSON.parse(data);
    if (!parsed.content) parsed.content = {};
    if (!parsed.emailTemplates) parsed.emailTemplates = {};
    if (!parsed.comments) parsed.comments = {};
    if (!parsed.segments) parsed.segments = {};
    if (!parsed.sequences) parsed.sequences = {};
    // Migrate old flat sequences format to nested (language → name)
    migrateSequencesFormat(parsed);
    deduplicateSectionOnRead(parsed.content);
    deduplicateSectionOnRead(parsed.emailTemplates);
    deduplicateSectionOnRead(parsed.comments);
    deduplicateSectionOnRead(parsed.sequences!);
    return parsed;
  } catch {
    return { content: {}, emailTemplates: {}, comments: {}, segments: {}, sequences: {} };
  }
}

/** Write the metadata-map for a remote, creating the directory if needed.
 *  Keys are sorted alphabetically for consistency across regenerations.
 */
export async function writeMetadataMap(
  ctx: RemoteContext,
  map: MetadataMap,
): Promise<void> {
  await fs.mkdir(ctx.stateDir, { recursive: true });
  const sorted: MetadataMap = {
    content: sortNestedMap(map.content),
    ...(map.emailTemplates && Object.keys(map.emailTemplates).length > 0
      ? { emailTemplates: sortNestedMap(map.emailTemplates) }
      : {}),
    ...(map.comments && Object.keys(map.comments).length > 0
      ? { comments: sortNestedMap(map.comments) }
      : {}),
    ...(map.segments && Object.keys(map.segments).length > 0
      ? { segments: sortFlatMap(map.segments) }
      : {}),
    ...(map.sequences && Object.keys(map.sequences).length > 0
      ? { sequences: sortNestedMap(map.sequences) }
      : {}),
  };
  await fs.writeFile(
    metadataMapPath(ctx),
    JSON.stringify(sorted, null, 2),
    "utf-8",
  );
}

/** Get metadata for a content item from the map. */
export function getMetadataForContent(
  map: MetadataMap,
  language: string,
  slug: string,
): MetadataEntry | undefined {
  return map.content[language]?.[slug];
}

function stripNulls(entry: MetadataEntry): MetadataEntry {
  const result: MetadataEntry = {};
  if (entry.id != null) result.id = entry.id;
  if (entry.createdAt != null) result.createdAt = entry.createdAt;
  if (entry.updatedAt != null) result.updatedAt = entry.updatedAt;
  return result;
}

/** Set metadata for a content item in the map. */
export function setMetadataForContent(
  map: MetadataMap,
  language: string,
  slug: string,
  entry: MetadataEntry,
): void {
  if (!map.content[language]) map.content[language] = {};
  const current = map.content[language][slug] || {};
  map.content[language][slug] = { ...current, ...stripNulls(entry) };
}

/** Get metadata for an email template from the map. */
export function getMetadataForEmailTemplate(
  map: MetadataMap,
  language: string,
  name: string,
): MetadataEntry | undefined {
  return map.emailTemplates?.[language]?.[name];
}

/** Set metadata for an email template in the map. */
export function setMetadataForEmailTemplate(
  map: MetadataMap,
  language: string,
  name: string,
  entry: MetadataEntry,
): void {
  if (!map.emailTemplates) map.emailTemplates = {};
  if (!map.emailTemplates[language]) map.emailTemplates[language] = {};
  const current = map.emailTemplates[language][name] || {};
  map.emailTemplates[language][name] = { ...current, ...stripNulls(entry) };
}

// ── Comment helpers ───────────────────────────────────────────────────

/** Look up the remote ID for a comment by language + translationKey. */
export function lookupCommentRemoteId(
  map: MetadataMap,
  language: string,
  translationKey: string,
): number | string | undefined {
  return map.comments?.[language]?.[translationKey]?.id;
}

/** Set the remote ID for a comment (language + translationKey).
 *  Enforces uniqueness across the comments section.
 */
export function setCommentRemoteId(
  map: MetadataMap,
  language: string,
  translationKey: string,
  id: number | string,
): void {
  if (!map.comments) map.comments = {};
  deduplicateSection(map.comments, language, translationKey, id);
  if (!map.comments[language]) map.comments[language] = {};
  const current = map.comments[language][translationKey] || {};
  map.comments[language][translationKey] = { ...current, id };
}

/** Get metadata for a comment from the map. */
export function getMetadataForComment(
  map: MetadataMap,
  language: string,
  translationKey: string,
): MetadataEntry | undefined {
  return map.comments?.[language]?.[translationKey];
}

/** Set metadata for a comment in the map. */
export function setMetadataForComment(
  map: MetadataMap,
  language: string,
  translationKey: string,
  entry: MetadataEntry,
): void {
  if (!map.comments) map.comments = {};
  if (!map.comments[language]) map.comments[language] = {};
  const current = map.comments[language][translationKey] || {};
  map.comments[language][translationKey] = { ...current, ...stripNulls(entry) };
}

// ── Segment helpers ───────────────────────────────────────────────────

/**
 * Deduplicate a flat section (segments, sequences) on read:
 * if multiple keys map to the same ID, keep only the last one.
 */
function deduplicateFlatSectionOnRead(section: Record<string, MetadataEntry>): void {
  const seen = new Map<string, string>();
  for (const [key, entry] of Object.entries(section)) {
    if (entry.id != null) {
      seen.set(String(entry.id), key);
    }
  }
  for (const [key, entry] of Object.entries(section)) {
    if (entry.id == null) continue;
    const winner = seen.get(String(entry.id));
    if (winner && winner !== key) {
      delete section[key];
    }
  }
}

/**
 * Remove other entries in a flat section that already claim the given ID.
 */
function deduplicateFlatSection(
  section: Record<string, MetadataEntry>,
  incomingKey: string,
  id: number | string,
): void {
  for (const [key, entry] of Object.entries(section)) {
    if (key !== incomingKey && entry.id != null && String(entry.id) === String(id)) {
      delete section[key];
    }
  }
}

/** Look up the remote ID for a segment by name. */
export function lookupSegmentRemoteId(
  map: MetadataMap,
  name: string,
): number | string | undefined {
  return map.segments?.[name]?.id;
}

/** Set the remote ID for a segment (keyed by name). */
export function setSegmentRemoteId(
  map: MetadataMap,
  name: string,
  id: number | string,
): void {
  if (!map.segments) map.segments = {};
  deduplicateFlatSection(map.segments, name, id);
  const current = map.segments[name] || {};
  map.segments[name] = { ...current, id };
}

/** Get metadata for a segment from the map. */
export function getMetadataForSegment(
  map: MetadataMap,
  name: string,
): MetadataEntry | undefined {
  return map.segments?.[name];
}

/** Set metadata for a segment in the map. */
export function setMetadataForSegment(
  map: MetadataMap,
  name: string,
  entry: MetadataEntry,
): void {
  if (!map.segments) map.segments = {};
  const current = map.segments[name] || {};
  map.segments[name] = { ...current, ...stripNulls(entry) };
}

// ── Sequence helpers ──────────────────────────────────────────────────

/** Look up the remote ID for a sequence by language + name. */
export function lookupSequenceRemoteId(
  map: MetadataMap,
  language: string,
  name: string,
): number | string | undefined {
  return map.sequences?.[language]?.[name]?.id;
}

/** Set the remote ID for a sequence (keyed by language + name).
 *  Enforces uniqueness: if another key already maps to the same ID,
 *  that stale mapping is removed so only one key owns each ID.
 */
export function setSequenceRemoteId(
  map: MetadataMap,
  language: string,
  name: string,
  id: number | string,
): void {
  if (!map.sequences) map.sequences = {};
  deduplicateSection(map.sequences, language, name, id);
  if (!map.sequences[language]) map.sequences[language] = {};
  const current = map.sequences[language][name] || {};
  map.sequences[language][name] = { ...current, id };
}

/** Get metadata for a sequence from the map. */
export function getMetadataForSequence(
  map: MetadataMap,
  language: string,
  name: string,
): MetadataEntry | undefined {
  return map.sequences?.[language]?.[name];
}

/** Set metadata for a sequence in the map. */
export function setMetadataForSequence(
  map: MetadataMap,
  language: string,
  name: string,
  entry: MetadataEntry,
): void {
  if (!map.sequences) map.sequences = {};
  if (!map.sequences[language]) map.sequences[language] = {};
  const current = map.sequences[language][name] || {};
  map.sequences[language][name] = { ...current, ...stripNulls(entry) };
}

/**
 * Migrate old flat sequences format (Record<string, MetadataEntry>)
 * to nested format (Record<string, Record<string, MetadataEntry>>).
 * Old format had sequence names directly as keys; new format nests under language.
 * Unknown-language entries are placed under "_migrated" until next pull.
 */
function migrateSequencesFormat(parsed: MetadataMap): void {
  if (!parsed.sequences || typeof parsed.sequences !== 'object') return;
  // Check if any first-level value is a MetadataEntry (has 'id' directly)
  const entries = Object.entries(parsed.sequences);
  const needsMigration = entries.some(
    ([, val]) => val != null && typeof val === 'object' && 'id' in val && !isNestedRecord(val),
  );
  if (!needsMigration) return;

  const migrated: Record<string, Record<string, MetadataEntry>> = {};
  for (const [key, val] of entries) {
    if (val != null && typeof val === 'object' && 'id' in val && !isNestedRecord(val)) {
      // Old flat entry — move under "_migrated" language bucket
      if (!migrated['_migrated']) migrated['_migrated'] = {};
      migrated['_migrated'][key] = val as MetadataEntry;
    } else {
      // Already nested entry — keep as-is
      migrated[key] = val as Record<string, MetadataEntry>;
    }
  }
  parsed.sequences = migrated;
}

/** Check if a value looks like a nested record (has sub-objects, not a MetadataEntry). */
function isNestedRecord(val: any): boolean {
  if (typeof val !== 'object' || val === null) return false;
  // MetadataEntry has id/createdAt/updatedAt string/number fields
  // Nested record has sub-objects as values
  return Object.values(val).some(v => typeof v === 'object' && v !== null);
}
