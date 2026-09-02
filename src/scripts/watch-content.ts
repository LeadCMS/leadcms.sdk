import path from "path";

import { loadLocalConfig } from "../lib/config.js";
import {
  DEFAULT_CONTENT_REVISION_FILE,
  watchContentRevision,
} from "../lib/content-revision.js";
import { colorConsole } from "../lib/console-colors.js";

/**
 * Watch the content directory and keep the revision module up to date, so a
 * dev server picks up content edits without a manual refresh.
 *
 * Run alongside the framework's dev server, e.g.
 *   "dev": "concurrently \"next dev\" \"leadcms watch-content\""
 */
export function watchContent(args: string[] = []): void {
  // Watching is a purely local operation, so no remote is required.
  const localConfig = loadLocalConfig();
  const revisionFlag = args.indexOf("--revision-file");
  const revisionFile =
    revisionFlag !== -1 && args[revisionFlag + 1]
      ? args[revisionFlag + 1]
      : (localConfig.contentRevisionFile ?? DEFAULT_CONTENT_REVISION_FILE);

  const contentDir = localConfig.contentDir;

  const stop = watchContentRevision({
    contentDir,
    revisionFile,
    onChange: (revision) => {
      colorConsole.log(
        `${colorConsole.cyan("[watch-content]")} content changed → ${colorConsole.highlight(revision)}`
      );
    },
    onError: (error) => {
      colorConsole.warn(
        `[watch-content] recursive watching unavailable (${error.message}); polling instead`
      );
    },
  });

  colorConsole.log(
    `${colorConsole.cyan("[watch-content]")} watching ${colorConsole.highlight(path.resolve(contentDir))}`
  );
  colorConsole.log(
    `${colorConsole.cyan("[watch-content]")} revision module: ${colorConsole.highlight(path.resolve(revisionFile))}`
  );

  const shutdown = (): void => {
    stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
