/**
 * Read and write the raw leadcms config file from CLI commands that edit it
 * (`remote add`, `site add`, …). The SDK's config loader caches the file for
 * a minute; commands that write it exit right after, so that is fine.
 */

import fs from "fs";
import path from "path";
import type { LeadCMSConfigFile } from "../../lib/site-context.js";

export const DEFAULT_CONFIG_FILE_NAME = "leadcms.config.json";

/** Path of the project's config file, or null when none exists. */
export function findConfigPath(): string | null {
  const candidates = [DEFAULT_CONFIG_FILE_NAME, "leadcms.config.js"];

  for (const name of candidates) {
    const fullPath = path.resolve(name);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }

  return null;
}

/** Parse the raw config file. Keys the SDK does not know are preserved. */
export function readRawConfig(configPath: string): LeadCMSConfigFile & Record<string, unknown> {
  return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}

/** Write the config file back with the project's usual formatting. */
export function writeRawConfig(configPath: string, rawConfig: unknown): void {
  fs.writeFileSync(configPath, JSON.stringify(rawConfig, null, 2) + "\n", "utf-8");
}

/** Project-relative display form of an absolute path. */
export function displayPath(absolutePath: string): string {
  const relative = path.relative(process.cwd(), absolutePath);
  return relative && !relative.startsWith("..") ? relative : absolutePath;
}
