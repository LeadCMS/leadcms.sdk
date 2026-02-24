#!/usr/bin/env node
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const command = process.argv[2];
const commandArgs = process.argv.slice(3);

function runScript(scriptName: string, args: string[] = []) {
  // Use the new CLI bin files instead of the scripts directory
  const binDir = path.join(__dirname, 'bin');
  const binPath = path.join(binDir, scriptName);
  const child = spawn('node', [binPath, ...args], {
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
    const binDir = path.join(__dirname, 'bin');
    const binPath = path.join(binDir, scriptName);
    const child = spawn('node', [binPath, ...args], {
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
    runScript('pull-all.js', commandArgs);
    break;
  case 'pull-content':
    runScript('pull-content.js', commandArgs);
    break;
  case 'pull-media':
    runScript('pull-media.js', commandArgs);
    break;
  case 'pull-comments':
    runScript('pull-comments.js', commandArgs);
    break;
  case 'pull-email-templates':
    runScript('pull-email-templates.js', commandArgs);
    break;
  case 'push':
    runScript('push-all.js', commandArgs);
    break;
  case 'push-content':
    runScript('push-content.js', commandArgs);
    break;
  case 'push-media':
    runScript('push-media.js', commandArgs);
    break;
  case 'push-email-templates':
    runScript('push-email-templates.js', commandArgs);
    break;
  case 'status':
    runScript('status-all.js', commandArgs);
    break;
  case 'status-content':
    runScript('status-content.js', commandArgs);
    break;
  case 'status-media':
    runScript('status-media.js', commandArgs);
    break;
  case 'status-email-templates':
    runScript('status-email-templates.js', commandArgs);
    break;
  case 'watch':
    runScript('watch.js');
    break;
  case 'generate-env':
    runScript('generate-env.js');
    break;
  case 'init':
  case 'config':
    runScript('init.js');
    break;
  case 'login':
    runScript('login.js');
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
  leadcms pull [options] - Pull all content, media, and comments from LeadCMS
    --id <content-id>    - Pull specific content by ID (force update)
    --slug <slug>        - Pull specific content by slug (force update)
    --reset              - Delete all local files and sync tokens, then pull everything fresh
    --force, -f          - Skip three-way merge, always overwrite local with remote
  leadcms pull-content [options] - Pull only content from LeadCMS
    --id <content-id>    - Pull specific content by ID
    --slug <slug>        - Pull specific content by slug
    --reset              - Delete local content files and sync token, then pull fresh
    --force, -f          - Skip three-way merge, always overwrite local with remote
  leadcms pull-media [options] - Pull only media files from LeadCMS
    --reset              - Delete local media files and sync token, then pull fresh
  leadcms pull-comments [options] - Pull only comments from LeadCMS
    --reset              - Delete local comment files and sync token, then pull fresh
  leadcms pull-email-templates [options] - Pull email templates from LeadCMS
    --id <template-id>   - Pull specific email template by ID
    --reset              - Delete local email templates and sync token, then pull fresh
  leadcms fetch          - Alias for 'pull' (backward compatibility)

  Push commands:
  leadcms push [options] - Push all local changes (content + media) to LeadCMS
  leadcms push-content [options] - Push only content to LeadCMS
    --force              - Override remote changes (skip conflict check)
    --dry-run            - Show API calls without executing them (preview mode)
    --delete             - Delete remote content/media not present locally
    --id <content-id>    - Target specific content by ID
    --slug <slug>        - Target specific content by slug
  leadcms push-media [options] - Push only media files to LeadCMS
    --force              - Skip confirmation prompt
    --dry-run            - Show what would be changed without making changes
    --delete             - Delete remote media files not present locally
    --scope <scopeUid>   - Filter by specific scope UID (e.g., "blog", "pages/about")
  leadcms push-email-templates [options] - Push email templates to LeadCMS
    --force              - Override remote changes (skip conflict check)
    --dry-run            - Show API calls without executing them (preview mode)
    --delete             - Delete remote email templates not present locally

  Status & monitoring:
  leadcms status [options] - Show sync status for all entities (content + media + email templates)
    --delete             - Show deletion operations (files to be deleted)
  leadcms status-content [options] - Show content sync status only
    --preview            - Show detailed change previews for all files
    --delete             - Show content deletion operations
    --id <content-id>    - Show detailed status for specific content by ID
    --slug <slug>        - Show detailed status for specific content by slug
  leadcms status-media [options] - Show media file status only
    --delete             - Show media deletion operations
    --scope <scopeUid>   - Filter by specific scope UID
  leadcms status-email-templates [options] - Show email template status only
    --preview            - Show detailed metadata for each change
    --delete             - Show email template deletion operations
    --id <template-id>   - Show detailed status for specific template by ID
  leadcms watch          - Watch for real-time updates via Server-Sent Events

  Utilities:
  leadcms generate-env   - Generate environment variables file

  Global options:
  --verbose, -V          - Show detailed debug output (API calls, sync tokens, etc.)
                           Can also be enabled with LEADCMS_VERBOSE=true env var

Getting Started:
  1. Initialize configuration:
     leadcms init              - Interactive setup wizard

  2. Authenticate (optional, required for push operations):
     leadcms login             - Get and save API token

  3. Start syncing:
     leadcms pull              - Download content from LeadCMS
     leadcms status            - Check what needs to be pushed
     leadcms push              - Upload local changes

Configuration Files:
  .env (recommended, created by 'leadcms login'):
    LEADCMS_URL=https://your-instance.leadcms.ai
    LEADCMS_API_KEY=your-token-here
    LEADCMS_DEFAULT_LANGUAGE=en

  leadcms.config.json (created by 'leadcms init'):
    {
      "url": "https://your-instance.leadcms.ai",
      "defaultLanguage": "en",
      "contentDir": "content",
      "mediaDir": "public/media",
      "commentsDir": "comments",
      "emailTemplatesDir": ".leadcms/email-templates"
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
