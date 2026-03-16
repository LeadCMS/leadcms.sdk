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

import fs from 'fs';
import path from 'path';
import { listRemotes, resolveRemote, metadataMapPath, type RemoteContext } from '../../lib/remote-context.js';
import { getConfig, loadConfig } from '../../lib/config.js';
import { initVerboseFromArgs } from '../../lib/logger.js';

const args = process.argv.slice(2);
initVerboseFromArgs(args);

const subcommand = args[0];

switch (subcommand) {
  case 'list':
  case 'ls':
    listRemotesCommand();
    break;
  case 'add':
    addRemoteCommand(args.slice(1));
    break;
  case 'remove':
  case 'rm':
    removeRemoteCommand(args.slice(1));
    break;
  case 'show':
    showRemoteCommand(args.slice(1));
    break;
  case 'set-default':
    setDefaultCommand(args.slice(1));
    break;
  case 'reset':
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
      console.log('No remotes configured.');
      return;
    }

    const labels = remotes.map(remote => {
      const isDefault = remote.name === defaultName || (remotes.length === 1 && remote.name === 'default');
      return `${remote.name}${isDefault ? ' (default)' : ''}`;
    });
    const labelWidth = labels.reduce((max, label) => Math.max(max, label.length), 0) + 2;

    console.log('');
    remotes.forEach((remote, index) => {
      const label = labels[index].padEnd(labelWidth, ' ');
      console.log(`  ${label}${remote.url}`);
    });
    console.log('');
  } catch (error: any) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }
}

function addRemoteCommand(subArgs: string[]): void {
  const name = subArgs[0];
  const url = subArgs[1];

  if (!name || !url) {
    console.error('❌ Usage: leadcms remote add <name> <url>');
    process.exit(1);
  }

  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    console.error('❌ Remote name must be lowercase alphanumeric with hyphens (e.g. "production", "dev-server").');
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

  const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  if (!rawConfig.remotes) {
    rawConfig.remotes = {};
  }

  if (rawConfig.remotes[name]) {
    console.error(`❌ Remote "${name}" already exists. Remove it first to reconfigure.`);
    process.exit(1);
  }

  rawConfig.remotes[name] = { url: url.replace(/\/+$/, '') };

  // If this is the first remote, set it as default
  if (Object.keys(rawConfig.remotes).length === 1 && !rawConfig.defaultRemote) {
    rawConfig.defaultRemote = name;
    console.log(`✅ Added remote "${name}" → ${url}`);
    console.log(`   Set as default remote.`);
  } else {
    console.log(`✅ Added remote "${name}" → ${url}`);
  }

  fs.writeFileSync(configPath, JSON.stringify(rawConfig, null, 2) + '\n', 'utf-8');
}

function removeRemoteCommand(subArgs: string[]): void {
  const name = subArgs[0];
  if (!name) {
    console.error('❌ Usage: leadcms remote remove <name>');
    process.exit(1);
  }

  const configPath = findConfigPath();
  if (!configPath) {
    console.error('❌ No leadcms.config.json found.');
    process.exit(1);
  }

  const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

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

  fs.writeFileSync(configPath, JSON.stringify(rawConfig, null, 2) + '\n', 'utf-8');
  console.log(`✅ Removed remote "${name}".`);
}

function showRemoteCommand(subArgs: string[]): void {
  const name = subArgs[0];
  if (!name) {
    console.error('❌ Usage: leadcms remote show <name>');
    process.exit(1);
  }

  try {
    const ctx = resolveRemote(name);
    const config = getConfig();

    console.log('');
    console.log(`  Remote:   ${ctx.name}`);
    console.log(`  URL:      ${ctx.url}`);
    console.log(`  Default:  ${ctx.isDefault ? 'yes' : 'no'}`);
    console.log(`  API key:  ${ctx.apiKey ? ctx.apiKey.substring(0, 8) + '...' : 'not set'}`);
    console.log(`  State:    ${ctx.stateDir}`);

    // Show sync token timestamps
    const syncTokenTypes = ['content', 'media', 'comments', 'email-templates'] as const;
    for (const entity of syncTokenTypes) {
      const tokenPath = path.join(ctx.stateDir, `${entity}-sync-token`);
      try {
        const token = fs.readFileSync(tokenPath, 'utf-8').trim();
        console.log(`  ${entity.charAt(0).toUpperCase() + entity.slice(1)} sync:  ${token}`);
      } catch {
        // No sync token for this entity
      }
    }

    // Show metadata-map counts
    try {
      const metaData = JSON.parse(fs.readFileSync(metadataMapPath(ctx), 'utf-8'));
      const contentCount = Object.values(metaData.content || {}).reduce((sum: number, section: any) => sum + Object.keys(section || {}).length, 0);
      const templateCount = Object.values(metaData.emailTemplates || {}).reduce((sum: number, section: any) => sum + Object.keys(section || {}).length, 0);
      const commentCount = Object.values(metaData.comments || {}).reduce((sum: number, section: any) => sum + Object.keys(section || {}).length, 0);
      console.log(`  Content entries:      ${contentCount}`);
      console.log(`  Email templates:      ${templateCount}`);
      console.log(`  Comment entries:      ${commentCount}`);
    } catch {
      // No metadata-map
    }

    console.log('');

    if (!ctx.apiKey) {
      const envName = name.toUpperCase().replace(/-/g, '_');
      console.log(`  💡 Set API key with: LEADCMS_REMOTE_${envName}_API_KEY=<key>`);
      console.log('');
    }
  } catch (error: any) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }
}

function setDefaultCommand(subArgs: string[]): void {
  const name = subArgs[0];
  if (!name) {
    console.error('❌ Usage: leadcms remote set-default <name>');
    process.exit(1);
  }

  const configPath = findConfigPath();
  if (!configPath) {
    console.error('❌ No leadcms.config.json found.');
    process.exit(1);
  }

  const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  if (!rawConfig.remotes || !rawConfig.remotes[name]) {
    console.error(`❌ Remote "${name}" is not configured. Add it first with: leadcms remote add ${name} <url>`);
    process.exit(1);
  }

  rawConfig.defaultRemote = name;
  fs.writeFileSync(configPath, JSON.stringify(rawConfig, null, 2) + '\n', 'utf-8');
  console.log(`✅ Default remote set to "${name}".`);
}

function resetRemoteCommand(subArgs: string[]): void {
  const name = subArgs[0];
  if (!name) {
    console.error('❌ Usage: leadcms remote reset <name>');
    process.exit(1);
  }

  try {
    const ctx = resolveRemote(name);

    if (!fs.existsSync(ctx.stateDir)) {
      console.log(`ℹ️  No sync state found for remote "${name}". Nothing to reset.`);
      return;
    }

    const files = fs.readdirSync(ctx.stateDir);
    const syncTokenFiles = files.filter(f => f.endsWith('-sync-token'));
    const mapFiles = files.filter(f => f === 'metadata.json');
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

    console.log(`✅ Reset state for remote "${name}" (${parts.join(', ')} cleared).`);
    console.log('   Next pull/push will perform a full sync.');
  } catch (error: any) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }
}

function findConfigPath(): string | null {
  const candidates = [
    'leadcms.config.json',
    'leadcms.config.js',
  ];

  for (const name of candidates) {
    const fullPath = path.resolve(name);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }

  return null;
}
