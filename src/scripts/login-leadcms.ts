#!/usr/bin/env node
/**
 * LeadCMS Login - Interactive token-based authentication
 */

import { config as dotenvConfig } from 'dotenv';
import { getConfig } from '../lib/config.js';
import { authenticate, saveTokenToEnv } from '../lib/auth.js';
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

/**
 * Interactive login flow
 */
async function main(): Promise<void> {
  let leadCMSUrl: string | undefined;

  // Try to get URL from config file first
  try {
    const config = getConfig();
    leadCMSUrl = config.url;
  } catch (error) {
    // Config file not found or invalid, try environment variable
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
    saveTokenToEnv(token);

    console.log('✅ Token verified and saved to .env file!');
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

// Handle direct script execution
if (typeof import.meta !== 'undefined' && process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  });
}

export { main as loginLeadCMS };
