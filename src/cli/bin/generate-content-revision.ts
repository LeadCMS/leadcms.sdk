#!/usr/bin/env node
/**
 * LeadCMS Generate Content Revision CLI Entry Point
 *
 * Creates the revision module if it is missing, so production builds can import
 * it like any other module. Run it from a `prebuild` step.
 */

import "dotenv/config";
import { loadLocalConfig } from "../../lib/config.js";
import {
  DEFAULT_CONTENT_REVISION_FILE,
  ensureContentRevisionFile,
} from "../../lib/content-revision.js";

const args = process.argv.slice(2);
const flag = args.indexOf("--revision-file");
const revisionFile =
  flag !== -1 && args[flag + 1]
    ? args[flag + 1]
    : (loadLocalConfig().contentRevisionFile ?? DEFAULT_CONTENT_REVISION_FILE);

ensureContentRevisionFile(revisionFile);
console.log(`Ensured content revision module at ${revisionFile}`);
