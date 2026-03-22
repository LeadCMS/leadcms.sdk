#!/usr/bin/env node
/**
 * LeadCMS Status Sequences CLI Entry Point
 */

import 'dotenv/config';
import { statusSequences } from '../../scripts/push-sequences.js';
import { resolveIdentity } from '../../scripts/leadcms-helpers.js';
import { initVerboseFromArgs } from '../../lib/logger.js';
import { startSpinner } from '../../lib/spinner.js';
import { parseRemoteFlag } from './remote-flag.js';

const args = process.argv.slice(2);
initVerboseFromArgs(args);
const remoteContext = parseRemoteFlag(args);

const showDelete = args.includes('--delete');
const showDetailedPreview = args.includes('--preview');

await resolveIdentity();

const spinner = startSpinner('Checking sequence status…');
statusSequences({ showDelete, showDetailedPreview, remoteContext })
    .then(() => spinner.stop())
    .catch((error: any) => {
        spinner.fail('Failed to check sequence status');
        console.error(error.message);
        process.exit(1);
    });
