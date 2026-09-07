/**
 * Multi-site support for LeadCMS SDK.
 *
 * A named site owns its content and entity trees, its media directory, its
 * default language, its remotes and the sync state of those remotes. Sites and
 * remotes are orthogonal axes:
 *
 *   - a site answers "which content?"  (--site / LEADCMS_SITE / defaultSite)
 *   - a remote answers "which instance of that site?" (--remote / LEADCMS_REMOTE)
 *
 * Without a `sites` block in the config file the SDK runs in single-site mode:
 * one implicit site named "default" whose root is `.leadcms`, which yields the
 * same paths as before sites existed.
 *
 * This module contains the pure resolution rules. `config.ts` applies them
 * while building the effective configuration; `getActiveSite()` and friends
 * read back the result.
 */

import path from "path";
import { loadRawConfigFile, resolveEffectiveConfig, type LeadCMSConfig } from "./config.js";
import type { RemoteConfig } from "./remote-context.js";

// ── Constants ──────────────────────────────────────────────────────────

/** Name of the implicit site used when no `sites` block is configured. */
export const DEFAULT_SITE_NAME = "default";

/** Root of the implicit site; expands to today's default directory layout. */
export const DEFAULT_SITE_ROOT = ".leadcms";

/** Same rule as remote names. */
export const SITE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** Directory keys derived from a site's `root`. */
export const SITE_DIR_KEYS = [
  "contentDir",
  "commentsDir",
  "emailTemplatesDir",
  "settingsDir",
  "segmentsDir",
  "sequencesDir",
  "redirectsDir",
] as const;

export type SiteDirKey = (typeof SITE_DIR_KEYS)[number];

const ROOT_EXPANSION: Record<SiteDirKey, string> = {
  contentDir: "content",
  commentsDir: "comments",
  emailTemplatesDir: "email-templates",
  settingsDir: "settings",
  segmentsDir: "segments",
  sequencesDir: "sequences",
  redirectsDir: "redirects",
};

/** Keys a site may set. Anything else inside a site entry is rejected. */
const SITE_KEYS = new Set<string>([
  "root",
  "defaultLanguage",
  ...SITE_DIR_KEYS,
  "mediaDir",
  "languageDomains",
  "redirects",
  "enableDrafts",
  "remotes",
  "defaultRemote",
]);

/** Top-level keys that belong to a site once a `sites` block exists. */
const TOP_LEVEL_KEYS_MOVED_INTO_SITES = ["url", "remotes", "defaultRemote"] as const;

// ── Types ──────────────────────────────────────────────────────────────

/** One named site in leadcms.config.json */
export interface SiteConfig {
  /** Base for the entity directories and remote state. Default: ".leadcms" */
  root?: string;
  defaultLanguage?: string;
  contentDir?: string;
  commentsDir?: string;
  /** Not derived from `root`; inherits the top-level value (`public/media`) */
  mediaDir?: string;
  emailTemplatesDir?: string;
  settingsDir?: string;
  segmentsDir?: string;
  sequencesDir?: string;
  redirectsDir?: string;
  languageDomains?: Record<string, string>;
  redirects?: LeadCMSConfig["redirects"];
  enableDrafts?: boolean;
  /** Not inherited: a site's instances are its own */
  remotes?: Record<string, RemoteConfig>;
  /** Required when `remotes` is set */
  defaultRemote?: string;
}

/** Shape of the raw leadcms.config.json file */
export interface LeadCMSConfigFile extends Partial<
  Omit<LeadCMSConfig, "site" | "sites" | "defaultSite">
> {
  sites?: Record<string, SiteConfig>;
  defaultSite?: string;
}

/** Resolved site: everything needed to locate its trees and its remote state */
export interface SiteContext {
  /** Site name; "default" in single-site mode */
  name: string;
  /** Whether this is the default site (always true in single-site mode) */
  isDefault: boolean;
  /** Absolute site root */
  root: string;
  defaultLanguage: string;
  languageDomains?: Record<string, string>;
  /** Absolute paths, after root expansion, per-site keys and env overrides */
  contentDir: string;
  commentsDir: string;
  mediaDir: string;
  emailTemplatesDir: string;
  settingsDir: string;
  segmentsDir: string;
  sequencesDir: string;
  redirectsDir: string;
  /** Absolute path under which every remote keeps its state: `{root}/remotes` */
  stateBaseDir: string;
  /** The site's remotes; empty in single-remote mode */
  remotes: Record<string, RemoteConfig>;
  defaultRemote?: string;
}

