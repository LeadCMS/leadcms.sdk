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
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
import { listRemotes, resolveRemote } from "../../lib/remote-context.js";
import { getConfig } from "../../lib/config.js";
import { initVerboseFromArgs } from "../../lib/logger.js";

const args = process.argv.slice(2);
initVerboseFromArgs(args);

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

Examples:
  leadcms remote list
  leadcms remote add production https://cms.example.com
  leadcms remote add develop https://dev-cms.example.com
  leadcms remote set-default production
  leadcms remote show production
  leadcms remote reset develop
`);
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

  const rawConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));

  if (!rawConfig.remotes) {
    rawConfig.remotes = {};
  }

  if (rawConfig.remotes[name]) {
    console.error(`❌ Remote "${name}" already exists. Remove it first to reconfigure.`);
    process.exit(1);
  }

  rawConfig.remotes[name] = { url: url.replace(/\/+$/, "") };

  // If this is the first remote, set it as default
  if (Object.keys(rawConfig.remotes).length === 1 && !rawConfig.defaultRemote) {
    rawConfig.defaultRemote = name;
    console.log(`✅ Added remote "${name}" → ${url}`);
    console.log(`   Set as default remote.`);
  } else {
    console.log(`✅ Added remote "${name}" → ${url}`);
  }

  fs.writeFileSync(configPath, JSON.stringify(rawConfig, null, 2) + "\n", "utf-8");
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

  const rawConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));

  if (!rawConfig.remotes || !rawConfig.remotes[name]) {
    console.error(`❌ Remote "${name}" is not configured.`);
    process.exit(1);
  }

  delete rawConfig.remotes[name];

  if (rawConfig.defaultRemote === name) {
    const remaining = Object.keys(rawConfig.remotes);
    rawConfig.defaultRemote = remaining.length > 0 ? remaining[0] : undefined;
    if (rawConfig.defaultRemote) {
      console.log(`   Default remote changed to "${rawConfig.defaultRemote}".`);
    } else {
      delete rawConfig.defaultRemote;
    }
  }

  if (Object.keys(rawConfig.remotes).length === 0) {
    delete rawConfig.remotes;
    delete rawConfig.defaultRemote;
  }

  fs.writeFileSync(configPath, JSON.stringify(rawConfig, null, 2) + "\n", "utf-8");
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
      const envName = name.toUpperCase().replace(/-/g, "_");
      console.log(`  💡 Set API key with: LEADCMS_REMOTE_${envName}_API_KEY=<key>`);
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

  const rawConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));

  if (!rawConfig.remotes || !rawConfig.remotes[name]) {
    console.error(
      `❌ Remote "${name}" is not configured. Add it first with: leadcms remote add ${name} <url>`
    );
    process.exit(1);
  }

  rawConfig.defaultRemote = name;
  fs.writeFileSync(configPath, JSON.stringify(rawConfig, null, 2) + "\n", "utf-8");
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

// ── State inspection (sync, for CLI output) ───────────────────────────

interface RemoteStateSummary {
  hasMetadata: boolean;
  tokens: Record<string, string>;
  sections: Record<string, unknown>;
}

/**
 * Read a remote's metadata.json without the async API. Understands the v2
 * layout (`{ version: 2, <block>: { syncToken, items } }`), the pre-v2 bare
 * layout, and pre-v2 `<type>-sync-token` files.
 */
function readRemoteStateSync(stateDir: string): RemoteStateSummary {
  const summary: RemoteStateSummary = { hasMetadata: false, tokens: {}, sections: {} };
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(stateDir, "metadata.json"), "utf-8"));
    summary.hasMetadata = true;
    const isV2 = typeof doc.version === "number" && doc.version >= 2;
    for (const [block, value] of Object.entries(doc)) {
      if (block === "version" || !value || typeof value !== "object") continue;
      if (isV2) {
        const { syncToken, items } = value as { syncToken?: unknown; items?: unknown };
        if (typeof syncToken === "string" && syncToken) summary.tokens[block] = syncToken;
        if (items && typeof items === "object") summary.sections[block] = items;
      } else {
        summary.sections[block] = value;
      }
    }
  } catch {
    // No metadata.json
  }
  // Declared here, not at module level: the command dispatcher above runs at
  // import time, before later top-level constants are initialised.
  const entityTypes = ["content", "media", "comments", "email-templates", "segments", "sequences", "redirects"];
  for (const entity of entityTypes) {
    if (summary.tokens[entity]) continue;
    try {
      const token = fs.readFileSync(path.join(stateDir, `${entity}-sync-token`), "utf-8").trim();
      if (token) summary.tokens[entity] = token;
    } catch {
      // No pre-v2 token file
    }
  }
  return summary;
}

function countNested(section: unknown): number {
  if (!section || typeof section !== "object") return 0;
  return Object.values(section as Record<string, unknown>).reduce<number>(
    (sum, inner) => sum + Object.keys((inner as Record<string, unknown>) || {}).length,
    0
  );
}

function findConfigPath(): string | null {
  const candidates = ["leadcms.config.json", "leadcms.config.js"];

  for (const name of candidates) {
    const fullPath = path.resolve(name);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }

  return null;
}
