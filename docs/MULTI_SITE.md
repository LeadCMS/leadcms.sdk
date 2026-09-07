# Multi-Site Support for LeadCMS SDK

**Status:** implemented in v3.10.0 (see [Implementation Notes](#implementation-notes) for where the shipped behaviour refines this design).
**Companion doc:** [MULTI_REMOTE.md](./MULTI_REMOTE.md), which this design builds on.

## Implementation Notes

The design below was implemented as written, with these refinements:

- **`-s` means `--site` on every command.** `push`, `status`, `push-media` and `status-media` previously accepted `-s` as an undocumented alias for `--scope`; that alias is gone, `--scope` keeps its long form.
- **`site add` defaults.** `--root` defaults to `sites/<name>/.leadcms` and `--media-dir` to `sites/<name>/public/media`. The migration of a single-site project takes the existing site's name from `--existing-name` or an interactive prompt (default `main`), and `--yes` skips the confirmation. A flat top-level `url` is migrated into a remote named `default`, which keeps its checkpoint at `.leadcms/remotes/default/` and the `LEADCMS_API_KEY` fallback. Top-level directory keys equal to the `.leadcms` expansion are dropped; others move into the site. `defaultLanguage`, `languageDomains`, `redirects` and `enableDrafts` stay top-level as shared defaults.
- **Validation runs for local reads too.** Every rule under [Validation Rules](#validation-rules), including "remotes ⇒ defaultRemote" per site, is checked in `buildConfig()`, so `loadLocalConfig()` and `watch` fail on a broken `sites` block instead of watching the wrong tree. A top-level `contentDir` (or any other `*Dir`) next to `sites` is shadowed by the root expansion and produces a one-time warning.
- **`SiteContext` carries more.** Besides the fields listed under [Internal Architecture](#internal-architecture) it exposes every entity directory, `languageDomains`, `remotes` and `defaultRemote`, so `site show` and `configureForSite()` need no second lookup. `LeadCMSConfig.site` is optional in the type (hand-made configs in tests omit it) and always set on the effective config.
- **`listSites()` is file-based.** `LEADCMS_*` directory overrides describe the active site only, so the listing shows what the config file says; `getActiveSite()` and `resolveSite()` apply them.
- **`login` saves the site-qualified key** (`LEADCMS_SITE_{S}_REMOTE_{R}_API_KEY`) in multi-site mode, and the generic `LEADCMS_API_KEY` only for the default remote of the default site. `remote show` and `site show` hint at the same variable.
- **`site list`** marks the active site with `*` and the default site with `[default]`; `--names` prints one name per line for shell loops (open question 1).
- **A site without remotes** still honours `LEADCMS_URL` from the environment as its single remote, with state under `{root}/remotes/default/`.

## Problem Statement

### 1. One Codebase, Several Sites

A single site codebase increasingly has to serve more than one site:

- the same product sold under two brands in two markets, each with its own domain, language, legal entity, pricing and lead funnel;
- regional editions of one company site;
- an agency template repository that produces a site per client;
- white-label deployments of one product site.

In all of these the code is shared and the content is not. Today one SDK project equals one content tree, one media tree, one set of remotes and one default language. The only way to serve a second site is a second repository, and the two drift apart within months.

### 2. Remotes Model Environments, Not Sites

Named remotes (see MULTI_REMOTE.md) isolate **identity** of the same content across instances: production, develop, local. They deliberately share one content directory, because the content is the same and only the instance differs. Their scope statement says so: "content identity isolation so the same content can be tracked across instances".

A second site is the opposite case: different content, same code. If a brand is configured as a remote, the SDK sees the first brand's pages as "missing on the remote" and the second brand's pages as "new locally". `status` reports hundreds of phantom changes, and a `push` uploads one brand's content into the other brand's instance. Email templates, sequences, segments, settings and redirects have no language partition at all, so they collide outright.

### 3. Directory Settings Are Global

`contentDir`, `mediaDir`, `emailTemplatesDir`, `settingsDir`, `segmentsDir`, `sequencesDir`, `redirectsDir` and `commentsDir` are top-level config keys. Environment variables can override each of them (`LEADCMS_CONTENT_DIR` and friends; env overrides the config file in `buildConfig()`), so a build can be pointed at a second tree with seven variables. But `remotes` and `defaultRemote` cannot be switched by env at all, and a second site has different remotes.

### 4. Remote State Directory Is Hard-Coded

`remote-context.ts` resolves every remote's state to `.leadcms/remotes/{name}/` regardless of `contentDir`. Two sites that both call their production instance `prod` would share one `metadata.json`: one checkpoint, one id map, two instances. That corrupts incremental sync for both.

### 5. Helper Constants Are Computed at Import Time

`scripts/leadcms-helpers.ts` calls `getConfig()` at module load and exports `CONTENT_DIR`, `MEDIA_DIR`, `EMAIL_TEMPLATES_DIR`, `SETTINGS_DIR`, `SEGMENTS_DIR`, `SEQUENCES_DIR`, `REDIRECTS_DIR` and `defaultLanguage` as constants. Any per-invocation site switch has to take effect before that module is evaluated, or rebind those exports afterwards (as `configureDataServiceForRemote()` already does for `leadCMSUrl` / `leadCMSApiKey`).

### What Multi-Language Already Covers

Multi-language needs nothing new. Each instance publishes its language list from `/api/config`; the default language lives at the content root and other languages in `{contentDir}/{lang}/`; settings may carry language-specific values; `languageDomains` maps languages to base URLs for redirect generation. A site simply needs its **own** default language and its own language set, which follows from having its own instance and its own tree.

---

## Non-Goals

- **No server-side multi-tenancy.** A site is still one LeadCMS instance per environment. The core keeps its single-site data model; sites live in the SDK and in operations.
- **No content sharing between sites.** Deriving one site's page from another site's page (translation, brand substitution, staleness tracking) is a separate design. This document only gives each site its own tree, so that design has something to point at.
- **No change to the per-language layout** inside a site's content tree.
- **No SDK-managed media URL rewriting.** Content references media as `/media/...`; making the host's `public/media` point at the active site's media directory stays a host build step (see [Host Project Integration](#host-project-integration)).

---

## Design: Named Sites

### Core Concepts

The SDK gains **named sites**. A site owns:

1. **Content and entity trees**: content, comments, email templates, settings, segments, sequences, redirects.
2. **Media directory**.
3. **Default language** (and, through its instance, its language set).
4. **Remotes** and a default remote: the site's own production / develop / local instances.
5. **Remote state**: every remote's `metadata.json` lives under the site's root, so remote names may repeat across sites.

A `defaultSite` designates which site is used when no site is selected. Sites and remotes are orthogonal:

| Axis   | Question it answers            | Selected by                                       | Examples                  |
| ------ | ------------------------------ | ------------------------------------------------- | ------------------------- |
| Site   | *Which content?*               | `--site` / `LEADCMS_SITE` / `defaultSite`         | `acme`, `zenith`          |
| Remote | *Which instance of that site?* | `--remote` / `LEADCMS_REMOTE` / URL / `defaultRemote` | `prod`, `dev`, `local` |

`leadcms pull --site zenith --remote dev` pulls the `zenith` site's content from `zenith`'s develop instance into `zenith`'s tree, using `zenith`'s `dev` checkpoint. Nothing about `acme` is read or written.

### Why Not Reuse Remotes With Per-Remote Directories

A flat list `acme-prod`, `acme-dev`, `zenith-prod`, `zenith-dev`, each with its own `contentDir`, would work mechanically but conflates two axes in one namespace: `defaultRemote` would no longer mean "the default environment", `remote list` would mix brands with environments, and every future per-site setting (media, language, redirects) would have to be repeated per environment. Sites keep the environment axis exactly as it is today.

---

## Configuration

### Config File

```jsonc
// leadcms.config.json
{
  // Top-level keys are defaults shared by every site (all optional).
  "defaultLanguage": "en",
  "enableDrafts": false,
  "redirects": { "outputDir": "redirects", "pathPattern": "/{slug}/", "trailingSlash": "both" },

  "sites": {
    "acme": {
      "root": ".leadcms",            // => .leadcms/content, .leadcms/settings, .leadcms/remotes/…
      "mediaDir": "public/media",
      "remotes": {
        "prod": { "url": "https://cms.acme.example.com" },
        "dev":  { "url": "https://cms.dev.acme.example.com" }
      },
      "defaultRemote": "prod"
    },
    "zenith": {
      "root": "sites/zenith/.leadcms",
      "mediaDir": "sites/zenith/public/media",
      "defaultLanguage": "en-GB",
      "remotes": {
        "prod": { "url": "https://cms.zenith.example.com" }
      },
      "defaultRemote": "prod"
    }
  },
  "defaultSite": "acme"
}
```

### Site Keys

Every key below may be set per site. Unset keys inherit the top-level value, then the SDK default.

| Key                 | Per-site default                     | Notes                                                                 |
| ------------------- | ------------------------------------ | --------------------------------------------------------------------- |
| `root`              | `.leadcms`                           | Base for the entity directories and remote state (see shorthand below) |
| `contentDir`        | `{root}/content`                     |                                                                       |
| `commentsDir`       | `{root}/comments`                    |                                                                       |
| `emailTemplatesDir` | `{root}/email-templates`             |                                                                       |
| `settingsDir`       | `{root}/settings`                    |                                                                       |
| `segmentsDir`       | `{root}/segments`                    |                                                                       |
| `sequencesDir`      | `{root}/sequences`                   |                                                                       |
| `redirectsDir`      | `{root}/redirects`                   |                                                                       |
| `mediaDir`          | top-level `mediaDir` (`public/media`) | Must be unique per site; see validation                              |
| `defaultLanguage`   | top-level `defaultLanguage`          |                                                                       |
| `languageDomains`   | top-level value                      |                                                                       |
| `redirects`         | top-level value                      | `outputDir` is usually shared: builds run one site at a time          |
| `enableDrafts`      | top-level value                      |                                                                       |
| `remotes`           | none                                 | Not inherited: a site's instances are its own                         |
| `defaultRemote`     | none                                 | Required when `remotes` is set                                        |

Keys that stay top-level only, because the host project consumes them from a fixed path: `contentRevisionFile` (the dev server imports one module), `preview`.

### `root` Shorthand

`root` expands to the seven entity directories and to the remote state base `{root}/remotes`. An explicit per-site `contentDir` (or any other `*Dir`) overrides the expansion for that key only. The implicit single-site project (no `sites` block) has `root = ".leadcms"`, which yields exactly today's default paths.

### Effective Config Precedence

`buildConfig()` resolves the active site first, then merges. Later entries win:

```
DEFAULT_CONFIG
  ← config file, top-level keys (excluding sites / defaultSite)
  ← root expansion of the active site
  ← config file, explicit keys of the active site
  ← environment variables (LEADCMS_CONTENT_DIR, LEADCMS_DEFAULT_LANGUAGE, …)
  ← programmatic configure()
```

Environment variables keep their current meaning: they override the file, now at the level of the active site. `LEADCMS_CONTENT_DIR=/tmp/x leadcms pull -s zenith` pulls `zenith` into `/tmp/x`. This preserves the security rationale already documented for env precedence and keeps CI overrides working unchanged.

The returned `LeadCMSConfig` is the **effective** config for one site. Every existing consumer (`config.contentDir` in `pull-all.ts`, `cms.ts`, `watch.ts`, `content-revision.ts`; `config.remotes` in `remote-context.ts`) therefore works per site with no change. This is what keeps the feature small.

### Site Selection

Resolution priority, mirroring remotes:

1. `--site <name>` / `-s <name>` CLI flag
2. `LEADCMS_SITE` environment variable
3. `defaultSite` from config

`NEXT_PUBLIC_LEADCMS_SITE` is **not** consulted by the SDK (nothing in the browser needs it), but hosts may set it for their own code.

### API Key Resolution

API keys stay in environment variables. Resolution order for remote `{R}` of site `{S}`:

1. `LEADCMS_SITE_{S}_REMOTE_{R}_API_KEY` (site-qualified; needed when two sites both name a remote `prod` and one developer holds keys for both)
2. `LEADCMS_REMOTE_{R}_API_KEY` (today's remote-specific key)
3. `LEADCMS_API_KEY` (generic fallback)

`{S}` and `{R}` are upper snake case, as today (`zenith` → `ZENITH`, `my-site` → `MY_SITE`). A CI job builds one site, so it normally needs only level 2 or 3. Remote URLs come from the config file only; the SDK has no per-remote URL env override today (MULTI_REMOTE.md mentions one, but it was never implemented), and this design does not add one.

### Backward Compatibility

When no `sites` block exists, the SDK behaves exactly as today:

- one implicit site named `default` with `root = ".leadcms"`;
- all paths identical, including `.leadcms/remotes/{name}/metadata.json`;
- top-level `remotes` / `defaultRemote` / `url` continue to work;
- no migration, no new files, no new env vars required;
- `--site` and `LEADCMS_SITE` are errors in this mode, with the same wording remotes use ("Add a `sites` block to your leadcms config file to use named sites").

When `sites` is present, top-level `url`, `remotes` and `defaultRemote` are **errors**, not silently ignored: they belong to a site now, and ignoring them would hide a misconfiguration that only shows up as an empty pull.

### Validation Rules

- Site names match `^[a-z0-9][a-z0-9-]*$` (same rule as remotes).
- `sites` present ⇒ `defaultSite` required and must name an existing site. Exception: exactly one site is defined; it is then the implicit default.
- Per site: `remotes` present ⇒ `defaultRemote` required and must exist; remote URLs validated as today.
- A site with no `remotes` is valid for local reads (`loadLocalConfig()`) and fails only when a remote is actually needed (`loadConfig()`), matching the existing single-remote rule.
- No two sites may resolve to the same `contentDir`, the same `mediaDir` or the same state base (`{root}/remotes`). Error.
- Two sites whose remotes point at the same URL: warning. Instance-per-site is the intended model, but the SDK does not forbid pulling two trees from one instance.
- Reserved name `default` cannot be used in a `sites` block.

---

## Per-Site Storage Layout

```
leadcms.config.json
.leadcms/                          # site "acme" (root = .leadcms, default site)
  content/
    home.mdx                       # acme default language
    da/home.mdx                    # acme, Danish
  email-templates/
  settings/
  segments/
  sequences/
  redirects/redirects.yaml
  remotes/
    prod/metadata.json             # acme ↔ acme's production instance
    dev/metadata.json
public/
  media/                           # acme media (served at /media/)
sites/zenith/
  .leadcms/                        # site "zenith" (root = sites/zenith/.leadcms)
    content/
      home.mdx                     # zenith default language (en-GB)
    email-templates/
    settings/
    sequences/
    redirects/redirects.yaml
    remotes/
      prod/metadata.json           # zenith ↔ zenith's production instance
  public/
    media/                         # zenith media; linked to public/media at build time
```

The remote state path becomes `{site.root}/remotes/{remote}/`. For the implicit default site this is `.leadcms/remotes/{remote}/`, unchanged. Everything under a site's root is committed, for the same reason `metadata.json` is committed today: a fresh clone must be able to continue an incremental sync.

---

## Build-Time API

No signature changes. `getCMSContentBySlugForLocale()`, `getAllContentSlugsForLocale()`, `getAllContentForLocale()`, `getAllContentRoutes()`, `getAvailableLanguages()`, comment readers and `getContentDirForLocale()` all read `getConfig()`, which is now site-effective. A Next.js build with `LEADCMS_SITE=zenith` renders `zenith`'s tree and `zenith`'s languages without touching page code.

Two additions:

```ts
import { getActiveSite, listSites } from "@leadcms/sdk";

getActiveSite();  // { name: "zenith", isDefault: false, root: "sites/zenith/.leadcms", defaultLanguage: "en-GB", … }
listSites();      // all SiteContexts; a single-element array in single-site mode
```

`configure({ site: "zenith" })` selects a site programmatically, at the same precedence as other programmatic config.

The fallback branch in `cms.ts` (`getLeadCMSConfig()`, used when config loading throws) stays env-only and ignores sites; it exists for broken configs and must not grow site logic.

---

## CLI Changes

### `--site` / `-s` Flag on All Commands

Every command that takes `--remote` also takes `--site`: `pull*`, `push*`, `status*`, `watch`, `generate-redirects-map`, `generate-content-revision`, `add-content`, `login`, and the `remote` subcommands.

```bash
leadcms pull --site zenith                # zenith, its default remote
leadcms pull -s zenith -r dev             # zenith, its dev remote
leadcms push -s acme                      # acme, its default remote
leadcms status                            # defaultSite, its default remote
LEADCMS_SITE=zenith leadcms pull          # same as --site zenith
```

The flag is a **selector, not a guard**. Because each site has its own tree, a command run against the wrong site is a no-op on the other site's files, not a corruption. The one place a wrong site can do damage is the same as today for remotes, an explicit `--force` push, and it is not made stricter.

### Site Management Commands

```bash
leadcms site list
#   * acme    .leadcms                 en     remotes: prod (default), dev   [default]
#     zenith  sites/zenith/.leadcms    en-GB  remotes: prod (default)

leadcms site add <name> --root <dir> --media-dir <dir> [--language <code>] [--remote <name>=<url>]... [--default]
leadcms site add zenith --root sites/zenith/.leadcms --media-dir sites/zenith/public/media \
  --language en-GB --remote prod=https://cms.zenith.example.com

leadcms site remove <name>               # removes the config entry only; files are left in place
leadcms site set-default <name>
leadcms site show <name>                 # root, dirs, language, remotes, per-remote checkpoint summary
```

`remote add | remove | set-default | show | reset` gain `--site` and act on that site's `remotes` block. `leadcms remote list` prints the active site's remotes with a site header.

`site add` on a project without a `sites` block performs the one-time migration described under [Migration](#migration) and asks for confirmation.

### Output Header

Commands print the site next to the remote so logs are unambiguous:

```
🏷  Site: zenith            (sites/zenith/.leadcms)
🌐 Remote: prod (default) → https://cms.zenith.example.com
```

In single-site mode the site line is omitted, so existing log expectations hold.

### `watch`

`leadcms watch -s zenith` watches `zenith`'s content directory and its default remote's SSE stream. The watch lock is already keyed by content directory, so one watcher per site may run concurrently. All watchers write the same `contentRevisionFile`, which is intentional: the dev server imports one module and only needs to know that something changed.

### Docker Preview Template

`templates/docker/preview/Dockerfile` gains `ARG LEADCMS_SITE` / `ENV LEADCMS_SITE`, passed through next to `LEADCMS_DEFAULT_LANGUAGE`, so one preview image serves any site by env.

---

## Host Project Integration

These are conventions for host projects, documented in the README, not SDK behaviour.

### Making `public/media` Follow the Active Site

Content references media as `/media/...`, and static hosts serve `public/`. With two sites, `public/media` must point at the active site's `mediaDir` at build time. Recommended prebuild step (symlink; copy on filesystems without symlinks):

```js
// scripts/link-site-media.mjs
import { getActiveSite, getConfig } from "@leadcms/sdk";
import fs from "node:fs";
import path from "node:path";

const site = getActiveSite();
if (!site.isDefault) {
  const target = path.resolve(getConfig().mediaDir);
  const link = path.resolve("public/media");
  fs.rmSync(link, { recursive: true, force: true });
  fs.symlinkSync(target, link, "junction");
}
```

```json
"prebuild": "leadcms pull && leadcms generate-env && leadcms generate-redirects-map && node scripts/link-site-media.mjs"
```

### Per-Site Builds

```bash
LEADCMS_SITE=acme   LEADCMS_REMOTE=prod pnpm build
LEADCMS_SITE=zenith LEADCMS_REMOTE=prod pnpm build
```

Builds run one site at a time. The redirect `outputDir` and the static output directory are overwritten per build; a CI matrix runs one job per site with that site's variable group.

### Site Metadata Belongs in the CMS

Hosts typically keep a `siteMetadata` file with the site name, legal entity, contacts, store links and analytics ids. With several sites this becomes a per-site file selected by `getActiveSite().name`. The better end state is a `Site.*` settings group pulled into `settingsDir` and read with a `getSiteSettings()` helper, so the codebase carries no site literals at all. That is a separate proposal; this design only makes sure each site has its own `settingsDir` for it to land in.

---

## Internal Architecture

### `SiteConfig` and `SiteContext`

```ts
// lib/site-context.ts

/** One named site in leadcms.config.json */
export interface SiteConfig {
  root?: string;
  defaultLanguage?: string;
  contentDir?: string;
  commentsDir?: string;
  mediaDir?: string;
  emailTemplatesDir?: string;
  settingsDir?: string;
  segmentsDir?: string;
  sequencesDir?: string;
  redirectsDir?: string;
  languageDomains?: Record<string, string>;
  redirects?: LeadCMSConfig["redirects"];
  enableDrafts?: boolean;
  remotes?: Record<string, RemoteConfig>;
  defaultRemote?: string;
}

/** Resolved site: everything needed to locate its trees and its remote state */
export interface SiteContext {
  name: string;           // "default" in single-site mode
  isDefault: boolean;
  root: string;           // absolute
  defaultLanguage: string;
  contentDir: string;     // absolute, after expansion and overrides
  mediaDir: string;
  stateBaseDir: string;   // absolute: {root}/remotes
}

export function resolveSite(siteName?: string, config?: RawConfigFile): SiteContext;
export function listSites(config?: RawConfigFile): SiteContext[];
```

`LeadCMSConfig` gains three fields: `sites?: Record<string, SiteConfig>`, `defaultSite?: string`, and `site: string` (the resolved active site name; `"default"` in single-site mode).

### Resolution Inside `buildConfig()`

```ts
function buildConfig(): LeadCMSConfig {
  const file = loadConfigFile(cwd);                       // raw, cached as today
  const env = loadConfigFromEnv();
  const siteName = globalConfig?.site ?? process.env.LEADCMS_SITE ?? file.defaultSite ?? implicitSingle(file);
  const site = file.sites?.[siteName];                    // undefined in single-site mode
  const { sites, defaultSite, ...topLevel } = file;
  const merged = {
    ...DEFAULT_CONFIG,
    ...topLevel,
    ...expandRoot(site?.root ?? DEFAULT_CONFIG.root),
    ...site,                                              // explicit per-site keys
    ...env,
    ...globalConfig,
    site: siteName,
    sites,
    defaultSite,
  };
  return clean(merged);
}
```

`validateConfig()` gains the rules listed above. The raw file cache (`configCache`, 60 s TTL) is untouched: it caches the file, and site resolution happens on every `getConfig()` call from that cached file, so switching `LEADCMS_SITE` between calls in one process (tests, long-lived tools) takes effect immediately.

### `resolveRemote()` Becomes Site-Aware

`resolveRemote(remoteName?, config?)` keeps its signature. Because `config.remotes` is already the active site's block after the merge, the only change is the state path:

```ts
const stateDir = path.join(resolveSite(cfg.site, …).stateBaseDir, name);   // was: path.resolve(".leadcms/remotes", name)
```

`REMOTES_BASE_DIR` is removed. `metadataMapPath()`, `syncTokenPath()` and the `remote reset` command follow automatically because they take the context's `stateDir`.

### Injecting the Site Before Module Evaluation

`cli/index.ts` spawns every command as a child process with the parent's environment. It will parse `--site` / `-s` out of `commandArgs` **before** spawning and set `process.env.LEADCMS_SITE` for the child. The bin script then sees the site already selected when `leadcms-helpers.ts` computes its constants at import time. No refactor of the constants is needed for the CLI path.

For the direct-invocation path (`node dist/cli/bin/pull-all.js -s zenith`, and the `leadcms:*` package scripts), a `parseSiteFlag(args)` helper in `cli/bin/site-flag.ts`, called first in every bin script exactly where `parseRemoteFlag()` is called today, will:

1. resolve the site (flag → env → default) and validate it;
2. set `process.env.LEADCMS_SITE`;
3. call `configureForSite(ctx)` in `leadcms-helpers.ts`, which rebinds the directory exports. To make that possible those exports change from `const` to `let` live bindings, the pattern `leadCMSUrl` / `leadCMSApiKey` already use;
4. print the site header.

`parseRemoteFlag()` runs after `parseSiteFlag()` so it resolves remotes within the selected site.

### `leadcms-helpers.ts` Follow-Up

Converting the directory constants to functions (`getContentDir()` etc.) is the cleaner long-term shape and removes the import-order dependency entirely. It touches every pull/push/status script and is deliberately **out of scope** here; the live-binding approach keeps the diff small and is proven by the URL/key bindings.

---

## Migration

### Existing Single-Site Projects

Nothing to do. No `sites` block means the implicit `default` site with today's paths.

### Adding a Second Site to an Existing Project

1. Wrap the existing remotes in a site and name it:

   ```jsonc
   // before
   { "remotes": { "prod": {…}, "dev": {…} }, "defaultRemote": "prod", "mediaDir": "public/media" }

   // after
   {
     "sites": {
       "acme": { "root": ".leadcms", "mediaDir": "public/media",
                 "remotes": { "prod": {…}, "dev": {…} }, "defaultRemote": "prod" }
     },
     "defaultSite": "acme"
   }
   ```

   Existing state under `.leadcms/remotes/` is picked up unchanged because the root is still `.leadcms`. No re-pull.

2. Add the second site: `leadcms site add zenith --root sites/zenith/.leadcms --media-dir sites/zenith/public/media --language en-GB --remote prod=https://cms.zenith.example.com`.

3. `leadcms pull -s zenith` performs a full first sync into the new tree and creates `sites/zenith/.leadcms/remotes/prod/metadata.json`.

4. Add the media link step and the per-site CI job to the host project.

`leadcms site add` performs step 1 automatically when it finds top-level remotes and no `sites` block, after confirmation.

---

## Implementation Phases

### Phase 1: Config Schema and Effective Merge

- `SiteConfig`, `SiteContext`, `resolveSite()`, `listSites()`, `getActiveSite()` in `lib/site-context.ts`.
- `buildConfig()` site resolution and root expansion; `validateConfig()` site rules; `configure({ site })`.
- Tests: `tests/multi-site.test.ts` (resolution, precedence, expansion, validation), additions to `tests/config.test.ts` and `tests/local-config.test.ts`.

### Phase 2: Per-Site Remote State

- `resolveRemote()` derives `stateDir` from the site's `stateBaseDir`; remove `REMOTES_BASE_DIR`.
- Site-qualified API key lookup.
- Tests: additions to `tests/multi-remote.test.ts` (same remote name in two sites yields distinct state dirs; single-site path unchanged), `tests/metadata-v2.test.ts` path assertions.

### Phase 3: CLI

- `cli/index.ts` pre-parses `--site` into `LEADCMS_SITE` for the child.
- `cli/bin/site-flag.ts` and `configureForSite()`; call order in every bin script.
- `cli/bin/site.ts` (`list | add | remove | set-default | show`); `--site` on `remote` subcommands; headers.
- Help text in `cli/index.ts`; `templates/docker/preview/Dockerfile`.
- Tests: CLI behaviour tests alongside the existing remote command tests.

### Phase 4: Docs and Release

- README: Configuration section, CLI section, a "Multiple sites" subsection under Framework Integration with the media link snippet.
- `leadcms.config.json.sample`: commented `sites` example.
- `releases/v3.10.0.md`.

Phases 1 and 2 are pure library changes and can ship behind no flag: without a `sites` block nothing observable changes.

---

## Files Requiring Changes

| File                                          | Change                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/lib/config.ts`                           | `sites` / `defaultSite` / `site` on `LeadCMSConfig`; site resolution and root expansion in `buildConfig()`; validation rules |
| `src/lib/site-context.ts` (new)               | `SiteConfig`, `SiteContext`, `resolveSite()`, `listSites()`, `getActiveSite()`      |
| `src/lib/remote-context.ts`                   | `stateDir` from site `stateBaseDir`; site-qualified API key env; drop `REMOTES_BASE_DIR` |
| `src/scripts/leadcms-helpers.ts`              | directory exports become `let`; `configureForSite()`                                |
| `src/cli/index.ts`                            | pre-parse `--site` into `LEADCMS_SITE`; help text; `site` command dispatch          |
| `src/cli/bin/site-flag.ts` (new)              | `parseSiteFlag()`                                                                   |
| `src/cli/bin/site.ts` (new)                   | `site list / add / remove / set-default / show`                                     |
| `src/cli/bin/remote.ts`                       | `--site` on all subcommands; write into the site's `remotes` block                  |
| `src/cli/bin/*.ts` (all commands)             | call `parseSiteFlag()` before `parseRemoteFlag()`                                   |
| `src/scripts/init-leadcms.ts`                 | unchanged; `site add` handles multi-site setup                                      |
| `src/templates/docker/preview/Dockerfile`     | `LEADCMS_SITE` passthrough                                                          |
| `src/index.ts`                                | export `getActiveSite`, `listSites`, `SiteContext`, `SiteConfig`                    |
| `leadcms.config.json.sample`, `README.md`, `releases/v3.10.0.md` | documentation                                                    |

Not touched: `pull-all.ts`, `cms.ts`, `watch.ts`, `content-revision.ts`, `generate-redirects-map.ts`, push/pull/status scripts. They already read `getConfig()` per call.

---

## Test Plan

- **Resolution:** flag beats env beats `defaultSite`; single site without `defaultSite` is implicit default; unknown name lists available sites; `--site` in single-site mode errors.
- **Effective config:** root expansion; explicit per-site key beats expansion; top-level key inherited; env beats site; `configure({ site })` beats env. Assert full path sets for both example sites.
- **Validation:** missing `defaultSite`; top-level `remotes` next to `sites`; duplicate `contentDir` / `mediaDir` / state base across sites; reserved name `default`; per-site `defaultRemote` missing.
- **Remote state isolation:** `resolveRemote("prod")` under `acme` and under `zenith` returns different `stateDir`s; single-site `stateDir` equals the pre-change path byte for byte.
- **API keys:** site-qualified key wins over remote key wins over generic.
- **Build-time reads:** with two fixture trees, `getAllContentSlugsForLocale()` and `getAvailableLanguages()` follow `LEADCMS_SITE` within one process (uses `clearContentCache()`); `getContentDirForLocale()` uses the site's default language.
- **Helpers rebinding:** after `configureForSite()`, `CONTENT_DIR` and friends point at the new site (jest `isolateModules` for the import-time path).
- **CLI:** `site list/add/show` round-trip on a temp config; `site add` migration of a top-level `remotes` block; `pull -s` header lines; `remote add --site` writes into the right block.
- **Regression:** the entire existing suite passes with no `sites` block, unchanged fixtures.

---

## Edge Cases

### Same Remote Name in Two Sites

Expected and supported: `acme/prod` and `zenith/prod` have separate state under their roots and separate API keys via the site-qualified env var.

### Two Sites, One Instance

Allowed with a warning. Both sites pull the same content into two trees; a push from either overwrites the other's changes on the instance. The warning names both sites.

### Site Without Remotes

Usable for builds from committed content (the documented "develop against committed content with no CMS reachable" case). `pull`, `push`, `status` and `watch` fail with the existing "no remote configured" error naming the site.

### `LEADCMS_SITE` Set in a Single-Site Project

Error, matching what `--remote <name>` does in single-remote mode. Note that `LEADCMS_REMOTE` itself is silently ignored there; sites are stricter on purpose, so a stale CI variable naming a site that does not exist fails the build instead of selecting nothing.

### `defaultSite` Changed

Only selection changes. No frontmatter or metadata is rewritten, because sites do not share files. This is simpler than switching `defaultRemote`, which does affect frontmatter values.

### Settings and Locale Directory Detection

`getFileSettingTopLevelDirs()` distinguishes file-setting folders from locale folders inside `settingsDir`; it operates per resolved directory and needs no change.

### `languageDomains` and `singleLanguage`

`singleLanguage` in `leadcms-helpers.ts` is derived from `languageDomains`; with the per-site merge it is derived from the active site's mapping, so a site with one language and a site with three coexist.

### Renaming a Site

`site remove` plus `site add` with the same root. State directories are keyed by remote name under the root, not by site name, so nothing is lost.

---

## Open Questions

1. **`pull --all-sites` / `status --all-sites`.** Convenient for a maintainer of an agency repo. Proposed: defer; a shell loop over `leadcms site list --names` covers it, and per-site CI jobs are the norm.
2. **Site-qualified API key env var.** Adds a third lookup level. Proposed: keep it; the alternative (forcing distinct remote names across sites) leaks the site axis back into remote names, which this design exists to avoid.
3. **Per-site `contentRevisionFile`.** Proposed: no. One dev server, one module; concurrent watchers writing one file is the intended behaviour.
4. **Should `init` learn about sites?** Proposed: no. `init` bootstraps a single-site project; `site add` upgrades it. Keeps the wizard unchanged for the common case.
5. **Media link step in the SDK (`leadcms link-media`)?** Would remove a host script but hard-codes `public/` and symlink behaviour that differ per host and OS. Proposed: document the snippet; revisit if three hosts copy it.

---

## Related Work (Not in This Design)

- **Site settings catalog.** A `Site.*` settings group in the core (name, legal entity, contacts, store links, analytics ids, timezone), pulled into `settingsDir` and read via `getSiteSettings()` at build time. Removes the last site-specific literals from host code. Language-specific setting values already exist in the core.
- **Cross-site content derivation.** Recording a source reference (`site:slug@updatedAt`) on a derived page, `status --stale` to list pages whose source changed, and an AI-assisted translate-on-derive step. Depends on per-site trees from this design and on the AI content generation plan in the core.
