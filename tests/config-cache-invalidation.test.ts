import fs from "fs";
import os from "os";
import path from "path";

/**
 * Configuration used to be cached for 30 seconds on a timer, with no way to
 * invalidate it. During development that made JSON-backed components — header,
 * footer, form config — go stale: an edit was invisible until the TTL lapsed,
 * while MDX content updated immediately. Entries are now validated against the
 * file itself, so a change is picked up on the next call.
 */
describe("configuration cache invalidation", () => {
  let tmpRoot: string;
  let contentDir: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sdk: any;

  const configPath = () => path.join(contentDir, "header.json");

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "leadcms-config-cache-"));
    contentDir = path.join(tmpRoot, ".leadcms", "content");
    fs.mkdirSync(contentDir, { recursive: true });

    // tests/setup.ts mocks the config module onto the shared fixtures; use the
    // real implementation so this suite can point at its own temp directory.
    jest.resetModules();
    jest.unmock("../src/lib/config");
    process.env.LEADCMS_CONTENT_DIR = contentDir;
    process.env.LEADCMS_DEFAULT_LANGUAGE = "en";

    sdk = await import("../src/lib/cms.js");
    sdk.clearContentCache();
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const write = (value: unknown) =>
    fs.writeFileSync(configPath(), JSON.stringify(value, null, 2));

  it("returns the new value after the file is edited", () => {
    write({ title: "before" });
    expect(sdk.loadContentConfig("header", "en")).toEqual({ title: "before" });

    write({ title: "after" });
    expect(sdk.loadContentConfig("header", "en")).toEqual({ title: "after" });
  });

  it("notices an edit made within the same second", () => {
    // mtime has one-second granularity on some filesystems, so the cache
    // signature includes size as well.
    write({ title: "a" });
    expect(sdk.loadContentConfig("header", "en")).toEqual({ title: "a" });

    write({ title: "aa" });
    expect(sdk.loadContentConfig("header", "en")).toEqual({ title: "aa" });
  });

  it("picks up a configuration file that appears after a failed lookup", () => {
    expect(sdk.loadContentConfig("header", "en")).toBeNull();

    write({ title: "created later" });
    expect(sdk.loadContentConfig("header", "en")).toEqual({ title: "created later" });
  });

  it("reports a configuration file that is deleted", () => {
    write({ title: "present" });
    expect(sdk.loadContentConfig("header", "en")).toEqual({ title: "present" });

    fs.rmSync(configPath());
    expect(sdk.loadContentConfig("header", "en")).toBeNull();
  });

  it("still serves repeated reads from cache while the file is unchanged", () => {
    write({ title: "cached" });
    expect(sdk.loadContentConfig("header", "en")).toEqual({ title: "cached" });

    const readFileSync = jest.spyOn(fs, "readFileSync");
    try {
      sdk.loadContentConfig("header", "en");
      sdk.loadContentConfig("header", "en");
      const reads = readFileSync.mock.calls.filter(([file]) => String(file) === configPath());
      expect(reads).toHaveLength(0);
    } finally {
      readFileSync.mockRestore();
    }
  });

  it("clearContentCache forces the next read to hit disk", () => {
    write({ title: "cached" });
    expect(sdk.loadContentConfig("header", "en")).toEqual({ title: "cached" });

    sdk.clearContentCache();

    const readFileSync = jest.spyOn(fs, "readFileSync");
    try {
      sdk.loadContentConfig("header", "en");
      const reads = readFileSync.mock.calls.filter(([file]) => String(file) === configPath());
      expect(reads.length).toBeGreaterThan(0);
    } finally {
      readFileSync.mockRestore();
    }
  });
});
