#!/usr/bin/env node
/**
 * LeadCMS Add Content CLI Entry Point
 */

import 'dotenv/config';
import { addContent } from '../../scripts/add-content.js';
import { initVerboseFromArgs } from '../../lib/logger.js';
import { parseRemoteFlag } from './remote-flag.js';

const args = process.argv.slice(2);
initVerboseFromArgs(args);
parseRemoteFlag(args);

// First positional argument is the slug
const slugArg = args.find(a => !a.startsWith('-'));

addContent({ slugArg });
