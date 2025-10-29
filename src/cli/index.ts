#!/usr/bin/env node
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

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

switch (command) {
  case 'pull':
  case 'fetch': // Alias for backward compatibility
    runScript('fetch-leadcms-content.js');
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
    initializeConfig();
    break;
  case 'docker':
  case 'templates':
    generateDockerTemplates();
    break;
  default:
    console.log(`
LeadCMS SDK CLI

Usage:
  leadcms init           - Initialize LeadCMS configuration
  leadcms docker         - Generate Docker deployment templates
  leadcms pull           - Pull content from LeadCMS
  leadcms push [options] - Push local content to LeadCMS
    --force              - Override remote changes (skip conflict check)
    --bulk               - Use bulk import for new content (faster)
    --id <content-id>    - Target specific content by ID
    --slug <slug>        - Target specific content by slug
  leadcms status [options] - Show sync status between local and remote content
    --id <content-id>    - Show detailed status for specific content by ID
    --slug <slug>        - Show detailed status for specific content by slug
  leadcms fetch          - Alias for 'pull' (backward compatibility)
  leadcms watch          - Watch for real-time updates
  leadcms generate-env   - Generate environment variables file

Configuration:
  Set required environment variables (recommended for security):
    LEADCMS_URL=your-leadcms-instance-url
    LEADCMS_API_KEY=your-api-key

  Optional: Create leadcms.config.json for project-specific settings:
  {
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
  Promise.all([import('fs'), import('readline')]).then(([fs, readline]) => {
    const configPath = 'leadcms.config.json';
    if (fs.existsSync(configPath)) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      rl.question('❓ leadcms.config.json already exists. Overwrite? (y/N): ', (answer) => {
        if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
          createConfigFile(configPath);
        } else {
          console.log('✅ Configuration initialization cancelled.');
        }
        rl.close();
      });
    } else {
      createConfigFile(configPath);
    }
  });
}

function createConfigFile(configPath: string) {
  import('fs').then(fs => {
    // Use the sample config file as the source of truth
    const sampleConfigPath = path.join(__dirname, '../../leadcms.config.json.sample');
    const sampleConfig = fs.readFileSync(sampleConfigPath, 'utf-8');

    fs.writeFileSync(configPath, sampleConfig, 'utf-8');
    console.log(`✅ Created ${configPath}`);
    console.log('📝 Set LEADCMS_URL and LEADCMS_API_KEY as environment variables.');
    console.log('🔧 Customize contentDir, mediaDir, or other settings in the config file.');
    console.log('ℹ️  Content types are automatically detected from your LeadCMS API.');
  });
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
