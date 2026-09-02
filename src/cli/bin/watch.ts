#!/usr/bin/env node
/**
 * LeadCMS Watch CLI Entry Point
 */

import "dotenv/config";
import { watch } from "../../scripts/watch.js";
import { loadLocalConfig } from "../../lib/config.js";
import { initVerboseFromArgs } from "../../lib/logger.js";

const args = process.argv.slice(2);
initVerboseFromArgs(args);

const revisionFlag = args.indexOf("--revision-file");
const revisionFile = revisionFlag !== -1 ? args[revisionFlag + 1] : undefined;

// Watching local content needs no remote, and several modules on the remote
// path resolve the full configuration at import time — which throws when no
// `url` is set. Decide first, and only then pull them in, so `leadcms watch`
// still works on a project with no LeadCMS instance configured.
const localConfig = loadLocalConfig();
const hasRemote =
  Boolean(localConfig.url) || Object.keys(localConfig.remotes ?? {}).length > 0;
const localOnly = args.includes("--local") || !hasRemote;

const remoteContext = localOnly
  ? undefined
  : (await import("./remote-flag.js")).parseRemoteFlag(args);

await watch({ remoteContext, localOnly, revisionFile });
