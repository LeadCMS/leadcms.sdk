#!/usr/bin/env node
/**
 * LeadCMS Pull Comments CLI Entry Point
 */

import { pullComments } from '../../scripts/pull-comments.js';
import { resolveIdentity } from '../../scripts/leadcms-helpers.js';
import { initVerboseFromArgs } from '../../lib/logger.js';
import { startSpinner } from '../../lib/spinner.js';

const args = process.argv.slice(2);
initVerboseFromArgs(args);
const reset = args.includes('--reset');

await resolveIdentity();

const spinner = startSpinner('Pulling comments from LeadCMS…');
pullComments({ reset })
  .then(() => {
    spinner.stop();
    process.exit(0);
  })
  .catch((error: any) => {
    spinner.fail('Comments pull failed');
    console.error(error.message);
    process.exit(1);
  });
