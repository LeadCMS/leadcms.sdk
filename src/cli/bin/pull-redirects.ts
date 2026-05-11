#!/usr/bin/env node
/**
 * LeadCMS Pull Redirects CLI Entry Point
 */

import { pullLeadCMSRedirects } from "../../scripts/pull-redirects.js";
import { resolveIdentity } from "../../scripts/leadcms-helpers.js";
import { initVerboseFromArgs } from "../../lib/logger.js";
import { startSpinner } from "../../lib/spinner.js";
import { parseRemoteFlag } from "./remote-flag.js";

const args = process.argv.slice(2);
initVerboseFromArgs(args);
const remoteContext = parseRemoteFlag(args);
const reset = args.includes("--reset");

await resolveIdentity();

const spinner = startSpinner("Pulling redirects from LeadCMS…");
pullLeadCMSRedirects({ reset, remoteContext })
  .then(() => {
    spinner.stop();
    process.exit(0);
  })
  .catch((error: unknown) => {
    spinner.fail("Redirect pull failed");
    console.error((error as Error).message);
    process.exit(1);
  });
