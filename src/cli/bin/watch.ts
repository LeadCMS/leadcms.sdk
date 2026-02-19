#!/usr/bin/env node
/**
 * LeadCMS SSE Watcher CLI Entry Point
 */

import { startSSEWatcher } from '../../scripts/sse-watcher.js';
import { initVerboseFromArgs } from '../../lib/logger.js';

initVerboseFromArgs();
startSSEWatcher();
