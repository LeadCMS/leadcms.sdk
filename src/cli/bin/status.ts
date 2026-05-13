#!/usr/bin/env node
/**
 * LeadCMS Status CLI Entry Point
 */

import "dotenv/config";
import { statusLeadCMSContent } from "../../scripts/status-leadcms-content.js";
import { resolveIdentity } from "../../scripts/leadcms-helpers.js";
import { initVerboseFromArgs } from "../../lib/logger.js";
import { parseRemoteFlag } from "./remote-flag.js";

const args = process.argv.slice(2);
initVerboseFromArgs(args);
const remoteContext = parseRemoteFlag(args);
await resolveIdentity(remoteContext?.apiKey);
statusLeadCMSContent().catch((error: unknown) => {
  console.error("Error running LeadCMS status:", (error as Error).message);
  process.exit(1);
});