export interface SiteValidationResult {
  errors: string[];
  warnings: string[];
}

// ── Pure helpers ───────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether the config file declares named sites. */
export function hasSitesBlock(file: LeadCMSConfigFile | undefined | null): boolean {
  return !!file && isPlainObject(file.sites) && Object.keys(file.sites).length > 0;
}

/** Expand a site root into the seven entity directories. */
export function expandSiteRoot(root: string): Record<SiteDirKey, string> {
  const expanded = {} as Record<SiteDirKey, string>;
  for (const key of SITE_DIR_KEYS) {
    expanded[key] = path.join(root, ROOT_EXPANSION[key]);
  }
  return expanded;
}

/** The site that is used when nothing selects one. */
export function implicitDefaultSiteName(file: LeadCMSConfigFile): string | undefined {
  if (!hasSitesBlock(file)) return DEFAULT_SITE_NAME;
  if (file.defaultSite) return file.defaultSite;
  const names = Object.keys(file.sites!);
  return names.length === 1 ? names[0] : undefined;
}

/**
 * Pick the active site name.
 *
 * `requested` is whatever the caller already resolved from `--site`,
 * `configure({ site })` or `LEADCMS_SITE`. Throws when the name does not
 * exist, or when a name is given to a project without a `sites` block: a
 * stale variable naming a site that does not exist must fail loudly rather
 * than select nothing.
 */
export function selectSiteName(file: LeadCMSConfigFile, requested?: string): string {
  if (!hasSitesBlock(file)) {
    if (requested && requested !== DEFAULT_SITE_NAME) {
      throw new Error(
        `Site "${requested}" is not configured. ` +
          `Add a "sites" block to your leadcms config file to use named sites.`
      );
    }
    return DEFAULT_SITE_NAME;
  }

  const names = Object.keys(file.sites!);
  if (requested) {
    if (!file.sites![requested]) {
      throw new Error(
        `Site "${requested}" is not configured. Available sites: ${names.join(", ")}`
      );
    }
    return requested;
  }

  const implicit = implicitDefaultSiteName(file);
  if (!implicit) {
    throw new Error(
      `"sites" is configured but "defaultSite" is not set. ` +
        `Either pass --site <name> or set "defaultSite" in your config. Available sites: ${names.join(", ")}`
    );
  }
  return implicit;
}

/**
 * Structural validation of the `sites` block. Runs whenever a configuration
 * is built, including for local-only commands, because none of these rules
 * depend on a remote being reachable and all of them would otherwise surface
 * as an empty pull or a watcher on the wrong tree.
 */
