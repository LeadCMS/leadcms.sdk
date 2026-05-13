#!/usr/bin/env node
/**
 * LeadCMS Push Redirects CLI Entry Point
 */

import "dotenv/config";
import { pushRedirects } from "../../scripts/push-redirects.js";
import { requireAuthenticatedUser, resolveIdentity } from "../../scripts/leadcms-helpers.js";
import { initVerboseFromArgs } from "../../lib/logger.js";
import { startSpinner } from "../../lib/spinner.js";
import { parseRemoteFlag } from "./remote-flag.js";

const args = process.argv.slice(2);
initVerboseFromArgs(args);
const remoteContext = parseRemoteFlag(args);

const force = args.includes("--force") || args.includes("-f");
const dryRun = args.includes("--dry-run") || args.includes("-d");
const allowDelete = args.includes("--delete");

if (!dryRun) {
  await requireAuthenticatedUser();
} else {
  await resolveIdentity();
}

const spinner = startSpinner("Pushing redirects to LeadCMS…");
pushRedirects({ force, dryRun, allowDelete, remoteContext })
  .then(() => {
    spinner.stop();
    process.exit(0);
  })
  .catch((error: unknown) => {
    spinner.fail("Redirect push failed");
    console.error((error as Error).message);
    process.exit(1);
  });
