import path from "path";

import { loadLocalConfig } from "../lib/config.js";
import {
  DEFAULT_CONTENT_REVISION_FILE,
  watchContentRevision,
} from "../lib/content-revision.js";
import { colorConsole } from "../lib/console-colors.js";
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

  const stopRevisionWatch = watchContentRevision({
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

  const shutdown = (): void => {
    stopRevisionWatch();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const remoteUrl = options.remoteContext?.url || config.url;
  if (options.localOnly || !remoteUrl) {
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
