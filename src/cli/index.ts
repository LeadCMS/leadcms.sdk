#!/usr/bin/env node
import { spawn } from 'child_process';
import path from 'path';

const command = process.argv[2];
const scriptDir = path.join(__dirname, '../scripts');

function runScript(scriptName: string) {
  const scriptPath = path.join(scriptDir, scriptName);
  const child = spawn('node', [scriptPath], {
    stdio: 'inherit',
    env: process.env
  });

  child.on('exit', (code) => {
    process.exit(code || 0);
  });
}

switch (command) {
  case 'fetch':
    runScript('fetch-leadcms-content.mjs');
    break;
  case 'watch':
    runScript('sse-watcher.mjs');
    break;
  case 'generate-env':
    runScript('generate-env-js.mjs');
    break;
  case 'init':
  case 'config':
    initializeConfig();
    break;
  default:
    console.log(`
LeadCMS SDK CLI

Usage:
  leadcms init           - Initialize LeadCMS configuration
  leadcms fetch          - Fetch content from LeadCMS
  leadcms watch          - Watch for real-time updates
  leadcms generate-env   - Generate environment variables file

Configuration:
  Create a leadcms.config.json file in your project root, or set environment variables:

  Config file example:
  {
    "url": "https://your-leadcms-instance.com",
    "apiKey": "your-api-key",
    "defaultLanguage": "en",
    "contentDir": ".leadcms/content",
    "mediaDir": "public/media"
  }

  Environment variables (fallback):
  LEADCMS_URL                     - LeadCMS instance URL
  LEADCMS_API_KEY                 - LeadCMS API key
  LEADCMS_DEFAULT_LANGUAGE        - Default language (optional, defaults to 'en')

  Next.js users can also use:
  NEXT_PUBLIC_LEADCMS_URL         - LeadCMS instance URL
  NEXT_PUBLIC_LEADCMS_DEFAULT_LANGUAGE - Default language
`);
    break;
}

function initializeConfig() {
  import('fs').then(fs => {
    const configPath = 'leadcms.config.json';
    if (fs.existsSync(configPath)) {
      console.log('❓ leadcms.config.json already exists. Overwrite? (y/N)');
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('data', (key) => {
        if (key.toString().toLowerCase() === 'y') {
          createConfigFile(configPath);
        } else {
          console.log('\\n✅ Configuration initialization cancelled.');
        }
        process.exit(0);
      });
    } else {
      createConfigFile(configPath);
    }
  });
}

function createConfigFile(configPath: string) {
  import('fs').then(fs => {
    const sampleConfig = {
      "url": "https://your-leadcms-instance.com",
      "apiKey": "your-api-key-here",
      "defaultLanguage": "en",
      "contentDir": ".leadcms/content",
      "mediaDir": "public/media",
      "enableDrafts": false
    };

    const content = JSON.stringify(sampleConfig, null, 2);
    fs.writeFileSync(configPath, content, 'utf-8');
    console.log(`✅ Created ${configPath}`);
    console.log('📝 Please edit the configuration file with your LeadCMS details.');
    console.log('ℹ️  Content types are automatically detected from your LeadCMS API.');
  });
}