export function validateSitesBlock(file: LeadCMSConfigFile): SiteValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isPlainObject(file.sites)) {
    errors.push(`"sites" must be an object mapping site names to site settings`);
    return { errors, warnings };
  }

  const sites = file.sites as Record<string, unknown>;
  const names = Object.keys(sites);
  if (names.length === 0) {
    errors.push(`"sites" is configured but contains no sites`);
    return { errors, warnings };
  }

  for (const key of TOP_LEVEL_KEYS_MOVED_INTO_SITES) {
    if (file[key] !== undefined) {
      errors.push(
        `Top-level "${key}" is not allowed when "sites" is configured: move it into the site that owns it`
      );
    }
  }

  for (const key of SITE_DIR_KEYS) {
    if (file[key] !== undefined) {
      warnings.push(
        `Top-level "${key}" is ignored when "sites" is configured: each site derives it from its "root" (set "${key}" inside the site to override)`
      );
    }
  }

  if (file.defaultSite !== undefined) {
    if (typeof file.defaultSite !== "string" || !sites[file.defaultSite]) {
      errors.push(
        `"defaultSite" references "${String(file.defaultSite)}" but no such site is configured`
      );
    }
  } else if (names.length > 1) {
    errors.push(
      `"sites" is configured with ${names.length} sites but "defaultSite" is not set. Add "defaultSite" to your config.`
    );
  }

  const resolvedDirs: Array<{
    name: string;
    contentDir: string;
    mediaDir: string;
    stateBaseDir: string;
    remoteUrls: string[];
  }> = [];

  for (const name of names) {
    const site = sites[name];
    if (!SITE_NAME_PATTERN.test(name)) {
      errors.push(
        `Invalid site name "${name}": must be lowercase alphanumeric with hyphens, starting with a letter or digit`
      );
    }
    if (name === DEFAULT_SITE_NAME) {
      errors.push(`Site name "${DEFAULT_SITE_NAME}" is reserved for single-site mode`);
    }
    if (!isPlainObject(site)) {
      errors.push(`Site "${name}" must be an object`);
      continue;
    }

    for (const key of Object.keys(site)) {
      if (key === "url") {
        errors.push(`Site "${name}": "url" is not a site key; configure "remotes" instead`);
      } else if (!SITE_KEYS.has(key) && !key.startsWith("_")) {
        errors.push(`Site "${name}": unknown key "${key}"`);
      }
    }

    const cfg = site as SiteConfig;
    if (cfg.root !== undefined && typeof cfg.root !== "string") {
      errors.push(`Site "${name}": "root" must be a string`);
    }
    if (cfg.remotes !== undefined) {
      if (!isPlainObject(cfg.remotes)) {
        errors.push(`Site "${name}": "remotes" must be an object`);
      } else if (Object.keys(cfg.remotes).length > 0 && !cfg.defaultRemote) {
        errors.push(
          `Site "${name}": "remotes" is configured but "defaultRemote" is not set. Add "defaultRemote" to the site.`
        );
      } else if (cfg.defaultRemote && !cfg.remotes[cfg.defaultRemote]) {
        errors.push(
          `Site "${name}": "defaultRemote" references "${cfg.defaultRemote}" but no such remote is configured`
        );
      }
    }

    const root = typeof cfg.root === "string" ? cfg.root : DEFAULT_SITE_ROOT;
    resolvedDirs.push({
      name,
      contentDir: path.resolve(cfg.contentDir ?? path.join(root, ROOT_EXPANSION.contentDir)),
      mediaDir: path.resolve(cfg.mediaDir ?? file.mediaDir ?? "public/media"),
      stateBaseDir: path.resolve(root, "remotes"),
      remoteUrls: isPlainObject(cfg.remotes)
        ? Object.values(cfg.remotes)
            .map((r) => (r && typeof r.url === "string" ? r.url.replace(/\/+$/, "") : ""))
            .filter(Boolean)
        : [],
    });
  }

  // No two sites may share a tree or a state directory.
  const checkUnique = (
    label: string,
    pick: (entry: (typeof resolvedDirs)[number]) => string
  ): void => {
    const seen = new Map<string, string>();
    for (const entry of resolvedDirs) {
      const value = pick(entry);
      const owner = seen.get(value);
      if (owner) {
        errors.push(
          `Sites "${owner}" and "${entry.name}" resolve to the same ${label} (${value}); each site needs its own`
        );
      } else {
        seen.set(value, entry.name);
      }
    }
  };
  checkUnique("contentDir", (e) => e.contentDir);
  checkUnique("mediaDir", (e) => e.mediaDir);
  checkUnique("remote state directory", (e) => e.stateBaseDir);

  // Two sites on one instance is allowed but almost always a mistake.
  const urlOwners = new Map<string, string[]>();
  for (const entry of resolvedDirs) {
    for (const url of new Set(entry.remoteUrls)) {
      urlOwners.set(url, [...(urlOwners.get(url) ?? []), entry.name]);
    }
  }
  for (const [url, owners] of urlOwners) {
    if (owners.length > 1) {
      warnings.push(
        `Sites ${owners.map((o) => `"${o}"`).join(" and ")} both have a remote at ${url}: a push from either overwrites the other's changes on that instance`
      );
    }
  }

  return { errors, warnings };
}

