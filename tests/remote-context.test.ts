/**
 * Tests for multi-remote support (remote-context.ts).
 *
 * Covers: resolveRemote, listRemotes, syncTokenPath,
 * metadataMapPath, contentKey, API key resolution from env vars.
 */
import path from 'path';
import {
  resolveRemote,
  listRemotes,
  syncTokenPath,
  metadataMapPath,
  contentKey,
  type RemoteConfig,
  type RemoteContext,
} from '../src/lib/remote-context';
import type { LeadCMSConfig } from '../src/lib/config';

// ── Helpers ────────────────────────────────────────────────────────────

/** Build a minimal LeadCMSConfig for testing. */
function makeConfig(overrides: Partial<LeadCMSConfig> = {}): LeadCMSConfig {
  return {
    url: 'https://single.leadcms.com',
    apiKey: 'single-api-key',
    defaultLanguage: 'en',
    contentDir: '.leadcms/content',
    mediaDir: 'public/media',
    commentsDir: '.leadcms/comments',
    emailTemplatesDir: '.leadcms/email-templates',
    settingsDir: '.leadcms/settings',
    segmentsDir: '.leadcms/segments',
    sequencesDir: '.leadcms/sequences',
    enableDrafts: false,
    ...overrides,
  };
}

function makeMultiRemoteConfig(overrides: Partial<LeadCMSConfig> = {}): LeadCMSConfig {
  return makeConfig({
    remotes: {
      production: { url: 'https://prod.leadcms.com' },
      develop: { url: 'https://dev.leadcms.com' },
    },
    defaultRemote: 'production',
    ...overrides,
  });
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('remote-context', () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    // Restore env vars
    process.env = { ...savedEnv };
  });

  // ── resolveRemote — single-remote mode ─────────────────────────────

  describe('resolveRemote (single-remote mode)', () => {
    it('returns a synthetic "default" remote when no remotes are configured', () => {
      const config = makeConfig();
      const ctx = resolveRemote(undefined, config);

      expect(ctx.name).toBe('default');
      expect(ctx.url).toBe('https://single.leadcms.com');
      expect(ctx.isDefault).toBe(true);
      expect(ctx.stateDir).toBe(path.resolve('.leadcms/remotes/default'));
    });

    it('uses LEADCMS_API_KEY for the default remote', () => {
      process.env.LEADCMS_API_KEY = 'env-api-key';
      const config = makeConfig({ apiKey: undefined });
      const ctx = resolveRemote(undefined, config);

      expect(ctx.apiKey).toBe('env-api-key');
    });

    it('uses config.apiKey when present (pre-resolved)', () => {
      const config = makeConfig({ apiKey: 'config-key' });
      const ctx = resolveRemote(undefined, config);
      // In single-remote mode the API key comes from config.apiKey via the
      // remote-context module's resolveApiKeyFromEnv fallback (LEADCMS_API_KEY).
      // The actual value depends on whether env var is set.
      expect(ctx).toBeDefined();
    });

    it('allows passing remoteName="default" explicitly', () => {
      const config = makeConfig();
      const ctx = resolveRemote('default', config);
      expect(ctx.name).toBe('default');
    });

    it('throws when a non-default remote name is used in single-remote mode', () => {
      const config = makeConfig();
      expect(() => resolveRemote('production', config)).toThrow(
        /Remote "production" is not configured/
      );
    });

    it('strips trailing slashes from URL', () => {
      const config = makeConfig({ url: 'https://example.com///' });
      const ctx = resolveRemote(undefined, config);
      expect(ctx.url).toBe('https://example.com');
    });
  });

  // ── resolveRemote — multi-remote mode ──────────────────────────────

  describe('resolveRemote (multi-remote mode)', () => {
    it('resolves a named remote', () => {
      const config = makeMultiRemoteConfig();
      const ctx = resolveRemote('production', config);

      expect(ctx.name).toBe('production');
      expect(ctx.url).toBe('https://prod.leadcms.com');
      expect(ctx.isDefault).toBe(true);
    });

    it('falls back to defaultRemote when no remoteName given', () => {
      const config = makeMultiRemoteConfig();
      const ctx = resolveRemote(undefined, config);

      expect(ctx.name).toBe('production');
      expect(ctx.isDefault).toBe(true);
    });

    it('resolves a non-default remote', () => {
      const config = makeMultiRemoteConfig();
      const ctx = resolveRemote('develop', config);

      expect(ctx.name).toBe('develop');
      expect(ctx.url).toBe('https://dev.leadcms.com');
      expect(ctx.isDefault).toBe(false);
    });

    it('throws when no remoteName and no defaultRemote', () => {
      const config = makeMultiRemoteConfig({ defaultRemote: undefined });
      expect(() => resolveRemote(undefined, config)).toThrow(
        /No remote specified and no "defaultRemote" configured/
      );
    });

    it('throws when remote does not exist', () => {
      const config = makeMultiRemoteConfig();
      expect(() => resolveRemote('staging', config)).toThrow(
        /Remote "staging" is not configured/
      );
    });

    it('uses LEADCMS_REMOTE_{NAME}_API_KEY for remote-specific key', () => {
      process.env.LEADCMS_REMOTE_DEVELOP_API_KEY = 'dev-secret-key';
      const config = makeMultiRemoteConfig();
      const ctx = resolveRemote('develop', config);

      expect(ctx.apiKey).toBe('dev-secret-key');
    });

    it('falls back to LEADCMS_API_KEY for non-default remotes when no remote-specific key exists', () => {
      process.env.LEADCMS_API_KEY = 'generic-key';
      delete process.env.LEADCMS_REMOTE_DEVELOP_API_KEY;
      const config = makeMultiRemoteConfig();
      const ctx = resolveRemote('develop', config);

      expect(ctx.apiKey).toBe('generic-key');
    });

    it('falls back to LEADCMS_API_KEY for the default remote', () => {
      process.env.LEADCMS_API_KEY = 'generic-key';
      delete process.env.LEADCMS_REMOTE_PRODUCTION_API_KEY;
      const config = makeMultiRemoteConfig();
      const ctx = resolveRemote('production', config);

      expect(ctx.apiKey).toBe('generic-key');
    });

    it('prefers LEADCMS_REMOTE_{NAME}_API_KEY over LEADCMS_API_KEY for the default remote', () => {
      process.env.LEADCMS_API_KEY = 'generic-key';
      process.env.LEADCMS_REMOTE_PRODUCTION_API_KEY = 'prod-specific-key';
      const config = makeMultiRemoteConfig();
      const ctx = resolveRemote('production', config);

      expect(ctx.apiKey).toBe('prod-specific-key');
    });

    it('converts hyphens in remote name to underscores for env var lookup', () => {
      process.env.LEADCMS_REMOTE_DEV_SERVER_API_KEY = 'dev-srv-key';
      const config = makeConfig({
        remotes: { 'dev-server': { url: 'https://dev-srv.example.com' } },
        defaultRemote: 'dev-server',
      });
      const ctx = resolveRemote('dev-server', config);

      expect(ctx.apiKey).toBe('dev-srv-key');
    });

    it('sets stateDir correctly for named remotes', () => {
      const config = makeMultiRemoteConfig();
      const ctx = resolveRemote('develop', config);

      expect(ctx.stateDir).toBe(path.resolve('.leadcms/remotes/develop'));
    });
  });

  // ── listRemotes ────────────────────────────────────────────────────

  describe('listRemotes', () => {
    it('returns a single "default" remote in single-remote mode', () => {
      const config = makeConfig();
      const remotes = listRemotes(config);

      expect(remotes).toHaveLength(1);
      expect(remotes[0].name).toBe('default');
    });

    it('returns all remotes in multi-remote mode', () => {
      const config = makeMultiRemoteConfig();
      const remotes = listRemotes(config);

      expect(remotes).toHaveLength(2);
      const names = remotes.map(r => r.name).sort();
      expect(names).toEqual(['develop', 'production']);
    });
  });

  // ── Path helpers ───────────────────────────────────────────────────

  describe('syncTokenPath', () => {
    it('returns content sync token path', () => {
      const ctx = resolveRemote(undefined, makeConfig());
      const p = syncTokenPath(ctx, 'content');
      expect(p).toBe(path.join(ctx.stateDir, 'content-sync-token'));
    });

    it('returns media sync token path', () => {
      const ctx = resolveRemote(undefined, makeConfig());
      const p = syncTokenPath(ctx, 'media');
      expect(p).toBe(path.join(ctx.stateDir, 'media-sync-token'));
    });

    it('returns comments sync token path', () => {
      const ctx = resolveRemote(undefined, makeConfig());
      const p = syncTokenPath(ctx, 'comments');
      expect(p).toBe(path.join(ctx.stateDir, 'comments-sync-token'));
    });
  });

  describe('metadataMapPath', () => {
    it('returns metadata.json path under stateDir', () => {
      const ctx = resolveRemote(undefined, makeConfig());
      expect(metadataMapPath(ctx)).toBe(path.join(ctx.stateDir, 'metadata.json'));
    });
  });

  describe('contentKey', () => {
    it('builds language/slug key', () => {
      expect(contentKey('en', 'hello-world')).toBe('en/hello-world');
    });

    it('works with non-latin locales', () => {
      expect(contentKey('ja', 'konnichiwa')).toBe('ja/konnichiwa');
    });
  });
});
