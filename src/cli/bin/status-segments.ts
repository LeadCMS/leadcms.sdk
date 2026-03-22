#!/usr/bin/env node
/**
 * LeadCMS Status Segments CLI Entry Point
 */

import 'dotenv/config';
import { statusSegments } from '../../scripts/push-segments.js';
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

const spinner = startSpinner('Checking segment status…');
statusSegments({ showDelete, showDetailedPreview, remoteContext })
    .then(() => spinner.stop())
    .catch((error: any) => {
        spinner.fail('Failed to check segment status');
        console.error(error.message);
        process.exit(1);
    });