/**
 * Base directory for remote state, derived from the effective config.
 * `{root}/remotes` for a named site; `.leadcms/remotes` otherwise, byte for
 * byte the pre-multi-site path.
 */
export function siteStateBaseDir(
  cfg: Pick<LeadCMSConfig, "site" | "sites"> | undefined | null
): string {
  const site = cfg?.site && cfg.sites ? cfg.sites[cfg.site] : undefined;
  const root = site && typeof site.root === "string" ? site.root : DEFAULT_SITE_ROOT;
  return path.resolve(root, "remotes");
}

/** Build a SiteContext from an effective (already merged) configuration. */
export function siteContextFromConfig(cfg: LeadCMSConfig): SiteContext {
  const name = cfg.site ?? DEFAULT_SITE_NAME;
  const multiSite = !!cfg.sites && Object.keys(cfg.sites).length > 0;
  const siteCfg = multiSite ? cfg.sites![name] : undefined;
  const root = path.resolve(
    siteCfg && typeof siteCfg.root === "string" ? siteCfg.root : DEFAULT_SITE_ROOT
  );

  let isDefault = true;
  if (multiSite) {
    const names = Object.keys(cfg.sites!);
    const defaultName = cfg.defaultSite ?? (names.length === 1 ? names[0] : undefined);
    isDefault = name === defaultName;
  }

  return {
    name,
    isDefault,
    root,
    defaultLanguage: cfg.defaultLanguage,
    languageDomains: cfg.languageDomains,
    contentDir: path.resolve(cfg.contentDir),
    commentsDir: path.resolve(cfg.commentsDir),
    mediaDir: path.resolve(cfg.mediaDir),
    emailTemplatesDir: path.resolve(cfg.emailTemplatesDir),
    settingsDir: path.resolve(cfg.settingsDir),
    segmentsDir: path.resolve(cfg.segmentsDir),
    sequencesDir: path.resolve(cfg.sequencesDir),
    redirectsDir: path.resolve(cfg.redirectsDir),
    stateBaseDir: path.join(root, "remotes"),
    remotes: cfg.remotes ?? {},
    defaultRemote: cfg.defaultRemote,
  };
}

// ── Resolution against the project configuration ───────────────────────

/**
 * Resolve a site to its effective context.
 *
 * @param siteName  Explicit site name, e.g. from `--site`. Beats
 *                  `configure({ site })`, `LEADCMS_SITE` and `defaultSite`.
 *                  When omitted the active site is resolved.
 * @param file      Raw config file contents to use instead of reading
 *                  `leadcms.config.json` (tests).
 *
 * Environment overrides (`LEADCMS_CONTENT_DIR`, …) are applied, so the
 * returned directories are the ones a command run against this site would use.
 */
export function resolveSite(siteName?: string, file?: LeadCMSConfigFile): SiteContext {
  return siteContextFromConfig(resolveEffectiveConfig({ site: siteName, file }));
}

/**
 * All configured sites. A single-element array holding the implicit
 * "default" site in single-site mode.
 *
 * Listing is file-based: `LEADCMS_*` directory overrides describe the active
 * site only, so they are not applied here. Use `getActiveSite()` for the
 * effective context of the site a command is running against.
 */
export function listSites(file?: LeadCMSConfigFile): SiteContext[] {
  const raw = file ?? loadRawConfigFile();
  // Explicit names, so a stale LEADCMS_SITE cannot stop the listing.
  const names = hasSitesBlock(raw) ? Object.keys(raw.sites!) : [DEFAULT_SITE_NAME];
  return names.map((name) =>
    siteContextFromConfig(resolveEffectiveConfig({ site: name, file: raw, env: false }))
  );
}

/**
 * The site the current process is working against, after `--site`,
 * `configure({ site })`, `LEADCMS_SITE` and `defaultSite` have been applied.
 */
export function getActiveSite(): SiteContext {
  return resolveSite();
}

/** Upper snake case, as used in env var names: `my-site` → `MY_SITE`. */
export function toEnvSegment(name: string): string {
  return name.toUpperCase().replace(/-/g, "_");
}
