#!/usr/bin/env node
/**
 * LeadCMS Pull Sequences CLI Entry Point
 */

import { pullLeadCMSSequences } from '../../scripts/pull-sequences.js';
import { resolveIdentity } from '../../scripts/leadcms-helpers.js';
import { initVerboseFromArgs } from '../../lib/logger.js';
import { startSpinner } from '../../lib/spinner.js';
import { parseRemoteFlag } from './remote-flag.js';

const args = process.argv.slice(2);
initVerboseFromArgs(args);
const remoteContext = parseRemoteFlag(args);

await resolveIdentity();

const spinner = startSpinner('Pulling sequences from LeadCMS…');
pullLeadCMSSequences(remoteContext)
    .then(() => {
        spinner.stop();
        process.exit(0);
    })
    .catch((error: any) => {
        spinner.fail('Sequence pull failed');
        console.error(error.message);
        process.exit(1);
    });
