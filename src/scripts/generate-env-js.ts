// This script generates a __env.js file with all NEXT_PUBLIC_ env variables
// Usage: node ./scripts/generate-env-js.ts
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

// Load env from .env, .env.local, etc. (dotenv will not overwrite existing process.env)
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
try {
  dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
} catch { }

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

// Only run when executed directly (not when imported for testing)
const isDirectRun = typeof require !== 'undefined' && require.main === module;
if (isDirectRun) {
  const envVars = filterEnvVars(process.env);
  const jsContent = generateEnvJsContent(envVars);

  const outPath = path.resolve(process.cwd(), "public", "__env.js");
  fs.writeFileSync(outPath, jsContent);
  console.log("Generated public/__env.js with NEXT_PUBLIC_ env variables.");
}
