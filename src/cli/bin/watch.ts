#!/usr/bin/env node
/**
 * LeadCMS SSE Watcher CLI Entry Point
 */

import { startSSEWatcher } from '../../scripts/sse-watcher.js';
import { resolveIdentity } from '../../scripts/leadcms-helpers.js';
import { initVerboseFromArgs } from '../../lib/logger.js';

initVerboseFromArgs();
await resolveIdentity();
startSSEWatcher();
