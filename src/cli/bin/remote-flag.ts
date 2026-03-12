/**
 * Shared --remote / -r flag parsing for CLI bin scripts.
 */

import { resolveRemote, type RemoteContext } from '../../lib/remote-context.js';
import { configureDataServiceForRemote } from '../../scripts/leadcms-helpers.js';
import { getConfig } from '../../lib/config.js';

/**
 * Parse --remote <name> or -r <name> from CLI args and resolve the
 * RemoteContext. When the flag is present, the data service singleton is
 * also configured for the resolved remote.
 *
 * In multi-remote mode (config has a `remotes` block), the default remote
 * is auto-resolved even when --remote is not passed. This ensures id-map
 * and metadata-map behaviour is always active in multi-remote setups.
 *
 * Returns undefined only in single-remote mode without --remote flag.
 */
export function parseRemoteFlag(args: string[]): RemoteContext | undefined {
  const idx = args.findIndex(arg => arg === '--remote' || arg === '-r');

  if (idx !== -1) {
    const name = args[idx + 1];
    if (!name || name.startsWith('-')) {
      console.error(`❌ --remote requires a remote name (e.g. --remote production)`);
      process.exit(1);
    }

    const ctx = resolveRemote(name);
    configureDataServiceForRemote(ctx);
    logRemote(ctx);
    return ctx;
  }

  // Auto-resolve default remote in multi-remote mode
  try {
    const config = getConfig();
    if (config.remotes && Object.keys(config.remotes).length > 0) {
      const ctx = resolveRemote();
      configureDataServiceForRemote(ctx);
      logRemote(ctx);
      return ctx;
    }
  } catch {
    // Config not available or invalid — fall through to single-remote mode
  }

  return undefined;
}

function logRemote(ctx: RemoteContext): void {
  const label = ctx.isDefault ? `${ctx.name} (default)` : ctx.name;
  console.log(`🌐 Remote: ${label} → ${ctx.url}`);
}
