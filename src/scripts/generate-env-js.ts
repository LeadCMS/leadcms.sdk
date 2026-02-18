// This script generates a __env.js file with all NEXT_PUBLIC_ env variables
// Usage: node ./scripts/generate-env-js.ts
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

/**
 * Filter environment variables by prefix (e.g. NEXT_PUBLIC_)
 */
export function filterEnvVars(env: Record<string, string | undefined>, prefix: string = "NEXT_PUBLIC_"): Record<string, string | undefined> {
  return Object.keys(env)
    .filter((key) => key.startsWith(prefix))
    .reduce((acc: Record<string, string | undefined>, key) => {
      acc[key] = env[key];
      return acc;
    }, {});
}

/**
 * Generate the window.__env JS content string
 */
export function generateEnvJsContent(vars: Record<string, string | undefined>): string {
  return `window.__env = ${JSON.stringify(vars, null, 2)};\n`;
}

/**
 * Generate a __env.js file with all environment variables matching the prefix.
 * Loads .env and .env.local files, filters by prefix, and writes to public/__env.js.
 */
export function generateEnv(prefix: string = "NEXT_PUBLIC_"): void {
  // Load env from .env, .env.local, etc. (dotenv will not overwrite existing process.env)
  dotenv.config({ path: path.resolve(process.cwd(), ".env") });
  try {
    dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
  } catch { }

  const envVars = filterEnvVars(process.env, prefix);
  const jsContent = generateEnvJsContent(envVars);

  const outPath = path.resolve(process.cwd(), "public", "__env.js");
  fs.writeFileSync(outPath, jsContent);
  console.log("Generated public/__env.js with NEXT_PUBLIC_ env variables.");
}
