/**
 * Synchronous inspection of a remote's state directory, for CLI output
 * (`remote show`, `site show`).
 */

import fs from "fs";
import path from "path";

export interface RemoteStateSummary {
  hasMetadata: boolean;
  tokens: Record<string, string>;
  sections: Record<string, unknown>;
}

const ENTITY_TYPES = [
  "content",
  "media",
  "comments",
  "email-templates",
  "segments",
  "sequences",
  "redirects",
];

/**
 * Read a remote's metadata.json without the async API. Understands the v2
 * layout (`{ version: 2, <block>: { syncToken, items } }`), the pre-v2 bare
 * layout, and pre-v2 `<type>-sync-token` files.
 */
export function readRemoteStateSync(stateDir: string): RemoteStateSummary {
  const summary: RemoteStateSummary = { hasMetadata: false, tokens: {}, sections: {} };
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(stateDir, "metadata.json"), "utf-8"));
    summary.hasMetadata = true;
    const isV2 = typeof doc.version === "number" && doc.version >= 2;
    for (const [block, value] of Object.entries(doc)) {
      if (block === "version" || !value || typeof value !== "object") continue;
      if (isV2) {
        const { syncToken, items } = value as { syncToken?: unknown; items?: unknown };
        if (typeof syncToken === "string" && syncToken) summary.tokens[block] = syncToken;
        if (items && typeof items === "object") summary.sections[block] = items;
      } else {
        summary.sections[block] = value;
      }
    }
  } catch {
    // No metadata.json
  }
  for (const entity of ENTITY_TYPES) {
    if (summary.tokens[entity]) continue;
    try {
      const token = fs.readFileSync(path.join(stateDir, `${entity}-sync-token`), "utf-8").trim();
      if (token) summary.tokens[entity] = token;
    } catch {
      // No pre-v2 token file
    }
  }
  return summary;
}

/** Number of entries in a `{ language: { key: entry } }` metadata section. */
export function countNested(section: unknown): number {
  if (!section || typeof section !== "object") return 0;
  return Object.values(section as Record<string, unknown>).reduce<number>(
    (sum, inner) => sum + Object.keys((inner as Record<string, unknown>) || {}).length,
    0
  );
}
