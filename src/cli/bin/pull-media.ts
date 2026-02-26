#!/usr/bin/env node
/**
 * LeadCMS Pull Media CLI Entry Point
 */

import { pullMedia } from '../../scripts/pull-media.js';
import { resolveIdentity } from '../../scripts/leadcms-helpers.js';
import { initVerboseFromArgs } from '../../lib/logger.js';
import { startSpinner } from '../../lib/spinner.js';

const args = process.argv.slice(2);
initVerboseFromArgs(args);
const reset = args.includes('--reset');

await resolveIdentity();

const spinner = startSpinner('Pulling media from LeadCMS…');
pullMedia({ reset })
  .then(() => {
    spinner.stop();
    process.exit(0);
  })
  .catch((error: any) => {
    spinner.fail('Media pull failed');
    console.error(error.message);
    process.exit(1);
  });
