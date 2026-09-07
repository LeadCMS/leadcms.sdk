#!/usr/bin/env node
/**
 * LeadCMS Remote Management CLI Entry Point
 *
 * Subcommands:
 *   leadcms remote list              - List configured remotes
 *   leadcms remote add <name> <url>  - Add a new remote
 *   leadcms remote remove <name>     - Remove a remote
 *   leadcms remote show <name>       - Show details for a remote
 *   leadcms remote set-default <name>  - Set the default remote
 *   leadcms remote reset <name>      - Reset sync tokens and metadata for a remote
 *
 * Every subcommand accepts --site <name>; in multi-site mode it acts on that
 * site's `remotes` block (default: the default site).
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { listRemotes, remoteApiKeyEnvNames, resolveRemote } from "../../lib/remote-context.js";
import { getConfig } from "../../lib/config.js";
import { DEFAULT_SITE_NAME, type LeadCMSConfigFile, type SiteConfig } from "../../lib/site-context.js";
import { initVerboseFromArgs } from "../../lib/logger.js";
import { selectSite, stripSiteArgs } from "./site-args.js";
import { findConfigPath, readRawConfig, writeRawConfig } from "./config-file.js";
import { countNested, readRemoteStateSync } from "./remote-state.js";

const rawArgs = process.argv.slice(2);
initVerboseFromArgs(rawArgs);

// Resolve the site first: it prints the site header in multi-site mode and
// makes every getConfig() below return that site's remotes.
const siteCtx = selectSite(rawArgs);
const multiSite = siteCtx.name !== DEFAULT_SITE_NAME;
const args = stripSiteArgs(rawArgs);

const subcommand = args[0];

switch (subcommand) {
  case "list":
  case "ls":
    listRemotesCommand();
    break;
  case "add":
    addRemoteCommand(args.slice(1));
    break;
  case "remove":
  case "rm":
    removeRemoteCommand(args.slice(1));
    break;
  case "show":
    showRemoteCommand(args.slice(1));
    break;
  case "set-default":
    setDefaultCommand(args.slice(1));
    break;
  case "reset":
    resetRemoteCommand(args.slice(1));
    break;
  default:
    printUsage();
    break;
}

function printUsage(): void {
  console.log(`
Usage: leadcms remote <subcommand> [options]

Manage named remotes (CMS instances).

Subcommands:
  list                     List all configured remotes
  add <name> <url>         Add a new remote
  remove <name>            Remove a remote
  show <name>              Show details for a remote
  set-default <name>       Set the default remote
  reset <name>             Reset sync state for a remote (clear sync tokens and metadata)

Options:
  --site, -s <name>        Act on this site's remotes (multi-site projects)

Examples:
  leadcms remote list
  leadcms remote add production https://cms.example.com
  leadcms remote add develop https://dev-cms.example.com
  leadcms remote set-default production
  leadcms remote show production
  leadcms remote reset develop
  leadcms remote add prod https://cms.zenith.example.com --site zenith
`);
}

/**
 * The object that holds `remotes` / `defaultRemote` for the selected site:
 * the site entry in multi-site mode, the config root otherwise.
 */
function remotesOwner(rawConfig: LeadCMSConfigFile): SiteConfig | LeadCMSConfigFile {
  if (!multiSite) return rawConfig;
  const site = rawConfig.sites?.[siteCtx.name];
  if (!site) {
    console.error(`❌ Site "${siteCtx.name}" is not configured in the config file.`);
    process.exit(1);
  }
  return site;
}

function listRemotesCommand(): void {
  try {
    const remotes = listRemotes();
    const config = getConfig();
    const defaultName = config.defaultRemote;

    if (remotes.length === 0) {
      console.log("No remotes configured.");
      return;
    }

    const labels = remotes.map((remote) => {
      const isDefault =
        remote.name === defaultName || (remotes.length === 1 && remote.name === "default");
      return `${remote.name}${isDefault ? " (default)" : ""}`;
    });
    const labelWidth = labels.reduce((max, label) => Math.max(max, label.length), 0) + 2;

    console.log("");
    remotes.forEach((remote, index) => {
      const label = labels[index].padEnd(labelWidth, " ");
      console.log(`  ${label}${remote.url}`);
    });
    console.log("");
  } catch (_error: unknown) {
    const error = _error as Error;
    console.error(`❌ ${(error as Error).message}`);
    process.exit(1);
  }
}

function addRemoteCommand(subArgs: string[]): void {
  const name = subArgs[0];
  const url = subArgs[1];

  if (!name || !url) {
    console.error("❌ Usage: leadcms remote add <name> <url>");
    process.exit(1);
  }

  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    console.error(
      '❌ Remote name must be lowercase alphanumeric with hyphens (e.g. "production", "dev-server").'
    );
    process.exit(1);
  }

  try {
    new URL(url);
  } catch {
    console.error(`❌ Invalid URL: ${url}`);
    process.exit(1);
  }

  const configPath = findConfigPath();
  if (!configPath) {
    console.error('❌ No leadcms.config.json found. Run "leadcms init" first.');
    process.exit(1);
  }

  const rawConfig = readRawConfig(configPath);
  const owner = remotesOwner(rawConfig);

  if (!owner.remotes) {
    owner.remotes = {};
  }

  if (owner.remotes[name]) {
    console.error(`❌ Remote "${name}" already exists. Remove it first to reconfigure.`);
    process.exit(1);
  }

  owner.remotes[name] = { url: url.replace(/\/+$/, "") };

  // If this is the first remote, set it as default
  const forSite = multiSite ? ` (site "${siteCtx.name}")` : "";
  if (Object.keys(owner.remotes).length === 1 && !owner.defaultRemote) {
    owner.defaultRemote = name;
    console.log(`✅ Added remote "${name}" → ${url}${forSite}`);
    console.log(`   Set as default remote.`);
  } else {
    console.log(`✅ Added remote "${name}" → ${url}${forSite}`);
  }

  writeRawConfig(configPath, rawConfig);
}

