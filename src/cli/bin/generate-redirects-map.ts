#!/usr/bin/env node
/**
 * LeadCMS Generate Redirects Map CLI Entry Point
 *
 * Works entirely from local redirects.yaml — no remote connection required.
 * Writes {outputDir}/301.map and {outputDir}/302.map with bare "from" "to" pairs.
 */

import "dotenv/config";
import { generateRedirectsMap } from "../../scripts/generate-redirects-map.js";
import { initVerboseFromArgs } from "../../lib/logger.js";
import { startSpinner } from "../../lib/spinner.js";

const args = process.argv.slice(2);
initVerboseFromArgs(args);

const dryRun = args.includes("--dry-run") || args.includes("-d") || args.includes("-n");

// Parse --output <dir> / -o <dir> flag
let outputDir: string | undefined;
const outputIdx = args.findIndex((a) => a === "--output" || a === "-o");
if (outputIdx !== -1 && args[outputIdx + 1]) {
  outputDir = args[outputIdx + 1];
}

// Parse --language <lang> flag
let language: string | undefined;
const langIdx = args.findIndex((a) => a === "--language" || a === "-l");
if (langIdx !== -1 && args[langIdx + 1]) {
  language = args[langIdx + 1];
}

const spinner = startSpinner("Generating redirect map files…");
generateRedirectsMap({ outputDir, language, dryRun })
  .then(() => {
    spinner.stop();
    process.exit(0);
  })
  .catch((error: unknown) => {
    spinner.fail("Redirect map generation failed");
    console.error((error as Error).message);
    process.exit(1);
  });
