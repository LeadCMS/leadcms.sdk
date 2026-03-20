#!/usr/bin/env node
/**
 * LeadCMS Push Segments CLI Entry Point
 */

import { pushSegments } from '../../scripts/push-segments.js';
import { requireAuthenticatedUser, resolveIdentity } from '../../scripts/leadcms-helpers.js';
import { initVerboseFromArgs } from '../../lib/logger.js';
import { startSpinner } from '../../lib/spinner.js';
import { parseRemoteFlag } from './remote-flag.js';

const args = process.argv.slice(2);
initVerboseFromArgs(args);
const remoteContext = parseRemoteFlag(args);

const force = args.includes('--force') || args.includes('-f');
const dryRun = args.includes('--dry-run') || args.includes('-d');
const allowDelete = args.includes('--delete');

if (!dryRun) {
    await requireAuthenticatedUser();
} else {
    await resolveIdentity();
}

const spinner = startSpinner('Pushing segments to LeadCMS…');
pushSegments({ force, dryRun, allowDelete, remoteContext })
    .then(() => spinner.stop())
    .catch((error: any) => {
        spinner.fail('Segment push failed');
        console.error(error.message);
        process.exit(1);
    });
