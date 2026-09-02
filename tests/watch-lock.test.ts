import fs from "fs";
import os from "os";
import path from "path";

import {
  acquireContentWatchLock,
  contentWatchLockPath,
  readContentWatchLock,
} from "../src/lib/watch-lock.js";

/**
 * Only one process should watch a content directory. A preview container
 * commonly supervises `leadcms watch` separately from the dev server, and
 * wiring both would put two recursive watchers on the same tree.
 */
describe("content watch lock", () => {
  let tmpRoot: string;
  let contentDir: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "leadcms-watch-lock-"));
    contentDir = path.join(tmpRoot, "content");
    fs.mkdirSync(contentDir, { recursive: true });
    try {
      fs.unlinkSync(contentWatchLockPath(contentDir));
    } catch {
      /* not held */
    }
  });

  afterEach(() => {
    try {
      fs.unlinkSync(contentWatchLockPath(contentDir));
    } catch {
      /* already released */
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("grants the lock when nothing holds it", () => {
    const lock = acquireContentWatchLock(contentDir);
    expect(lock).not.toBeNull();
    lock?.release();
  });

  it("refuses a second holder while a live process owns it", () => {
    const first = acquireContentWatchLock(contentDir);
    expect(first).not.toBeNull();

    // Simulate a different live process holding the lock.
    fs.writeFileSync(
      contentWatchLockPath(contentDir),
      JSON.stringify({ pid: process.ppid, contentDir, startedAt: new Date().toISOString() })
    );

    expect(acquireContentWatchLock(contentDir)).toBeNull();
    first?.release();
  });

  it("takes over a lock left behind by a dead process", () => {
    // A pid that cannot be running: writeFileSync would fail for pid 0 checks,
    // so use an implausibly high one and confirm it is absent.
    const deadPid = 2 ** 22;
    fs.writeFileSync(
      contentWatchLockPath(contentDir),
      JSON.stringify({ pid: deadPid, contentDir, startedAt: new Date().toISOString() })
    );

    const lock = acquireContentWatchLock(contentDir);
    expect(lock).not.toBeNull();
    lock?.release();
  });

  it("releases so the next watcher can take over", () => {
    const first = acquireContentWatchLock(contentDir);
    first?.release();

    const second = acquireContentWatchLock(contentDir);
    expect(second).not.toBeNull();
    second?.release();
  });

  it("locks each content directory independently", () => {
    const other = path.join(tmpRoot, "other-content");
    fs.mkdirSync(other, { recursive: true });

    const a = acquireContentWatchLock(contentDir);
    const b = acquireContentWatchLock(other);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();

    a?.release();
    b?.release();
    try {
      fs.unlinkSync(contentWatchLockPath(other));
    } catch {
      /* released */
    }
  });

  it("reports the holder, and nothing once released", () => {
    const lock = acquireContentWatchLock(contentDir);
    expect(readContentWatchLock(contentDir)?.pid).toBe(process.pid);

    lock?.release();
    expect(readContentWatchLock(contentDir)).toBeNull();
  });

  it("keeps the lock out of the project directory", () => {
    const lock = acquireContentWatchLock(contentDir);
    expect(contentWatchLockPath(contentDir).startsWith(os.tmpdir())).toBe(true);
    expect(fs.readdirSync(contentDir)).toHaveLength(0);
    lock?.release();
  });
});
