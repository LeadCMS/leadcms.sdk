import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * Cross-process guard so only one `leadcms watch` watches a content directory.
 *
 * A preview container typically runs the watcher as its own supervised process
 * while the dev server is started separately; wiring both to `leadcms watch`
 * puts two recursive watchers on the same tree, doubling the filesystem
 * traffic and the log output for no benefit. Rather than relying on every
 * project to wire it correctly, the second watcher stands down.
 *
 * The lock lives in the temp directory, keyed by the resolved content path, so
 * it never appears in the project or needs a gitignore entry.
 */

export interface ContentWatchLock {
  release(): void;
}

interface LockPayload {
  pid: number;
  contentDir: string;
  startedAt: string;
}

export function contentWatchLockPath(contentDir: string): string {
  const key = crypto.createHash("sha1").update(path.resolve(contentDir)).digest("hex").slice(0, 16);
  return path.join(os.tmpdir(), `leadcms-watch-${key}.lock`);
}

/** True when a process with this id exists and we may signal it. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readLock(lockPath: string): LockPayload | null {
  try {
    return JSON.parse(fs.readFileSync(lockPath, "utf-8")) as LockPayload;
  } catch {
    return null;
  }
}

/**
 * Take the watch lock for `contentDir`.
 *
 * @returns a handle to release it, or `null` when another live watcher holds it.
 */
export function acquireContentWatchLock(contentDir: string): ContentWatchLock | null {
  const lockPath = contentWatchLockPath(contentDir);
  const existing = readLock(lockPath);

  // A lock left behind by a killed process is not an owner.
  if (existing && existing.pid !== process.pid && isRunning(existing.pid)) {
    return null;
  }

  const payload: LockPayload = {
    pid: process.pid,
    contentDir: path.resolve(contentDir),
    startedAt: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(lockPath, JSON.stringify(payload));
  } catch {
    // An unwritable temp directory should not stop the watcher from running.
    return { release: () => {} };
  }

  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    // Only remove a lock we still own — a restarted watcher may have taken it.
    const current = readLock(lockPath);
    if (current && current.pid !== process.pid) return;
    try {
      fs.unlinkSync(lockPath);
    } catch {
      /* already gone */
    }
  };

  process.once("exit", release);
  return { release };
}

/** Which process holds the lock, if any. Exposed for diagnostics. */
export function readContentWatchLock(contentDir: string): LockPayload | null {
  const existing = readLock(contentWatchLockPath(contentDir));
  if (!existing || !isRunning(existing.pid)) return null;
  return existing;
}
