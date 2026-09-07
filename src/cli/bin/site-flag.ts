/**
 * Shared --site / -s flag parsing for CLI bin scripts.
 *
 * Call this before `parseRemoteFlag()`: remotes are resolved within the
 * selected site, and the helper bindings (`CONTENT_DIR`, `defaultLanguage`,
 * …) must point at that site before any script reads them.
 */

import type { SiteContext } from "../../lib/site-context.js";
import { configureForSite } from "../../scripts/leadcms-helpers.js";
import { selectSite } from "./site-args.js";

export { parseSiteArg, stripSiteArgs } from "./site-args.js";

/**
 * Resolve the site from `--site <name>` / `-s <name>`, `LEADCMS_SITE` or
 * `defaultSite`; export it as `LEADCMS_SITE`; rebind the helper constants;
 * print the site header (multi-site mode only).
 */
export function parseSiteFlag(args: string[]): SiteContext {
  const ctx = selectSite(args);
  configureForSite(ctx);
  return ctx;
}
