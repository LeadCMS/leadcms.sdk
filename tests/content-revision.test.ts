import fs from "fs";
import os from "os";
import path from "path";

import {
  computeContentRevision,
  ensureContentRevisionFile,
  watchContentRevision,
  writeContentRevision,
} from "../src/lib/content-revision.js";

const settle = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms));

describe("content revision tracking", () => {
  let tmpRoot: string;
  let contentDir: string;
  let revisionFile: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "leadcms-revision-"));
    contentDir = path.join(tmpRoot, "content");
    revisionFile = path.join(tmpRoot, "generated", "content-revision.js");
    fs.mkdirSync(contentDir, { recursive: true });
    fs.writeFileSync(path.join(contentDir, "home.mdx"), "# home");
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe("computeContentRevision", () => {
    it("is stable while nothing changes", () => {
      expect(computeContentRevision(contentDir)).toBe(computeContentRevision(contentDir));
    });

    it("changes when a file's contents change", () => {
      const before = computeContentRevision(contentDir);
      fs.writeFileSync(path.join(contentDir, "home.mdx"), "# home edited");
      expect(computeContentRevision(contentDir)).not.toBe(before);
    });

    it("changes when a file is added or removed", () => {
      const before = computeContentRevision(contentDir);

      fs.writeFileSync(path.join(contentDir, "about.mdx"), "# about");
      const withExtra = computeContentRevision(contentDir);
      expect(withExtra).not.toBe(before);

      fs.rmSync(path.join(contentDir, "about.mdx"));
      expect(computeContentRevision(contentDir)).toBe(before);
    });

    it("covers nested directories", () => {
      const before = computeContentRevision(contentDir);
      fs.mkdirSync(path.join(contentDir, "docs"), { recursive: true });
      fs.writeFileSync(path.join(contentDir, "docs", "install.mdx"), "# install");
      expect(computeContentRevision(contentDir)).not.toBe(before);
    });

    it("returns a value for a content directory that does not exist", () => {
      expect(typeof computeContentRevision(path.join(tmpRoot, "missing"))).toBe("string");
    });
  });

  describe("writeContentRevision", () => {
    it("creates the module and reports the write", () => {
      expect(writeContentRevision("abc123", revisionFile)).toBe(true);
      expect(fs.readFileSync(revisionFile, "utf-8")).toContain('CONTENT_REVISION = "abc123"');
    });

    it("does not rewrite an unchanged file, so no needless rebuild is triggered", () => {
      writeContentRevision("abc123", revisionFile);
      expect(writeContentRevision("abc123", revisionFile)).toBe(false);
      expect(writeContentRevision("def456", revisionFile)).toBe(true);
    });
  });

  describe("ensureContentRevisionFile", () => {
    it("creates the module when absent", () => {
      ensureContentRevisionFile(revisionFile);
      expect(fs.existsSync(revisionFile)).toBe(true);
    });

    it("leaves an existing revision alone", () => {
      writeContentRevision("existing", revisionFile);
      ensureContentRevisionFile(revisionFile);
      expect(fs.readFileSync(revisionFile, "utf-8")).toContain('"existing"');
    });
  });

  describe("watchContentRevision", () => {
    it("rewrites the module when content changes", async () => {
      const changes: string[] = [];
      const stop = watchContentRevision({
        contentDir,
        revisionFile,
        debounceMs: 20,
        onChange: (revision) => changes.push(revision),
      });

      try {
        const initial = fs.readFileSync(revisionFile, "utf-8");
        fs.writeFileSync(path.join(contentDir, "home.mdx"), "# home edited");
        await settle();

        expect(changes.length).toBeGreaterThan(0);
        expect(fs.readFileSync(revisionFile, "utf-8")).not.toBe(initial);
      } finally {
        stop();
      }
    });

    it("stops reacting once stopped", async () => {
      const changes: string[] = [];
      const stop = watchContentRevision({
        contentDir,
        revisionFile,
        debounceMs: 20,
        onChange: (revision) => changes.push(revision),
      });
      stop();

      fs.writeFileSync(path.join(contentDir, "home.mdx"), "# changed after stop");
      await settle();
      expect(changes).toHaveLength(0);
    });
  });
});
