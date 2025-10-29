// This script generates a __env.js file with all NEXT_PUBLIC_ env variables
// Usage: node ./scripts/generate-env-js.ts
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

// Load env from .env, .env.local, etc. (dotenv will not overwrite existing process.env)
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
try {
  dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
} catch {}

const envVars: Record<string, string | undefined> = Object.keys(process.env)
  .filter((key) => key.startsWith("NEXT_PUBLIC_"))
  .reduce((acc: Record<string, string | undefined>, key) => {
    acc[key] = process.env[key];
    return acc;
  }, {});

const jsContent = `window.__env = ${JSON.stringify(envVars, null, 2)};\n`;

const outPath = path.resolve(process.cwd(), "public", "__env.js");
fs.writeFileSync(outPath, jsContent);
console.log("Generated public/__env.js with NEXT_PUBLIC_ env variables.");
