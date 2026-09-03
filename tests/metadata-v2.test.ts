/**
 * metadata.json format version 2: every entity block is `{ syncToken?, items }`,
 * so a remote's checkpoint and the items it vouches for live in one file.
 * Pre-v2 state (bare item maps + `<type>-sync-token` files) is read
 * transparently and migrated on the next write.
 */
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  clearMetadataSection,
  clearSyncToken,
  metadataMapPath,
  readMetadataMap,
  readSyncToken,
  readSyncTokens,
  writeMetadataMap,
  writeSyncToken,
  type RemoteContext,
} from "../src/lib/remote-context.js";

let tmpRoot: string;
let ctx: RemoteContext;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readFile(): Promise<Record<string, any>> {
  return JSON.parse(await fs.readFile(metadataMapPath(ctx), "utf-8"));
}

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "leadcms-meta-v2-"));
  ctx = {
    name: "prod",
    url: "https://cms.example.com",
    isDefault: true,
    stateDir: path.join(tmpRoot, "remotes", "prod"),
  };
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("metadata.json v2 layout", () => {
  it("writes version 2 with items per block and sorted keys, leaving no temp file behind", async () => {
    await writeMetadataMap(ctx, {
      content: { en: { zebra: { id: 2 }, apple: { id: 1, updatedAt: "2026-01-01T00:00:00Z" } } },
      emailTemplates: { en: { Welcome: { id: 7 } } },
      segments: { vip: { id: 3 } },
    });

    const doc = await readFile();
    expect(doc.version).toBe(2);
    expect(Object.keys(doc.content.items.en)).toEqual(["apple", "zebra"]);
    expect(doc.content.syncToken).toBeUndefined();
    expect(doc.emailTemplates).toEqual({ items: { en: { Welcome: { id: 7 } } } });
    expect(doc.segments).toEqual({ items: { vip: { id: 3 } } });
    expect(doc.media).toBeUndefined();
    expect(doc.comments).toBeUndefined();

    const files = await fs.readdir(ctx.stateDir);
    expect(files).toEqual(["metadata.json"]);
  });

  it("keeps the token next to the items it vouches for", async () => {
    await writeMetadataMap(ctx, { content: { en: { home: { id: 1 } } } });
    await writeSyncToken(ctx, "content", "content-token");
    await writeSyncToken(ctx, "media", "media-token");

    const doc = await readFile();
    expect(doc.content).toEqual({ syncToken: "content-token", items: { en: { home: { id: 1 } } } });
    expect(doc.media).toEqual({ syncToken: "media-token" });

    expect(await readSyncToken(ctx, "content")).toBe("content-token");
    expect(await readSyncToken(ctx, "media")).toBe("media-token");
    expect(await readSyncToken(ctx, "sequences")).toBeUndefined();
    expect(await readSyncTokens(ctx)).toEqual({ content: "content-token", media: "media-token" });
    expect((await readMetadataMap(ctx)).content).toEqual({ en: { home: { id: 1 } } });
  });

  it("lets a script save its map and its token in either order", async () => {
    await writeSyncToken(ctx, "sequences", "seq-token");
    await writeMetadataMap(ctx, { content: {}, sequences: { en: { Onboarding: { id: 5 } } } });

    const doc = await readFile();
    expect(doc.sequences).toEqual({ syncToken: "seq-token", items: { en: { Onboarding: { id: 5 } } } });

    const map = await readMetadataMap(ctx);
    map.sequences!.en.Renewal = { id: 6 };
    await writeMetadataMap(ctx, map);
    expect(await readSyncToken(ctx, "sequences")).toBe("seq-token");
  });

  it("clears one token without touching items, and one section without touching tokens", async () => {
    await writeMetadataMap(ctx, {
      content: { en: { home: { id: 1 } } },
      sequences: { en: { Onboarding: { id: 5 } } },
    });
    await writeSyncToken(ctx, "content", "c");
    await writeSyncToken(ctx, "sequences", "s");

    await clearSyncToken(ctx, "sequences");
    let doc = await readFile();
    expect(doc.sequences).toEqual({ items: { en: { Onboarding: { id: 5 } } } });
    expect(doc.content.syncToken).toBe("c");

    await clearMetadataSection(ctx, "sequences");
    doc = await readFile();
    expect(doc.sequences).toBeUndefined();
    expect(doc.content).toEqual({ syncToken: "c", items: { en: { home: { id: 1 } } } });
  });

  it("does not create a file when there is no token to clear", async () => {
    await clearSyncToken(ctx, "content");
    await expect(fs.access(metadataMapPath(ctx))).rejects.toThrow();
  });
});

describe("migration from pre-v2 state", () => {
  it("reads a bare metadata.json plus token files, and rewrites them as v2 on the next write", async () => {
    await fs.mkdir(ctx.stateDir, { recursive: true });
    await fs.writeFile(
      metadataMapPath(ctx),
      JSON.stringify({
        content: { en: { home: { id: 1, createdAt: "2026-01-01T00:00:00Z" } } },
        emailTemplates: { en: { Welcome: { id: 7 } } },
      }),
      "utf-8"
    );
    await fs.writeFile(path.join(ctx.stateDir, "content-sync-token"), "old-content\n", "utf8");
    await fs.writeFile(path.join(ctx.stateDir, "media-sync-token"), "old-media", "utf8");

    expect((await readMetadataMap(ctx)).content.en.home.id).toBe(1);
    expect(await readSyncTokens(ctx)).toEqual({ content: "old-content", media: "old-media" });

    // Any write migrates: tokens move into the file, the token files disappear.
    await writeSyncToken(ctx, "sequences", "new-seq");

    const doc = await readFile();
    expect(doc.version).toBe(2);
    expect(doc.content).toEqual({
      syncToken: "old-content",
      items: { en: { home: { id: 1, createdAt: "2026-01-01T00:00:00Z" } } },
    });
    expect(doc.media).toEqual({ syncToken: "old-media" });
    expect(doc.emailTemplates).toEqual({ items: { en: { Welcome: { id: 7 } } } });
    expect(doc.sequences).toEqual({ syncToken: "new-seq" });
    expect(await fs.readdir(ctx.stateDir)).toEqual(["metadata.json"]);
  });

  it("prefers the token recorded in a v2 file over a stale token file beside it", async () => {
    await writeSyncToken(ctx, "content", "from-v2");
    await fs.writeFile(path.join(ctx.stateDir, "content-sync-token"), "stale-file", "utf8");

    expect(await readSyncToken(ctx, "content")).toBe("from-v2");

    await writeMetadataMap(ctx, await readMetadataMap(ctx));
    expect(await fs.readdir(ctx.stateDir)).toEqual(["metadata.json"]);
    expect(await readSyncToken(ctx, "content")).toBe("from-v2");
  });

  it("clearing a token also removes its pre-v2 token file", async () => {
    await fs.mkdir(ctx.stateDir, { recursive: true });
    await fs.writeFile(path.join(ctx.stateDir, "media-sync-token"), "stale", "utf8");

    await clearSyncToken(ctx, "media");

    expect(await readSyncToken(ctx, "media")).toBeUndefined();
    expect(await fs.readdir(ctx.stateDir)).toEqual(["metadata.json"]);
  });
});
