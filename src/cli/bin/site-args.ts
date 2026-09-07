/**
 * `--site` / `-s` handling that does not touch `leadcms-helpers.ts`.
 *
 * `leadcms-helpers.ts` resolves the full configuration at import time, which
 * throws on a project with no remote configured. Commands that must work on
 * such projects (`watch`, `login`, `generate-content-revision`) and the CLI
 * dispatcher use this module directly; everything else goes through
 * `parseSiteFlag()` in `site-flag.ts`, which also rebinds the helpers.
 */

import path from "path";
import { DEFAULT_SITE_NAME, resolveSite, type SiteContext } from "../../lib/site-context.js";

const SITE_FLAGS = ["--site", "-s"];

/**
 * Site name given on the command line, or undefined when no flag is present.
 * Exits with an error when the flag is present but has no value.
 */
export function parseSiteArg(args: string[]): string | undefined {
  const idx = args.findIndex((arg) => SITE_FLAGS.includes(arg));
  if (idx === -1) return undefined;

  const name = args[idx + 1];
  if (!name || name.startsWith("-")) {
    console.error(`❌ --site requires a site name (e.g. --site zenith)`);
    process.exit(1);
  }
  return name;
}

/** The argument list without any `--site <name>` / `-s <name>` pairs. */
export function stripSiteArgs(args: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (SITE_FLAGS.includes(args[i])) {
      i++; // skip the value
      continue;
    }
    result.push(args[i]);
  }
  return result;
}

/**
 * Resolve the site a command runs against and make it the active site for
 * the rest of the process.
 *
 * Resolution order: `--site` flag, `LEADCMS_SITE`, `defaultSite`. In
 * single-site mode the implicit "default" site is returned and nothing is
 * printed, so existing log expectations hold. Exits with the resolution
 * error otherwise (unknown site, `--site` without a `sites` block, …).
 */
export function selectSite(args: string[], options: { quiet?: boolean } = {}): SiteContext {
  const requested = parseSiteArg(args);

  let ctx: SiteContext;
  try {
    ctx = resolveSite(requested);
  } catch (_error: unknown) {
    console.error(`❌ ${(_error as Error).message}`);
    process.exit(1);
  }

  if (ctx.name !== DEFAULT_SITE_NAME) {
    // Every later getConfig() call in this process, and every child process,
    // now resolves the same site.
    process.env.LEADCMS_SITE = ctx.name;
    if (!options.quiet) logSite(ctx);
  }

  return ctx;
}

export function logSite(ctx: SiteContext): void {
  const label = ctx.isDefault ? `${ctx.name} (default)` : ctx.name;
  const root = path.relative(process.cwd(), ctx.root) || ".";
  console.log(`🏷  Site: ${label.padEnd(16)} (${root})`);
}
