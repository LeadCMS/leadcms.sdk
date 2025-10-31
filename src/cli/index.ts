#!/usr/bin/env node
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const command = process.argv[2];
const commandArgs = process.argv.slice(3);
const scriptDir = path.join(__dirname, '../scripts');

function runScript(scriptName: string, args: string[] = []) {
  const scriptPath = path.join(scriptDir, scriptName);
  const child = spawn('node', [scriptPath, ...args], {
    stdio: 'inherit',
    env: process.env
  });

  child.on('exit', (code) => {
    process.exit(code || 0);
  });
}

function runScriptSequence(scripts: string[], args: string[] = []) {
  let currentIndex = 0;

  function runNext() {
    if (currentIndex >= scripts.length) {
      return;
    }

    const scriptName = scripts[currentIndex];
    const scriptPath = path.join(scriptDir, scriptName);
    const child = spawn('node', [scriptPath, ...args], {
      stdio: 'inherit',
      env: process.env
    });

    child.on('exit', (code) => {
      if (code !== 0) {
        process.exit(code || 0);
      } else {
        currentIndex++;
        runNext();
      }
    });
  }

  runNext();
}

function getVersion(): string {
  try {
    const packageJsonPath = path.join(__dirname, '../../package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    return packageJson.version;
  } catch (error) {
    return 'unknown';
  }
}

switch (command) {
  case 'version':
  case '-v':
  case '--version':
    console.log(`LeadCMS SDK v${getVersion()}`);
    process.exit(0);
    break;
  case 'pull':
  case 'fetch': // Alias for backward compatibility
    runScript('pull-all.js');
    break;
  case 'pull-content':
    runScript('pull-content.js');
    break;
  case 'pull-media':
    runScript('pull-media.js');
    break;
  case 'pull-comments':
    runScript('pull-comments.js');
    break;
  case 'push':
    runScript('push-leadcms-content.js', commandArgs);
    break;
  case 'status':
    runScript('status-leadcms-content.js', commandArgs);
    break;
  case 'watch':
    runScript('sse-watcher.js');
    break;
  case 'generate-env':
    runScript('generate-env-js.js');
    break;
  case 'init':
  case 'config':
    runScript('init-leadcms.js');
    break;
  case 'login':
    runScript('login-leadcms.js');
    break;
  case 'docker':
  case 'templates':
    generateDockerTemplates();
    break;
  default:
    console.log(`
LeadCMS SDK CLI v${getVersion()}

Usage:
  leadcms version        - Show SDK version
  leadcms init           - Initialize LeadCMS configuration
  leadcms login          - Authenticate and save API token to .env file
  leadcms docker         - Generate Docker deployment templates

  Pull commands:
  leadcms pull           - Pull all content, media, and comments from LeadCMS
  leadcms pull-content   - Pull only content from LeadCMS
  leadcms pull-media     - Pull only media files from LeadCMS
  leadcms pull-comments  - Pull only comments from LeadCMS
  leadcms fetch          - Alias for 'pull' (backward compatibility)

  Push commands:
  leadcms push [options] - Push local content to LeadCMS
    --force              - Override remote changes (skip conflict check)
    --dry-run            - Show API calls without executing them (preview mode)
    --id <content-id>    - Target specific content by ID
    --slug <slug>        - Target specific content by slug

  Status & monitoring:
  leadcms status [options] - Show sync status between local and remote content
    --preview            - Show detailed change previews for all files
    --id <content-id>    - Show detailed status for specific content by ID
    --slug <slug>        - Show detailed status for specific content by slug
  leadcms watch          - Watch for real-time updates via Server-Sent Events

  Utilities:
  leadcms generate-env   - Generate environment variables file

Getting Started:
  1. Initialize configuration:
     leadcms init              - Interactive setup wizard

  2. Authenticate (optional, required for push operations):
     leadcms login             - Get and save API token

  3. Start syncing:
     leadcms pull              - Download content from LeadCMS
     leadcms push              - Upload local changes

Configuration Files:
  .env (recommended, created by 'leadcms login'):
    LEADCMS_URL=https://your-instance.leadcms.io
    LEADCMS_API_KEY=your-token-here
    LEADCMS_DEFAULT_LANGUAGE=en

  leadcms.config.json (created by 'leadcms init'):
    {
      "url": "https://your-instance.leadcms.io",
      "defaultLanguage": "en",
      "contentDir": "content",
      "mediaDir": "public/media",
      "commentsDir": "comments"
    }

  Note: Environment variables take precedence over config file.
  Next.js users can use NEXT_PUBLIC_LEADCMS_URL for client-side access.
`);
    break;
}

function generateDockerTemplates() {
  Promise.all([import('fs'), import('path')]).then(([fs, pathModule]) => {
    const templateDir = pathModule.join(__dirname, '../templates');

    // Check if templates directory exists
    if (!fs.existsSync(templateDir)) {
      console.error('❌ Docker templates not found in SDK. Please update to the latest version.');
      return;
    }

    console.log('🐳 Generating Docker deployment templates...');

    try {
      // Create directories
      const dirs = ['scripts', 'preview'];
      dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
          console.log(`📁 Created directory: ${dir}/`);
        }
      });

      // Copy production files
      const productionFiles = [
        { src: 'docker/Dockerfile', dest: 'Dockerfile' },
        { src: 'docker/nginx.conf', dest: 'nginx.conf' },
        { src: 'scripts/inject-runtime-env.sh', dest: 'scripts/inject-runtime-env.sh' }
      ];

      // Copy preview files
      const previewFiles = [
        { src: 'docker/preview/Dockerfile', dest: 'preview/Dockerfile' },
        { src: 'docker/preview/nginx.conf', dest: 'preview/nginx.conf' },
        { src: 'docker/preview/supervisord.conf', dest: 'preview/supervisord.conf' }
      ];

      [...productionFiles, ...previewFiles].forEach(({ src, dest }) => {
        const srcPath = pathModule.join(templateDir, src);
        const destPath = dest;

        if (fs.existsSync(srcPath)) {
          const content = fs.readFileSync(srcPath, 'utf-8');
          fs.writeFileSync(destPath, content, 'utf-8');

          // Make shell scripts executable
          if (dest.endsWith('.sh')) {
            fs.chmodSync(destPath, '755');
          }

          console.log(`✅ Created ${destPath}`);
        } else {
          console.warn(`⚠️  Template not found: ${srcPath}`);
        }
      });

      console.log('\\n🎉 Docker templates generated successfully!');
      console.log('\\n📖 Usage:');
      console.log('  Production build:  docker build -t my-site .');
      console.log('  Preview mode:      docker build -f preview/Dockerfile -t my-site-preview .');
      console.log('\\n💡 Next steps:');
      console.log('  1. Add "livepreview": "your-dev-command" to package.json scripts');
      console.log('  2. Adjust the COPY source directory in Dockerfile if needed');
      console.log('  3. Set LEADCMS_URL and LEADCMS_API_KEY environment variables');

    } catch (error) {
      console.error('❌ Failed to generate Docker templates:', error);
    }
  });
}
