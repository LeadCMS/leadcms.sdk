#!/usr/bin/env node
/**
 * LeadCMS SSE Watcher CLI Entry Point
 */

import { startSSEWatcher } from '../../scripts/sse-watcher.js';
import { resolveIdentity } from '../../scripts/leadcms-helpers.js';
import { initVerboseFromArgs } from '../../lib/logger.js';
import { parseRemoteFlag } from './remote-flag.js';

const args = process.argv.slice(2);
initVerboseFromArgs(args);
const remoteContext = parseRemoteFlag(args);
await resolveIdentity(remoteContext?.apiKey);
startSSEWatcher(remoteContext);
