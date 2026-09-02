import path from "path";

import { loadLocalConfig } from "../lib/config.js";
import {
  DEFAULT_CONTENT_REVISION_FILE,
  watchContentRevision,
} from "../lib/content-revision.js";
import { colorConsole } from "../lib/console-colors.js";
import { acquireContentWatchLock, readContentWatchLock } from "../lib/watch-lock.js";
import type { RemoteContext } from "../lib/remote-context.js";

export interface WatchOptions {
  remoteContext?: RemoteContext;
  /** Skip the Server-Sent Events stream and watch local files only. */
  localOnly?: boolean;
  revisionFile?: string;
}

/**
 * Keep local content and the dev server in step.
 *
 * Two things change content during development: edits made by hand, and content
 * streamed down from LeadCMS. Both land in the content directory, and neither is
 * visible to a bundler — content is read from disk at request time and never
 * imported, so nothing in the module graph changes and the dev server has
 * nothing to push.
 *
 * Watching the directory covers both sources at once, which is why this lives
 * here rather than in a separate command: streaming content down without telling
 * the bundler would leave the author's own preview stale.
 *
 * The Server-Sent Events stream is started only when a remote is configured, so
 * this is useful on a project with no LeadCMS instance reachable.
 */
export async function watch(options: WatchOptions = {}): Promise<void> {
  const config = loadLocalConfig();
  const revisionFile =
    options.revisionFile ?? config.contentRevisionFile ?? DEFAULT_CONTENT_REVISION_FILE;

  // Only one process should watch a given content directory. A preview
  // container commonly supervises the watcher separately from the dev server,
  // and wiring both here would put two recursive watchers on the same tree.
  const lock = acquireContentWatchLock(config.contentDir);
  let stopRevisionWatch: (() => void) | null = null;

  if (lock) {
    stopRevisionWatch = watchContentRevision({
      contentDir: config.contentDir,
      revisionFile,
      onChange: (revision) => {
        colorConsole.log(
          `${colorConsole.cyan("[watch]")} content changed → ${colorConsole.highlight(revision)}`
        );
      },
      onError: (error) => {
        colorConsole.warn(
          `[watch] recursive watching unavailable (${error.message}); polling instead`
        );
      },
    });

    colorConsole.log(
      `${colorConsole.cyan("[watch]")} watching ${colorConsole.highlight(path.resolve(config.contentDir))}`
    );
  } else {
    const holder = readContentWatchLock(config.contentDir);
    colorConsole.log(
      `${colorConsole.cyan("[watch]")} another watcher already covers ${colorConsole.highlight(
        path.resolve(config.contentDir)
      )}${holder ? ` (pid ${holder.pid})` : ""} — not starting a second one`
    );
  }

  const shutdown = (): void => {
    stopRevisionWatch?.();
    lock?.release();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const remoteUrl = options.remoteContext?.url || config.url;
  if (options.localOnly) {
    colorConsole.log(
      `${colorConsole.cyan("[watch]")} --local requested — not connecting to LeadCMS`
    );
    return;
  }
  if (!remoteUrl) {
    colorConsole.log(
      `${colorConsole.cyan("[watch]")} no LeadCMS instance configured — watching local content only`
    );
    return;
  }

  const { startSSEWatcher } = await import("./sse-watcher.js");
  const { resolveIdentity } = await import("./leadcms-helpers.js");
  await resolveIdentity(options.remoteContext?.apiKey);
  startSSEWatcher(options.remoteContext);
}
