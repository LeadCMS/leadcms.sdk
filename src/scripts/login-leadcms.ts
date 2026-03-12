/**
 * LeadCMS Login - Interactive token-based authentication
 */

import { config as dotenvConfig } from 'dotenv';
import { getConfig } from '../lib/config.js';
import { authenticate, saveTokenToEnv } from '../lib/auth.js';
import { resolveRemote } from '../lib/remote-context.js';
import axios from 'axios';
import * as readline from 'readline';

// Load environment variables from .env file
dotenvConfig();

/**
 * Prompt user for input
 */
function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function parseRemoteArg(args: string[]): string | undefined {
  const idx = args.findIndex(arg => arg === '--remote' || arg === '-r');
  if (idx === -1) {
    return undefined;
  }

  const name = args[idx + 1];
  if (!name || name.startsWith('-')) {
    throw new Error('--remote requires a remote name (e.g. --remote production)');
  }

  return name;
}

function remoteApiKeyEnvName(remoteName: string): string {
  return `LEADCMS_REMOTE_${remoteName.toUpperCase().replace(/-/g, '_')}_API_KEY`;
}

/**
 * Interactive login flow
 */
async function main(args: string[] = []): Promise<void> {
  let leadCMSUrl: string | undefined;
  let selectedRemoteName: string | undefined;
  let shouldAlsoSaveGenericKey = false;
  const requestedRemote = parseRemoteArg(args);

  try {
    const config = getConfig();

    if (config.remotes && Object.keys(config.remotes).length > 0) {
      const remoteCtx = resolveRemote(requestedRemote);
      leadCMSUrl = remoteCtx.url;
      selectedRemoteName = remoteCtx.name;
      shouldAlsoSaveGenericKey = remoteCtx.isDefault;
    } else {
      leadCMSUrl = config.url || process.env.LEADCMS_URL;
    }
  } catch (error) {
    // Config file not found/invalid; fallback to env for URL only when no explicit remote is requested.
    if (requestedRemote) {
      throw error;
    }
    leadCMSUrl = process.env.LEADCMS_URL;
  }

  if (!leadCMSUrl) {
    console.log('\n❌ LeadCMS URL is not configured.');
    console.log('\n💡 Options:');
    console.log('   1. Run: leadcms init (to create a config file)');
    console.log('   2. Or set LEADCMS_URL in your .env file\n');
    return;
  }

  try {
    // Use shared authentication function
    const { token, user } = await authenticate(leadCMSUrl, prompt);

    // Save to .env
    if (selectedRemoteName) {
      const remoteEnvKey = remoteApiKeyEnvName(selectedRemoteName);
      saveTokenToEnv(token, remoteEnvKey);
      if (shouldAlsoSaveGenericKey) {
        saveTokenToEnv(token, 'LEADCMS_API_KEY');
      }
      console.log(`✅ Token verified and saved to .env file (${remoteEnvKey})!`);
    } else {
      saveTokenToEnv(token);
      console.log('✅ Token verified and saved to .env file!');
    }

    console.log(`\n👤 Successfully logged in as: ${user.displayName || user.userName}`);
    console.log(`   Email: ${user.email}`);

    console.log('\n✅ You can now use commands like:');
    console.log('   • leadcms push   - Push local changes to LeadCMS');
    console.log('   • leadcms pull   - Pull content from LeadCMS');
    console.log('   • leadcms status - Check sync status\n');
  } catch (error: any) {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 401) {
        console.log('\n❌ Authentication failed: Invalid token');
        console.log('   Please make sure you copied the token correctly.\n');
      } else if (error.response?.status === 404) {
        console.log('\n❌ User not found');
        console.log('   The token is valid but the user account may not exist.\n');
      } else {
        console.log(`\n❌ Error: ${error.response?.statusText || error.message}`);
        console.log('   Please try again or contact support.\n');
      }
    } else {
      console.log(`\n❌ ${error.message}\n`);
    }
    process.exit(1);
  }
}

// Note: CLI execution moved to src/cli/bin/login.ts
// This file now only exports the function for programmatic use

export { main as loginLeadCMS };
export { parseRemoteArg, remoteApiKeyEnvName };
