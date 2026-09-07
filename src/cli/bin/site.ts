#!/usr/bin/env node
/**
 * LeadCMS Site Management CLI Entry Point
 *
 * Subcommands:
 *   leadcms site list [--names]        - List configured sites
 *   leadcms site add <name> [options]  - Add a site (migrates a single-site config first)
 *   leadcms site remove <name>         - Remove a site's config entry (files are left in place)
 *   leadcms site set-default <name>    - Set the default site
 *   leadcms site show [name]           - Show a site's directories, remotes and sync state
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import readline from "readline";
import { resolveEffectiveConfig } from "../../lib/config.js";
import {
  remoteApiKeyEnvNames,
  resolveRemote,
  type RemoteConfig,
} from "../../lib/remote-context.js";
import {
  DEFAULT_SITE_NAME,
  DEFAULT_SITE_ROOT,
  SITE_DIR_KEYS,
  SITE_NAME_PATTERN,
  expandSiteRoot,
  hasSitesBlock,
  listSites,
  resolveSite,
  validateSitesBlock,
  type LeadCMSConfigFile,
  type SiteConfig,
  type SiteContext,
} from "../../lib/site-context.js";
import { initVerboseFromArgs } from "../../lib/logger.js";
import {
  DEFAULT_CONFIG_FILE_NAME,
  displayPath,
  findConfigPath,
  readRawConfig,
  writeRawConfig,
} from "./config-file.js";
import { countNested, readRemoteStateSync } from "./remote-state.js";

const args = process.argv.slice(2);
initVerboseFromArgs(args);

const subcommand = args[0];

switch (subcommand) {
  case "list":
  case "ls":
    listSitesCommand(args.slice(1));
    break;
  case "add":
    await addSiteCommand(args.slice(1));
    break;
  case "remove":
  case "rm":
    removeSiteCommand(args.slice(1));
    break;
  case "set-default":
    setDefaultCommand(args.slice(1));
    break;
  case "show":
    showSiteCommand(args.slice(1));
    break;
  default:
    printUsage();
    break;
}

function printUsage(): void {
  console.log(`
Usage: leadcms site <subcommand> [options]

Manage named sites (one codebase, several content trees).

Subcommands:
  list [--names]           List all configured sites (--names: one name per line)
  add <name> [options]     Add a site. On a project without a "sites" block the
                           current configuration is first wrapped into a site.
    --root <dir>           Site root (default: sites/<name>/.leadcms)
    --media-dir <dir>      Media directory (default: sites/<name>/public/media)
    --language <code>      Default language for the site
    --remote <name>=<url>  Add a remote (repeatable; the first one becomes the default)
    --default              Make the new site the default site
    --existing-name <name> Name for the current (pre-migration) site
    --yes, -y              Do not ask for confirmation
  remove <name>            Remove a site from the config (files are left in place)
  set-default <name>       Set the default site
  show [name]              Show a site's directories, remotes and sync state

Examples:
  leadcms site list
  leadcms site add zenith --root sites/zenith/.leadcms --media-dir sites/zenith/public/media \\
    --language en-GB --remote prod=https://cms.zenith.example.com
  leadcms site set-default acme
  leadcms site show zenith
  leadcms pull --site zenith
`);
}

// ── list ──────────────────────────────────────────────────────────────

function listSitesCommand(subArgs: string[]): void {
  let sites: SiteContext[];
  try {
    sites = listSites();
  } catch (_error: unknown) {
    console.error(`❌ ${(_error as Error).message}`);
    process.exit(1);
  }

  if (subArgs.includes("--names")) {
    for (const site of sites) console.log(site.name);
    return;
  }

  let activeName: string | undefined;
  try {
    activeName = resolveSite().name;
  } catch {
    // A stale LEADCMS_SITE must not stop the listing; it just has no active marker.
  }

  const rows = sites.map((site) => ({
    marker: site.name === activeName ? "*" : " ",
    name: site.name,
    root: displayPath(site.root),
    language: site.defaultLanguage,
    remotes: formatRemotes(site),
    tag: site.isDefault ? "[default]" : "",
  }));
  const width = (pick: (row: (typeof rows)[number]) => string) =>
    rows.reduce((max, row) => Math.max(max, pick(row).length), 0);
  const nameWidth = width((r) => r.name) + 2;
  const rootWidth = width((r) => r.root) + 2;
  const langWidth = width((r) => r.language) + 2;

  console.log("");
  if (sites.length === 1 && sites[0].name === DEFAULT_SITE_NAME) {
    console.log('  Single-site mode (no "sites" block). Add a site with: leadcms site add <name>');
    console.log("");
  }
  for (const row of rows) {
    console.log(
      `  ${row.marker} ${row.name.padEnd(nameWidth)}${row.root.padEnd(rootWidth)}${row.language.padEnd(langWidth)}${row.remotes}${row.tag ? `   ${row.tag}` : ""}`
    );
  }
  console.log("");
}

function formatRemotes(site: SiteContext): string {
  const names = Object.keys(site.remotes);
  if (names.length === 0) return "remotes: none";
  return `remotes: ${names
    .map((name) => (name === site.defaultRemote ? `${name} (default)` : name))
    .join(", ")}`;
}

// ── add ───────────────────────────────────────────────────────────────

interface AddOptions {
  name: string;
  root?: string;
  mediaDir?: string;
  language?: string;
  remotes: Array<{ name: string; url: string }>;
  makeDefault: boolean;
  existingName?: string;
  yes: boolean;
}

function parseAddOptions(subArgs: string[]): AddOptions {
  const options: AddOptions = { name: "", remotes: [], makeDefault: false, yes: false };
  const positional: string[] = [];

  const valueOf = (i: number, flag: string): string => {
    const value = subArgs[i + 1];
    if (!value || value.startsWith("-")) {
      console.error(`❌ ${flag} requires a value`);
      process.exit(1);
    }
    return value;
  };

  for (let i = 0; i < subArgs.length; i++) {
    const arg = subArgs[i];
    switch (arg) {
      case "--root":
        options.root = valueOf(i++, arg);
        break;
      case "--media-dir":
        options.mediaDir = valueOf(i++, arg);
        break;
      case "--language":
      case "--default-language":
        options.language = valueOf(i++, arg);
        break;
      case "--remote": {
        const spec = valueOf(i++, arg);
        const eq = spec.indexOf("=");
        if (eq <= 0) {
          console.error(
            `❌ --remote expects <name>=<url> (e.g. --remote prod=https://cms.example.com)`
          );
          process.exit(1);
        }
        options.remotes.push({ name: spec.slice(0, eq), url: spec.slice(eq + 1) });
        break;
      }
      case "--default":
        options.makeDefault = true;
        break;
      case "--existing-name":
        options.existingName = valueOf(i++, arg);
        break;
      case "--yes":
      case "-y":
        options.yes = true;
        break;
      default:
        if (arg.startsWith("-")) {
          console.error(`❌ Unknown option: ${arg}`);
          process.exit(1);
        }
        positional.push(arg);
    }
  }

  options.name = positional[0] ?? "";
  return options;
}

function validateSiteName(name: string, what = "Site name"): void {
  if (!SITE_NAME_PATTERN.test(name)) {
    console.error(
      `❌ ${what} must be lowercase alphanumeric with hyphens (e.g. "acme", "zenith-uk").`
    );
    process.exit(1);
  }
  if (name === DEFAULT_SITE_NAME) {
    console.error(`❌ "${DEFAULT_SITE_NAME}" is reserved for single-site mode; pick another name.`);
    process.exit(1);
  }
}

async function addSiteCommand(subArgs: string[]): Promise<void> {
  const options = parseAddOptions(subArgs);
  if (!options.name) {
    console.error("❌ Usage: leadcms site add <name> [--root <dir>] [--media-dir <dir>] ...");
    process.exit(1);
  }
  validateSiteName(options.name);

  for (const remote of options.remotes) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(remote.name)) {
      console.error(`❌ Remote name "${remote.name}" must be lowercase alphanumeric with hyphens.`);
      process.exit(1);
    }
    try {
      new URL(remote.url);
    } catch {
      console.error(`❌ Invalid URL for remote "${remote.name}": ${remote.url}`);
      process.exit(1);
    }
  }

  const configPath = findConfigPath() ?? path.resolve(DEFAULT_CONFIG_FILE_NAME);
  const rawConfig: LeadCMSConfigFile & Record<string, unknown> = fs.existsSync(configPath)
    ? readRawConfig(configPath)
    : {};

  if (!hasSitesBlock(rawConfig)) {
    await migrateToSites(rawConfig, options);
  }

  const sites = rawConfig.sites as Record<string, SiteConfig>;
  if (sites[options.name]) {
    console.error(`❌ Site "${options.name}" already exists. Remove it first to reconfigure.`);
    process.exit(1);
  }

  const site: SiteConfig = {
    root: options.root ?? path.posix.join("sites", options.name, DEFAULT_SITE_ROOT),
    mediaDir: options.mediaDir ?? path.posix.join("sites", options.name, "public/media"),
  };
  if (options.language) site.defaultLanguage = options.language;
  if (options.remotes.length > 0) {
    site.remotes = {};
    for (const remote of options.remotes) {
      site.remotes[remote.name] = { url: remote.url.replace(/\/+$/, "") };
    }
    site.defaultRemote = options.remotes[0].name;
  }

  sites[options.name] = site;
  if (options.makeDefault || !rawConfig.defaultSite) {
    rawConfig.defaultSite = options.name;
  }

  const { errors, warnings } = validateSitesBlock(rawConfig);
  if (errors.length > 0) {
    console.error(`❌ The resulting configuration is invalid; nothing was written:`);
    for (const error of errors) console.error(`   • ${error}`);
    process.exit(1);
  }

  writeRawConfig(configPath, rawConfig);

  console.log(`✅ Added site "${options.name}"`);
  console.log(`   root:      ${site.root}`);
  console.log(`   mediaDir:  ${site.mediaDir}`);
  if (site.defaultLanguage) console.log(`   language:  ${site.defaultLanguage}`);
  for (const remote of options.remotes) {
    const isDefault = remote.name === site.defaultRemote;
    console.log(`   remote:    ${remote.name}${isDefault ? " (default)" : ""} → ${remote.url}`);
  }
  if (rawConfig.defaultSite === options.name) {
    console.log(`   Set as default site.`);
  }
  for (const warning of warnings) console.log(`⚠️  ${warning}`);

  console.log("");
  console.log("💡 Next steps:");
  if (options.remotes.length > 0) {
    const envName = remoteApiKeyEnvNames(site.defaultRemote!, options.name)[0];
    console.log(
      `   • Set an API key: ${envName}=<key>  (or: leadcms login --site ${options.name})`
    );
    console.log(`   • First sync:     leadcms pull --site ${options.name}`);
  } else {
    console.log(`   • Add a remote:   leadcms remote add <name> <url> --site ${options.name}`);
  }
  console.log(
    `   • Point public/media at ${site.mediaDir} before building this site (see README, "Multiple sites")`
  );
}

/**
 * One-time migration of a single-site configuration into a `sites` block.
 * The existing configuration becomes a named site with `root: ".leadcms"`,
 * so every file, and every remote checkpoint under `.leadcms/remotes/`, is
 * picked up unchanged.
 */
