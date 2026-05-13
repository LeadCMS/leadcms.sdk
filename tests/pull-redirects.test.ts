/**
 * Tests for pull-redirects.ts
 *
 * Covers:
 *  - mergeRedirects logic (upsert, deletions)
 *  - toLocalRedirect mapping (field preservation, isAutoDiscovered flag)
 *  - YAML file format (redirects sorted by id)
 *  - detectSourceType / detectTargetType helpers
 *  - pullLeadCMSRedirects integration (axios mocked, real temp FS)
 */

import fs from "fs/promises";
import path from "path";
import os from "os";
import yaml from "js-yaml";

// ── Shared mutable state for test control ─────────────────────────────
let redirectsDir = "/tmp/test-redirects";
let stateDirForTest = "/tmp/test-redirects-state";

/** In-memory metadata store keyed by stateDir path. Reset in beforeEach. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const metadataStore = new Map<string, any>();

jest.mock("../src/scripts/leadcms-helpers.js", () => ({
  get REDIRECTS_DIR() {
    return redirectsDir;
  },
  leadCMSUrl: "https://test.leadcms.com",
  leadCMSApiKey: "test-api-key",
  defaultLanguage: "en",
}));

jest.mock("../src/lib/remote-context.js", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  syncTokenPath: (ctx: any, entityType: string) =>
    require("path").join(ctx.stateDir, `${entityType}-sync-token`),
  resolveRemote: () => ({
    name: "default",
    url: "https://test.leadcms.com",
    isDefault: true,
    get stateDir() {
      return stateDirForTest;
    },
  }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readMetadataMap: async (ctx: any) =>
    metadataStore.get(ctx.stateDir) ?? { content: {}, redirects: {} },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  writeMetadataMap: async (ctx: any, map: any) => metadataStore.set(ctx.stateDir, map),
}));

const mockAxiosGet = jest.fn();
const mockAxiosPost = jest.fn();
jest.mock("axios", () => ({
  __esModule: true,
  default: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get: (...args: any[]) => mockAxiosGet(...args),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    post: (...args: any[]) => mockAxiosPost(...args),
    create: jest.fn(),
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get: (...args: any[]) => mockAxiosGet(...args),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  post: (...args: any[]) => mockAxiosPost(...args),
}));

// Must come after mocks
import {
  detectSourceType,
  detectTargetType,
  toLocalRedirect,
  buildRedirectsFile,
  flattenRedirectsFile,
} from "../src/lib/automation-types";
import type {
  RedirectDetailsDto,
  LocalRedirect,
  LocalRedirectsFile,
} from "../src/lib/automation-types";

// ── Test data helpers ─────────────────────────────────────────────────

function makeDto(overrides: Partial<RedirectDetailsDto> = {}): RedirectDetailsDto {
  return {
    id: 1,
    sourceType: "InternalPath",
    targetType: "ExternalUrl",
    kind: "Permanent",
    fromPath: "/old-path",
    fromLanguage: null,
    fromSlug: null,
    fromContentId: null,
    toUrl: "https://example.com",
    toPath: null,
    toLanguage: null,
    toSlug: null,
    toContentId: null,
    isAutoDiscovered: false,
    isAutoDiscoverySuppressed: false,
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: null,
    ...overrides,
  };
}

// ── Unit: detectSourceType ────────────────────────────────────────────

describe("detectSourceType", () => {
  it("returns InternalPath when fromPath is set", () => {
    const r: LocalRedirect = { kind: "Permanent", fromPath: "/about" };
    expect(detectSourceType(r)).toBe("InternalPath");
  });

  it("returns ContentId when fromContentId is set (and no fromPath)", () => {
    const r: LocalRedirect = { kind: "Permanent", fromContentId: 42 };
    expect(detectSourceType(r)).toBe("ContentId");
  });

  it("returns ContentSlug when fromLanguage+fromSlug are set", () => {
    const r: LocalRedirect = { kind: "Permanent", fromLanguage: "en", fromSlug: "my-article" };
    expect(detectSourceType(r)).toBe("ContentSlug");
  });
});

// ── Unit: detectTargetType ────────────────────────────────────────────

describe("detectTargetType", () => {
  it("returns ExternalUrl when toUrl is set", () => {
    const r: LocalRedirect = { kind: "Permanent", toUrl: "https://example.com" };
    expect(detectTargetType(r)).toBe("ExternalUrl");
  });

  it("returns InternalPath when toPath is set", () => {
    const r: LocalRedirect = { kind: "Permanent", toPath: "/new-path" };
    expect(detectTargetType(r)).toBe("InternalPath");
  });

  it("returns ContentId when toContentId is set", () => {
    const r: LocalRedirect = { kind: "Permanent", toContentId: 10 };
    expect(detectTargetType(r)).toBe("ContentId");
  });

  it("returns ContentSlug otherwise", () => {
    const r: LocalRedirect = { kind: "Permanent", toLanguage: "en", toSlug: "new-article" };
    expect(detectTargetType(r)).toBe("ContentSlug");
  });
});

// ── Unit: toLocalRedirect ─────────────────────────────────────────────

describe("toLocalRedirect", () => {
  it("maps all non-null fields from DTO", () => {
    const dto = makeDto({
      id: 5,
      kind: "Temporary",
      fromPath: "/old",
      toUrl: "https://example.com/new",
      updatedAt: "2024-06-01T00:00:00Z",
    });
    const local = toLocalRedirect(dto);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((local as any).id).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((local as any).createdAt).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((local as any).updatedAt).toBeUndefined();
    expect(local.kind).toBe("Temporary");
    expect(local.fromPath).toBe("/old");
    expect(local.toUrl).toBe("https://example.com/new");
  });

  it("does not include null fields in the output", () => {
    const dto = makeDto({ fromPath: null, toUrl: null, toPath: "/new" });
    const local = toLocalRedirect(dto);
    expect(local.fromPath).toBeUndefined();
    expect(local.toUrl).toBeUndefined();
    expect(local.toPath).toBe("/new");
  });

  it("handles ContentSlug type with language and slug", () => {
    const dto = makeDto({
      sourceType: "ContentSlug",
      targetType: "ContentSlug",
      fromPath: null,
      fromLanguage: "en",
      fromSlug: "old-article",
      toUrl: null,
      toLanguage: "en",
      toSlug: "new-article",
    });
    const local = toLocalRedirect(dto);
    expect(local.fromLanguage).toBe("en");
    expect(local.fromSlug).toBe("old-article");
    expect(local.toLanguage).toBe("en");
    expect(local.toSlug).toBe("new-article");
  });
});

// ── Integration: pullLeadCMSRedirects ─────────────────────────────────

describe("pullLeadCMSRedirects", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "leadcms-redirects-test-"));
    redirectsDir = tmpDir;
    stateDirForTest = tmpDir;
    metadataStore.clear();
    mockAxiosGet.mockReset();
    mockAxiosPost.mockReset();
    mockAxiosPost.mockResolvedValue({ status: 200, data: {} });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates redirects.yaml when syncing new items", async () => {
    const dto = makeDto({
      id: 1,
      kind: "Permanent",
      fromPath: "/old",
      toUrl: "https://example.com",
    });

    mockAxiosGet
      .mockResolvedValueOnce({
        status: 200,
        data: { items: [dto], deleted: [] },
        headers: { "x-next-sync-token": "token-abc" },
      })
      .mockResolvedValueOnce({ status: 204, data: {}, headers: {} });

    const { pullLeadCMSRedirects } = await import("../src/scripts/pull-redirects");
    await pullLeadCMSRedirects();

    const filePath = path.join(tmpDir, "redirects.yaml");
    const raw = await fs.readFile(filePath, "utf8");
    const file = yaml.load(raw) as LocalRedirectsFile;
    const items = flattenRedirectsFile(file);

    expect(items).toHaveLength(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((items[0] as any).id).toBeUndefined();
    expect(items[0].fromPath).toBe("/old");
    expect(items[0].toUrl).toBe("https://example.com");
  });

  it("persists sync token to .sync-token file", async () => {
    mockAxiosGet
      .mockResolvedValueOnce({
        status: 200,
        data: { items: [makeDto()], deleted: [] },
        headers: { "x-next-sync-token": "my-token-xyz" },
      })
      .mockResolvedValueOnce({ status: 204, data: {}, headers: {} });

    const { pullLeadCMSRedirects } = await import("../src/scripts/pull-redirects");
    await pullLeadCMSRedirects();

    const tokenPath = path.join(tmpDir, ".sync-token");
    const token = await fs.readFile(tokenPath, "utf8");
    expect(token).toBe("my-token-xyz");
  });

  it("merges incoming items with existing YAML", async () => {
    // Pre-populate with an existing redirect (no id in local YAML)
    const existingFile = buildRedirectsFile([
      { kind: "Permanent", fromPath: "/existing", toPath: "/new-existing" },
    ]);
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(path.join(tmpDir, "redirects.yaml"), yaml.dump(existingFile), "utf8");

    const incoming = makeDto({
      id: 20,
      kind: "Temporary",
      fromPath: "/another",
      toUrl: "https://x.com",
    });
    mockAxiosGet
      .mockResolvedValueOnce({
        status: 200,
        data: { items: [incoming], deleted: [] },
        headers: { "x-next-sync-token": "token-2" },
      })
      .mockResolvedValueOnce({ status: 204, data: {}, headers: {} });

    const { pullLeadCMSRedirects } = await import("../src/scripts/pull-redirects");
    await pullLeadCMSRedirects();

    const raw = await fs.readFile(path.join(tmpDir, "redirects.yaml"), "utf8");
    const merged = flattenRedirectsFile(yaml.load(raw) as LocalRedirectsFile);

    const paths = merged.map((r) => r.fromPath);
    expect(paths).toContain("/existing");
    expect(paths).toContain("/another");
  });

  it("removes deleted redirect IDs from local YAML", async () => {
    // Local YAML has no ids — surrogate keys are path:/a and path:/c
    const existingFile = buildRedirectsFile([
      { kind: "Permanent", fromPath: "/a", toPath: "/b" },
      { kind: "Permanent", fromPath: "/c", toPath: "/d" },
    ]);
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(path.join(tmpDir, "redirects.yaml"), yaml.dump(existingFile), "utf8");
    // Pre-populate id-map via in-memory metadata store
    metadataStore.set(tmpDir, { content: {}, redirects: { "path:/a": 1, "path:/c": 2 } });

    mockAxiosGet
      .mockResolvedValueOnce({
        status: 200,
        data: { items: [], deleted: [1] },
        headers: { "x-next-sync-token": "token-del" },
      })
      .mockResolvedValueOnce({ status: 204, data: {}, headers: {} });

    const { pullLeadCMSRedirects } = await import("../src/scripts/pull-redirects");
    await pullLeadCMSRedirects();

    const raw = await fs.readFile(path.join(tmpDir, "redirects.yaml"), "utf8");
    const items = flattenRedirectsFile(yaml.load(raw) as LocalRedirectsFile);

    expect(items).toHaveLength(1);
    expect(items[0].fromPath).toBe("/c");
  });

  it("sorts redirects by surrogate key in the output file", async () => {
    const dtos = [
      makeDto({ id: 30, fromPath: "/z", toPath: "/a" }),
      makeDto({ id: 5, fromPath: "/a", toPath: "/b" }),
      makeDto({ id: 15, fromPath: "/m", toPath: "/n" }),
    ];

    mockAxiosGet
      .mockResolvedValueOnce({
        status: 200,
        data: { items: dtos, deleted: [] },
        headers: { "x-next-sync-token": "token-sort" },
      })
      .mockResolvedValueOnce({ status: 204, data: {}, headers: {} });

    const { pullLeadCMSRedirects } = await import("../src/scripts/pull-redirects");
    await pullLeadCMSRedirects();

    const raw = await fs.readFile(path.join(tmpDir, "redirects.yaml"), "utf8");
    const items = flattenRedirectsFile(yaml.load(raw) as LocalRedirectsFile);
    // Surrogate keys: path:/z, path:/a, path:/m → sorted: path:/a, path:/m, path:/z
    const paths = items.map((r) => r.fromPath);
    expect(paths).toEqual(["/a", "/m", "/z"]);
  });

  it("does not write file if no changes (204 immediately)", async () => {
    // Pre-populate
    const existingFile = buildRedirectsFile([{ kind: "Permanent", fromPath: "/a", toPath: "/b" }]);
    await fs.mkdir(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, "redirects.yaml");
    await fs.writeFile(filePath, yaml.dump(existingFile), "utf8");
    const statBefore = await fs.stat(filePath);

    mockAxiosGet.mockResolvedValueOnce({ status: 204, data: {}, headers: {} });

    const { pullLeadCMSRedirects } = await import("../src/scripts/pull-redirects");
    await pullLeadCMSRedirects();

    const statAfter = await fs.stat(filePath);
    // mtime should be the same if file wasn't rewritten
    expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
  });

  it("triggers discover before sync (POST before GET)", async () => {
    mockAxiosGet.mockResolvedValueOnce({ status: 204, data: {}, headers: {} });

    const { pullLeadCMSRedirects } = await import("../src/scripts/pull-redirects");
    await pullLeadCMSRedirects();

    expect(mockAxiosPost).toHaveBeenCalledWith(
      expect.stringContaining("/api/redirects/discover"),
      null,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer test-api-key" }),
      })
    );
    expect(mockAxiosGet).toHaveBeenCalledWith(
      expect.stringContaining("/api/redirects/sync"),
      expect.any(Object)
    );
  });

  it("continues even if discover fails (best-effort)", async () => {
    mockAxiosPost.mockRejectedValueOnce(new Error("network error"));
    mockAxiosGet.mockResolvedValueOnce({ status: 204, data: {}, headers: {} });

    const { pullLeadCMSRedirects } = await import("../src/scripts/pull-redirects");
    await expect(pullLeadCMSRedirects()).resolves.not.toThrow();
  });

  it("passes syncToken from file to the sync request", async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(path.join(tmpDir, ".sync-token"), "previous-token", "utf8");

    mockAxiosGet.mockResolvedValueOnce({ status: 204, data: {}, headers: {} });

    const { pullLeadCMSRedirects } = await import("../src/scripts/pull-redirects");
    await pullLeadCMSRedirects();

    const callUrl: string = mockAxiosGet.mock.calls[0][0];
    expect(callUrl).toContain("syncToken=previous-token");
  });

  it("paginates through multiple sync pages", async () => {
    const dto1 = makeDto({ id: 1, fromPath: "/a", toPath: "/b" });
    const dto2 = makeDto({ id: 2, fromPath: "/c", toPath: "/d" });

    mockAxiosGet
      .mockResolvedValueOnce({
        status: 200,
        data: { items: [dto1], deleted: [] },
        headers: { "x-next-sync-token": "page-2" },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: { items: [dto2], deleted: [] },
        headers: { "x-next-sync-token": "page-3" },
      })
      .mockResolvedValueOnce({ status: 204, data: {}, headers: {} });

    const { pullLeadCMSRedirects } = await import("../src/scripts/pull-redirects");
    await pullLeadCMSRedirects();

    const raw = await fs.readFile(path.join(tmpDir, "redirects.yaml"), "utf8");
    const items = flattenRedirectsFile(yaml.load(raw) as LocalRedirectsFile);
    expect(items).toHaveLength(2);
  });

  // ── Language folder structure ─────────────────────────────────────

  it("writes non-default-language redirect to language subfolder", async () => {
    const dto = makeDto({
      id: 10,
      sourceType: "ContentSlug",
      targetType: "ContentSlug",
      fromPath: null,
      fromLanguage: "de",
      fromSlug: "de-artikel",
      toUrl: null,
      toLanguage: "de",
      toSlug: "de-neuer-artikel",
    });

    mockAxiosGet
      .mockResolvedValueOnce({
        status: 200,
        data: { items: [dto], deleted: [] },
        headers: { "x-next-sync-token": "token-lang" },
      })
      .mockResolvedValueOnce({ status: 204, data: {}, headers: {} });

    const { pullLeadCMSRedirects } = await import("../src/scripts/pull-redirects");
    await pullLeadCMSRedirects();

    // Must exist in de subfolder
    const langFilePath = path.join(tmpDir, "de", "redirects.yaml");
    const raw = await fs.readFile(langFilePath, "utf8");
    const items = flattenRedirectsFile(yaml.load(raw) as LocalRedirectsFile);

    expect(items).toHaveLength(1);
    // fromLanguage is stripped from file (implied by folder)
    expect(items[0].fromLanguage).toBeUndefined();
    // toLanguage is stripped when equal to folder language
    expect(items[0].toLanguage).toBeUndefined();
    expect(items[0].fromSlug).toBe("de-artikel");
    // Default folder should have no content
    await expect(
      fs.readFile(path.join(tmpDir, "redirects.yaml"), "utf8")
    ).rejects.toThrow();
  });

  it("writes default-language redirect to root folder, strips fromLanguage", async () => {
    const dto = makeDto({
      id: 11,
      sourceType: "ContentSlug",
      targetType: "ContentSlug",
      fromPath: null,
      fromLanguage: "en",
      fromSlug: "en-article",
      toUrl: null,
      toLanguage: "en",
      toSlug: "en-new-article",
    });

    mockAxiosGet
      .mockResolvedValueOnce({
        status: 200,
        data: { items: [dto], deleted: [] },
        headers: { "x-next-sync-token": "token-en" },
      })
      .mockResolvedValueOnce({ status: 204, data: {}, headers: {} });

    const { pullLeadCMSRedirects } = await import("../src/scripts/pull-redirects");
    await pullLeadCMSRedirects();

    const raw = await fs.readFile(path.join(tmpDir, "redirects.yaml"), "utf8");
    const items = flattenRedirectsFile(yaml.load(raw) as LocalRedirectsFile);

    expect(items).toHaveLength(1);
    // fromLanguage and toLanguage stripped (both equal to folder language "en")
    expect(items[0].fromLanguage).toBeUndefined();
    expect(items[0].toLanguage).toBeUndefined();
    expect(items[0].fromSlug).toBe("en-article");
    // No de subfolder created
    await expect(fs.access(path.join(tmpDir, "de"))).rejects.toThrow();
  });

  it("keeps toLanguage when it differs from fromLanguage (cross-language redirect)", async () => {
    const dto = makeDto({
      id: 12,
      sourceType: "ContentSlug",
      targetType: "ContentSlug",
      fromPath: null,
      fromLanguage: "de",
      fromSlug: "de-artikel",
      toUrl: null,
      toLanguage: "en",
      toSlug: "en-article",
    });

    mockAxiosGet
      .mockResolvedValueOnce({
        status: 200,
        data: { items: [dto], deleted: [] },
        headers: { "x-next-sync-token": "token-cross" },
      })
      .mockResolvedValueOnce({ status: 204, data: {}, headers: {} });

    const { pullLeadCMSRedirects } = await import("../src/scripts/pull-redirects");
    await pullLeadCMSRedirects();

    const langFilePath = path.join(tmpDir, "de", "redirects.yaml");
    const raw = await fs.readFile(langFilePath, "utf8");
    const items = flattenRedirectsFile(yaml.load(raw) as LocalRedirectsFile);

    expect(items).toHaveLength(1);
    // fromLanguage stripped (implied by de/ folder)
    expect(items[0].fromLanguage).toBeUndefined();
    // toLanguage kept because it differs from folder language "de"
    expect(items[0].toLanguage).toBe("en");
    expect(items[0].toSlug).toBe("en-article");
  });

  it("splits mixed-language redirects into separate folder files", async () => {
    const dtoEn = makeDto({
      id: 1,
      sourceType: "ContentSlug",
      targetType: "InternalPath",
      fromPath: null,
      fromLanguage: "en",
      fromSlug: "en-article",
      toUrl: null,
      toPath: "/en-dest",
    });
    const dtoDe = makeDto({
      id: 2,
      sourceType: "ContentSlug",
      targetType: "InternalPath",
      fromPath: null,
      fromLanguage: "de",
      fromSlug: "de-artikel",
      toUrl: null,
      toPath: "/de-dest",
    });
    const dtoPath = makeDto({ id: 3, fromPath: "/static", toPath: "/new-static" });

    mockAxiosGet
      .mockResolvedValueOnce({
        status: 200,
        data: { items: [dtoEn, dtoDe, dtoPath], deleted: [] },
        headers: { "x-next-sync-token": "token-mixed" },
      })
      .mockResolvedValueOnce({ status: 204, data: {}, headers: {} });

    const { pullLeadCMSRedirects } = await import("../src/scripts/pull-redirects");
    await pullLeadCMSRedirects();

    // Default folder: en (language-agnostic stripped) + path-based
    const defaultRaw = await fs.readFile(path.join(tmpDir, "redirects.yaml"), "utf8");
    const defaultItems = flattenRedirectsFile(yaml.load(defaultRaw) as LocalRedirectsFile);
    expect(defaultItems).toHaveLength(2);
    const slugs = defaultItems.map((r) => r.fromSlug ?? r.fromPath);
    expect(slugs).toContain("en-article");
    expect(slugs).toContain("/static");

    // de/ folder: de redirect only
    const deRaw = await fs.readFile(path.join(tmpDir, "de", "redirects.yaml"), "utf8");
    const deItems = flattenRedirectsFile(yaml.load(deRaw) as LocalRedirectsFile);
    expect(deItems).toHaveLength(1);
    expect(deItems[0].fromSlug).toBe("de-artikel");
  });

  it("cleans up stale language folder when all its redirects are deleted", async () => {
    // Pre-populate: one de redirect in de/ subfolder
    await fs.mkdir(path.join(tmpDir, "de"), { recursive: true });
    const existingFile = buildRedirectsFile([
      { kind: "Permanent", fromSlug: "de-artikel", toPath: "/de-dest" },
    ]);
    await fs.writeFile(
      path.join(tmpDir, "de", "redirects.yaml"),
      yaml.dump(existingFile),
      "utf8"
    );
    metadataStore.set(tmpDir, { content: {}, redirects: { "slug:de/de-artikel": 99 } });

    // Remote deletes it
    mockAxiosGet
      .mockResolvedValueOnce({
        status: 200,
        data: { items: [], deleted: [99] },
        headers: { "x-next-sync-token": "token-cleanup" },
      })
      .mockResolvedValueOnce({ status: 204, data: {}, headers: {} });

    const { pullLeadCMSRedirects } = await import("../src/scripts/pull-redirects");
    await pullLeadCMSRedirects();

    // de/redirects.yaml should be deleted
    await expect(
      fs.readFile(path.join(tmpDir, "de", "redirects.yaml"), "utf8")
    ).rejects.toThrow();
  });

  it("reads existing redirects from language subfolders on merge", async () => {
    // Pre-populate: de/ subfolder already has a redirect (fromLanguage stripped, implied by folder)
    await fs.mkdir(path.join(tmpDir, "de"), { recursive: true });
    const deFile = buildRedirectsFile([
      { kind: "Permanent", fromSlug: "alt-artikel", toPath: "/de-dest" },
    ]);
    await fs.writeFile(path.join(tmpDir, "de", "redirects.yaml"), yaml.dump(deFile), "utf8");

    // Sync brings in a new en redirect
    const dtoEn = makeDto({
      id: 5,
      sourceType: "ContentSlug",
      targetType: "InternalPath",
      fromPath: null,
      fromLanguage: "en",
      fromSlug: "new-article",
      toUrl: null,
      toPath: "/en-dest",
    });

    mockAxiosGet
      .mockResolvedValueOnce({
        status: 200,
        data: { items: [dtoEn], deleted: [] },
        headers: { "x-next-sync-token": "token-merge" },
      })
      .mockResolvedValueOnce({ status: 204, data: {}, headers: {} });

    const { pullLeadCMSRedirects } = await import("../src/scripts/pull-redirects");
    await pullLeadCMSRedirects();

    // de redirect must still be there
    const deRaw = await fs.readFile(path.join(tmpDir, "de", "redirects.yaml"), "utf8");
    const deItems = flattenRedirectsFile(yaml.load(deRaw) as LocalRedirectsFile);
    expect(deItems.map((r) => r.fromSlug)).toContain("alt-artikel");

    // en redirect is in default folder
    const enRaw = await fs.readFile(path.join(tmpDir, "redirects.yaml"), "utf8");
    const enItems = flattenRedirectsFile(yaml.load(enRaw) as LocalRedirectsFile);
    expect(enItems.map((r) => r.fromSlug)).toContain("new-article");
  });
});