function removeRemoteCommand(subArgs: string[]): void {
  const name = subArgs[0];
  if (!name) {
    console.error("❌ Usage: leadcms remote remove <name>");
    process.exit(1);
  }

  const configPath = findConfigPath();
  if (!configPath) {
    console.error("❌ No leadcms.config.json found.");
    process.exit(1);
  }

  const rawConfig = readRawConfig(configPath);
  const owner = remotesOwner(rawConfig);

  if (!owner.remotes || !owner.remotes[name]) {
    console.error(`❌ Remote "${name}" is not configured.`);
    process.exit(1);
  }

  delete owner.remotes[name];

  if (owner.defaultRemote === name) {
    const remaining = Object.keys(owner.remotes);
    owner.defaultRemote = remaining.length > 0 ? remaining[0] : undefined;
    if (owner.defaultRemote) {
      console.log(`   Default remote changed to "${owner.defaultRemote}".`);
    } else {
      delete owner.defaultRemote;
    }
  }

  if (Object.keys(owner.remotes).length === 0) {
    delete owner.remotes;
    delete owner.defaultRemote;
  }

  writeRawConfig(configPath, rawConfig);
  console.log(`✅ Removed remote "${name}".`);
}

function showRemoteCommand(subArgs: string[]): void {
  const name = subArgs[0];
  if (!name) {
    console.error("❌ Usage: leadcms remote show <name>");
    process.exit(1);
  }

  try {
    const ctx = resolveRemote(name);

    console.log("");
    console.log(`  Remote:   ${ctx.name}`);
    console.log(`  URL:      ${ctx.url}`);
    console.log(`  Default:  ${ctx.isDefault ? "yes" : "no"}`);
    console.log(`  API key:  ${ctx.apiKey ? ctx.apiKey.substring(0, 8) + "..." : "not set"}`);
    console.log(`  State:    ${ctx.stateDir}`);

    const state = readRemoteStateSync(ctx.stateDir);

    // Show sync tokens
    for (const [entity, token] of Object.entries(state.tokens)) {
      console.log(`  ${entity.charAt(0).toUpperCase() + entity.slice(1)} sync:  ${token}`);
    }

    // Show metadata-map counts
    if (state.hasMetadata) {
      console.log(`  Content entries:      ${countNested(state.sections.content)}`);
      console.log(`  Email templates:      ${countNested(state.sections.emailTemplates)}`);
      console.log(`  Comment entries:      ${countNested(state.sections.comments)}`);
    }

    console.log("");

    if (!ctx.apiKey) {
      const envName = remoteApiKeyEnvNames(name, multiSite ? siteCtx.name : undefined)[0];
      console.log(`  💡 Set API key with: ${envName}=<key>`);
      console.log("");
    }
  } catch (_error: unknown) {
    const error = _error as Error;
    console.error(`❌ ${(error as Error).message}`);
    process.exit(1);
  }
}

function setDefaultCommand(subArgs: string[]): void {
  const name = subArgs[0];
  if (!name) {
    console.error("❌ Usage: leadcms remote set-default <name>");
    process.exit(1);
  }

  const configPath = findConfigPath();
  if (!configPath) {
    console.error("❌ No leadcms.config.json found.");
    process.exit(1);
  }

  const rawConfig = readRawConfig(configPath);
  const owner = remotesOwner(rawConfig);

  if (!owner.remotes || !owner.remotes[name]) {
    console.error(
      `❌ Remote "${name}" is not configured. Add it first with: leadcms remote add ${name} <url>`
    );
    process.exit(1);
  }

  owner.defaultRemote = name;
  writeRawConfig(configPath, rawConfig);
  console.log(`✅ Default remote set to "${name}".`);
}

function resetRemoteCommand(subArgs: string[]): void {
  const name = subArgs[0];
  if (!name) {
    console.error("❌ Usage: leadcms remote reset <name>");
    process.exit(1);
  }

  try {
    const ctx = resolveRemote(name);

    if (!fs.existsSync(ctx.stateDir)) {
      console.log(`ℹ️  No sync state found for remote "${name}". Nothing to reset.`);
      return;
    }

    const files = fs.readdirSync(ctx.stateDir);
    const syncTokenFiles = files.filter((f) => f.endsWith("-sync-token"));
    const mapFiles = files.filter((f) => f === "metadata.json");
    const allStateFiles = [...syncTokenFiles, ...mapFiles];

    if (allStateFiles.length === 0) {
      console.log(`ℹ️  No sync state found for remote "${name}". Nothing to reset.`);
      return;
    }

    for (const file of allStateFiles) {
      fs.unlinkSync(path.join(ctx.stateDir, file));
    }

    const parts: string[] = [];
    if (syncTokenFiles.length > 0) parts.push(`${syncTokenFiles.length} sync token(s)`);
    if (mapFiles.length > 0) parts.push(`${mapFiles.length} map file(s)`);

    console.log(`✅ Reset state for remote "${name}" (${parts.join(", ")} cleared).`);
    console.log("   Next pull/push will perform a full sync.");
  } catch (_error: unknown) {
    const error = _error as Error;
    console.error(`❌ ${(error as Error).message}`);
    process.exit(1);
  }
}
