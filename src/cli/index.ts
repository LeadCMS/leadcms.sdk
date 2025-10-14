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
  default:
    console.log(`
LeadCMS SDK CLI

Usage:
  leadcms fetch          - Fetch content from LeadCMS
  leadcms watch          - Watch for real-time updates
  leadcms generate-env   - Generate environment variables file

Environment variables needed:
  NEXT_PUBLIC_LEADCMS_URL          - LeadCMS instance URL
  LEADCMS_API_KEY                  - LeadCMS API key
  NEXT_PUBLIC_LEADCMS_DEFAULT_LANGUAGE - Default language (optional, defaults to 'en')
`);
    break;
}