async function migrateToSites(
  rawConfig: LeadCMSConfigFile & Record<string, unknown>,
  options: AddOptions
): Promise<void> {
  console.log(
    `ℹ️  This project has no "sites" block yet. The current configuration becomes a site.`
  );

  let existingName = options.existingName;
  if (!existingName) {
    if (options.yes || !process.stdin.isTTY) {
      console.error(
        `❌ Pass --existing-name <name> to name the current site (its files stay where they are).`
      );
      process.exit(1);
    }
    existingName = (await prompt(`   Name for the existing site [main]: `)) || "main";
  }
  validateSiteName(existingName, "Existing site name");
  if (existingName === options.name) {
    console.error(`❌ The existing site and the new site cannot both be called "${options.name}".`);
    process.exit(1);
  }

  const existing: SiteConfig = { root: DEFAULT_SITE_ROOT };
  const moved: string[] = [];

  // Directory keys move into the site; ones equal to the root expansion are
  // dropped because the expansion reproduces them.
  const expansion = expandSiteRoot(DEFAULT_SITE_ROOT);
  for (const key of SITE_DIR_KEYS) {
    const value = rawConfig[key];
    if (value === undefined) continue;
    if (typeof value === "string" && path.normalize(value) !== path.normalize(expansion[key])) {
      existing[key] = value;
      moved.push(key);
    }
    delete rawConfig[key];
  }

  existing.mediaDir = typeof rawConfig.mediaDir === "string" ? rawConfig.mediaDir : "public/media";
  if (rawConfig.mediaDir !== undefined) {
    delete rawConfig.mediaDir;
    moved.push("mediaDir");
  }

  if (rawConfig.remotes && Object.keys(rawConfig.remotes).length > 0) {
    existing.remotes = rawConfig.remotes as Record<string, RemoteConfig>;
    existing.defaultRemote =
      (rawConfig.defaultRemote as string | undefined) ?? Object.keys(existing.remotes)[0];
    delete rawConfig.remotes;
    delete rawConfig.defaultRemote;
    moved.push("remotes", "defaultRemote");
  } else if (typeof rawConfig.url === "string" && rawConfig.url) {
    // A flat url becomes a remote named "default": that keeps the existing
    // checkpoint at .leadcms/remotes/default/ and the LEADCMS_API_KEY fallback.
    existing.remotes = { default: { url: rawConfig.url.replace(/\/+$/, "") } };
    existing.defaultRemote = "default";
    delete rawConfig.url;
    moved.push('url (as remote "default")');
  }
  if (rawConfig.remotes !== undefined) delete rawConfig.remotes;
  if (rawConfig.defaultRemote !== undefined) delete rawConfig.defaultRemote;

  console.log("");
  console.log(`   Site "${existingName}":`);
  console.log(`     root:      ${existing.root}   (files stay where they are)`);
  console.log(`     mediaDir:  ${existing.mediaDir}`);
  if (existing.remotes) {
    console.log(
      `     remotes:   ${Object.keys(existing.remotes)
        .map((n) => (n === existing.defaultRemote ? `${n} (default)` : n))
        .join(", ")}`
    );
  } else {
    console.log(`     remotes:   none (LEADCMS_URL from the environment keeps working)`);
  }
  console.log(`     moved from top level: ${moved.length > 0 ? moved.join(", ") : "nothing"}`);
  console.log(`   Existing sync state under ${DEFAULT_SITE_ROOT}/remotes/ is picked up unchanged.`);
  console.log("");

  if (!options.yes) {
    const answer = await prompt("   Proceed? [y/N]: ");
    if (!/^y(es)?$/i.test(answer)) {
      console.log("Aborted. Nothing was written.");
      process.exit(0);
    }
  }

  rawConfig.sites = { [existingName]: existing };
  rawConfig.defaultSite = existingName;
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ── remove ────────────────────────────────────────────────────────────

function removeSiteCommand(subArgs: string[]): void {
  const name = subArgs[0];
  if (!name) {
    console.error("❌ Usage: leadcms site remove <name>");
    process.exit(1);
  }

  const configPath = findConfigPath();
  if (!configPath) {
    console.error(`❌ No ${DEFAULT_CONFIG_FILE_NAME} found.`);
    process.exit(1);
  }

  const rawConfig = readRawConfig(configPath);
  if (!hasSitesBlock(rawConfig) || !rawConfig.sites![name]) {
    console.error(`❌ Site "${name}" is not configured.`);
    process.exit(1);
  }

  const root = rawConfig.sites![name].root ?? DEFAULT_SITE_ROOT;
  delete rawConfig.sites![name];
  const remaining = Object.keys(rawConfig.sites!);

  if (rawConfig.defaultSite === name) {
    if (remaining.length > 0) {
      rawConfig.defaultSite = remaining[0];
      console.log(`   Default site changed to "${rawConfig.defaultSite}".`);
    } else {
      delete rawConfig.defaultSite;
    }
  }

  if (remaining.length === 0) {
    delete rawConfig.sites;
    delete rawConfig.defaultSite;
    console.log(
      `   No sites left: the project is back in single-site mode with default directories and no remotes.`
    );
  }

  writeRawConfig(configPath, rawConfig);
  console.log(`✅ Removed site "${name}". Files under ${root} were left in place.`);
}

// ── set-default ───────────────────────────────────────────────────────

function setDefaultCommand(subArgs: string[]): void {
  const name = subArgs[0];
  if (!name) {
    console.error("❌ Usage: leadcms site set-default <name>");
    process.exit(1);
  }

  const configPath = findConfigPath();
  if (!configPath) {
    console.error(`❌ No ${DEFAULT_CONFIG_FILE_NAME} found.`);
    process.exit(1);
  }

  const rawConfig = readRawConfig(configPath);
  if (!hasSitesBlock(rawConfig) || !rawConfig.sites![name]) {
    console.error(
      `❌ Site "${name}" is not configured. Add it first with: leadcms site add ${name}`
    );
    process.exit(1);
  }

  rawConfig.defaultSite = name;
  writeRawConfig(configPath, rawConfig);
  console.log(`✅ Default site set to "${name}".`);
}

// ── show ──────────────────────────────────────────────────────────────

function showSiteCommand(subArgs: string[]): void {
  const name = subArgs.find((arg) => !arg.startsWith("-"));

  let ctx: SiteContext;
  try {
    ctx = resolveSite(name);
  } catch (_error: unknown) {
    console.error(`❌ ${(_error as Error).message}`);
    process.exit(1);
  }

  const config = resolveEffectiveConfig({ site: ctx.name });
  const label = ctx.isDefault ? `${ctx.name} (default)` : ctx.name;

  console.log("");
  console.log(`  Site:             ${label}`);
  console.log(`  Root:             ${displayPath(ctx.root)}`);
  console.log(`  Language:         ${ctx.defaultLanguage}`);
  if (ctx.languageDomains && Object.keys(ctx.languageDomains).length > 0) {
    console.log(
      `  Domains:          ${Object.entries(ctx.languageDomains)
        .map(([lang, url]) => `${lang} → ${url}`)
        .join(", ")}`
    );
  }
  console.log(`  Content:          ${displayPath(ctx.contentDir)}`);
  console.log(`  Media:            ${displayPath(ctx.mediaDir)}`);
  console.log(`  Comments:         ${displayPath(ctx.commentsDir)}`);
  console.log(`  Email templates:  ${displayPath(ctx.emailTemplatesDir)}`);
  console.log(`  Settings:         ${displayPath(ctx.settingsDir)}`);
  console.log(`  Segments:         ${displayPath(ctx.segmentsDir)}`);
  console.log(`  Sequences:        ${displayPath(ctx.sequencesDir)}`);
  console.log(`  Redirects:        ${displayPath(ctx.redirectsDir)}`);
  console.log(`  State:            ${displayPath(ctx.stateBaseDir)}`);

  const remoteNames = Object.keys(ctx.remotes);
  if (remoteNames.length === 0) {
    console.log(
      `  Remotes:          none${config.url ? ` (single-remote url: ${config.url})` : ""}`
    );
  } else {
    console.log(`  Remotes:`);
    for (const remoteName of remoteNames) {
      const remote = resolveRemote(remoteName, config);
      const remoteLabel = remote.isDefault ? `${remoteName} (default)` : remoteName;
      console.log(`    ${remoteLabel.padEnd(18)}${remote.url}`);
      console.log(
        `      API key:        ${remote.apiKey ? "set" : `not set — ${remoteApiKeyEnvNames(remoteName, ctx.name)[0]}=<key>`}`
      );

      const state = readRemoteStateSync(remote.stateDir);
      const tokens = Object.entries(state.tokens);
      if (!state.hasMetadata && tokens.length === 0) {
        console.log(`      Sync state:     none yet (first pull will be a full sync)`);
        continue;
      }
      if (tokens.length > 0) {
        console.log(
          `      Checkpoints:    ${tokens.map(([entity, token]) => `${entity}=${token}`).join(", ")}`
        );
      }
      if (state.hasMetadata) {
        console.log(
          `      Tracked:        content ${countNested(state.sections.content)}, email templates ${countNested(state.sections.emailTemplates)}, comments ${countNested(state.sections.comments)}`
        );
      }
    }
  }
  console.log("");
}
