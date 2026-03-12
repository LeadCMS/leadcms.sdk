# Multi-Remote Support for LeadCMS SDK

## Problem Statement

### 1. Sync Tokens Are Global

Sync tokens are stored at a single path (`.leadcms/content/.sync-token`). When pulling from instance A then instance B, B's sync token overwrites A's. The next pull from A uses B's token, which:

- Breaks three-way merge logic (wrong `baseItems` from the sync API)
- Retrieves incomplete or excessive changes from the sync endpoint
- Corrupts the incremental sync state

### 2. Timestamps Are Remote-Specific

`createdAt` and `updatedAt` are server-generated values stored in YAML frontmatter / JSON content files. `publishedAt` is user-defined (not server-generated), but is still treated as server-controlled during merge — if the server has a different value than the client, the server's value is taken without generating a merge conflict.

These timestamps currently serve two purposes:

- **Conflict detection on push**: `updatedAt` from the local file is compared against the remote's current `updatedAt` to detect conflicts (`remoteUpdated > localUpdated`)
- **Merge auto-resolution**: These fields are marked as `SERVER_CONTROLLED_FIELDS` in `content-merge.ts` and always take the remote value during three-way merge

When working with multiple remotes, these timestamps belong to whichever remote was last synced. If you pull from production (sets `updatedAt` to production's value), then push to develop — the conflict detection compares production's timestamp against develop's, producing false conflicts or missing real ones.

### 2a. Timestamps Cause Git History Clutter

Even in a single-remote setup, `createdAt` and `updatedAt` changes in frontmatter generate noisy git diffs. Every pull or push that touches server-controlled timestamps modifies the content file, resulting in commits where the only meaningful diff is a timestamp change. With multiple remotes, this problem multiplies — switching between remotes would rewrite timestamps in every file, creating large, meaningless diffs that obscure real content changes in git history.

### 3. IDs Are Instance-Specific

Content IDs are backend-generated integers stored in frontmatter (`id: 42`). The same content on production may have `id: 42` while on develop it has `id: 7`. The current codebase stores a single `id` per content item, meaning:

- Pushing content pulled from production to develop uses production's ID for the `PUT` call
- Creating content on develop, then pushing to production creates a new item (correct), but the returned production ID overwrites develop's ID in frontmatter

#### Do We Actually Need Client-Side IDs?

Analysis of ID usage per entity type:

| Entity              | API Primary Key | Natural Key              | IDs Required Client-Side? | Notes                                                                                                                                                                               |
| ------------------- | --------------- | ------------------------ | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Content**         | `id` (integer)  | `slug + language`        | **Yes, for now**          | API uses `PUT /api/content/{id}` — no slug-based update/delete endpoint exists. Deletion sync returns `deleted: number[]` (array of IDs). Rename detection relies on ID continuity. |
| **Comments**        | `id` (integer)  | **None**                 | **Yes**                   | Comments have no natural key — no slug, name, or stable identifier. Matching, updating, and deleting all require numeric IDs.                                                       |
| **Media**           | Path-based      | `scopeUid + name` (path) | **No**                    | Already uses `/api/media/{pathToFile}` — numeric IDs exist in the DTO but are not used for operations.                                                                              |
| **Email Templates** | `id` (integer)  | `name + language`        | **Yes, for now**          | Natural key exists (`name + language`) but API requires `{id}` in URL path.                                                                                                         |
| **Settings**        | `name` (string) | `name`                   | **No**                    | Already uses `/api/settings/{name}` — no numeric IDs.                                                                                                                               |

**Conclusion**: IDs cannot be fully eliminated without API changes (adding slug-based endpoints for content and email templates, changing deletion sync to return slugs instead of IDs). However, IDs can be **moved out of frontmatter** and into the per-remote `metadata.json`, which both solves the multi-remote problem and reduces git noise. The `metadata.json` approach effectively replaces the current `buildContentIdIndex()` filesystem scan — instead of parsing every file to extract IDs, we look them up from the remote metadata store.

**Future API improvement**: Adding `PUT /api/content?slug={slug}&language={lang}` and changing `deleted` to return `Array<{slug, language}>` would eliminate the need for client-side content IDs entirely. This would be a non-breaking addition to the API.

### 4. Single-Remote Configuration

The config has scalar `url` and `apiKey` fields. There is no way to name, switch between, or manage multiple CMS instances within a single project.

---

## Design: Git-Style Named Remotes

### Core Concepts

The SDK gains the concept of **named remotes** — each remote represents a CMS instance with its own:

1. **Connection info** — URL + API key
2. **Sync state** — sync tokens per entity type (content, media, comments)
3. **Identity mapping** — slug → remote-specific ID
4. **Timestamps** — remote-specific `createdAt` / `updatedAt` for conflict detection

A `defaultRemote` designates which remote is used when `--remote` is not specified.

---

## Configuration

### Config File

```jsonc
// leadcms.config.json
{
  "defaultLanguage": "en",
  "contentDir": ".leadcms/content",
  "commentsDir": ".leadcms/comments",
  "mediaDir": "public/media",
  "emailTemplatesDir": ".leadcms/email-templates",
  "settingsDir": ".leadcms/settings",
  "enableDrafts": false,

  "remotes": {
    "production": {
      "url": "https://prod.leadcms.example.com",
    },
    "develop": {
      "url": "https://dev.leadcms.example.com",
    },
  },
  "defaultRemote": "production",
}
```

### API Key Resolution

API keys remain in environment variables (never in config files). Resolution order:

1. **Remote-specific**: `LEADCMS_REMOTE_PRODUCTION_API_KEY`, `LEADCMS_REMOTE_DEVELOP_API_KEY`
2. **Generic fallback** for default remote: `LEADCMS_API_KEY`

Pattern: `LEADCMS_REMOTE_{UPPER_SNAKE_CASE_NAME}_API_KEY`

> **Security note**: API keys must NEVER use the `NEXT_PUBLIC_` prefix. The `NEXT_PUBLIC_` prefix in Next.js exposes environment variables to the browser bundle, making API keys visible to all clients. Only the CMS URL may use `NEXT_PUBLIC_LEADCMS_URL` (it is not a secret). If the current SDK code references `NEXT_PUBLIC_LEADCMS_API_KEY`, that is a bug that must be fixed.

Similarly, URL can also be supplied via env var: `LEADCMS_REMOTE_PRODUCTION_URL` overrides the config file URL.

### Backward Compatibility

When no `remotes` block exists in config, the SDK behaves exactly as today:

- Uses `url` / `apiKey` / env vars as the single unnamed remote (internally named `"default"`)
- Sync tokens remain at current paths
- `id` / `updatedAt` in frontmatter work as before
- No migration required
- You do not need to add a `remotes` section just to keep single-remote behavior
- You do not need to create or commit `.leadcms/remotes/` for single-remote projects

When `remotes` is present, the flat `url` / `apiKey` fields are ignored (with a warning if both exist).

---

## Per-Remote Storage Layout

```
.leadcms/
  content/                    # Content files (shared across remotes)
    en/
      blog/
        my-post.mdx
        another.mdx
    .sync-token               # DEPRECATED when using remotes (kept for migration)
  comments/
  remotes/
    production/
      content-sync-token      # Sync token for content from production
      media-sync-token        # Sync token for media from production
      comments-sync-token     # Sync token for comments from production
      email-templates-sync-token
      metadata.json           # Remote-specific IDs and timestamps for content and email templates
    develop/
      content-sync-token
      media-sync-token
      comments-sync-token
      email-templates-sync-token
      metadata.json
public/
  media/
    .sync-token               # DEPRECATED when using remotes
```

### Sync Tokens

Each remote gets its own sync token files under `.leadcms/remotes/{name}/`. Tokens are never shared across remotes.

**Migration**: When upgrading from single-remote to multi-remote:

- Existing `.leadcms/content/.sync-token` → `.leadcms/remotes/{defaultRemote}/content-sync-token`
- Existing `public/media/.sync-token` → `.leadcms/remotes/{defaultRemote}/media-sync-token`

---

## Per-Remote Metadata Storage

### The Problem

Content identity in the LeadCMS API is by integer ID. The same piece of content has different IDs on different instances:

| Content (slug + lang) | Production ID | Develop ID |
| --------------------- | ------------- | ---------- |
| `en/blog/my-post`     | 42            | 7          |
| `en/blog/another`     | 43            | 8          |
| `en/blog/new-post`    | —             | 12         |

### Solution: `metadata.json` per Remote

```jsonc
// .leadcms/remotes/production/metadata.json
{
  "content": {
    "en": {
      "blog/my-post": {
        "id": 42,
        "createdAt": "2026-01-15T10:00:00Z",
        "updatedAt": "2026-03-01T14:30:00Z",
      },
      "blog/another": {
        "id": 43,
      },
    },
  },
  "emailTemplates": {
    "en": {
      "WelcomeEmail": {
        "id": 5,
        "updatedAt": "2026-03-02T09:15:00Z",
      },
      "WeeklyDigest": {
        "id": 6,
      },
    },
  },
}
```

For content, the nested key is `language -> slug`.

For email templates, the nested key is `language -> templateName`.

Keys are written alphabetically by language and then alphabetically within each language block.

### How It Works

**On pull** (from remote X):

- For each content item received, update X's `metadata.json` content entry with `id`, `createdAt`, and `updatedAt`
- For each email template received, update X's `metadata.json` emailTemplates entry with `id`, `createdAt`, and `updatedAt`

**On push** (to remote X):

- Look up content ID from X's `metadata.json` by `language + slug`
- If found → `PUT /api/content/:id` (update)
- If not found → match by `slug + language` against remote, or `POST /api/content` (create)
- On successful create → store new ID in X's `metadata.json`

Email templates follow the same pattern using `language + name`.

**Frontmatter `id` field**:

- In single-remote mode: works exactly as today (ID in frontmatter)
- In multi-remote mode: frontmatter `id` stores the **default remote's** ID (backward compat with framework integrations that read it)
- Non-default remote IDs live only in their `metadata.json`

For email templates, the local HTML comment frontmatter follows the same rule: local `id` reflects the default remote, while non-default remote IDs live only in the per-remote map.

---

## Per-Remote Timestamps

### The Problem

`createdAt` and `updatedAt` in frontmatter are currently used for:

1. **Push conflict detection**: compare `local.metadata.updatedAt` vs `remote.updatedAt` to detect if the remote was modified since last sync
2. **Post-push sync**: after a successful push, the remote's response `updatedAt` is written back to frontmatter to establish a new baseline
3. **Three-way merge**: `SERVER_CONTROLLED_FIELDS` always take the remote value

`publishedAt` is **user-defined** (not server-generated) — it represents when the content was published and is set by content authors. However, it is still treated as server-controlled during merge: if the server has a different value, the server's value is taken without generating a conflict. Unlike `createdAt`/`updatedAt`, `publishedAt` is meaningful user-facing data (used for draft detection, sorting, display) and should be preserved in frontmatter regardless of remote.

When multiple remotes are involved, `createdAt`/`updatedAt` belong to whichever remote was last synced. If you pull from production (sets `updatedAt` to production's value), then push to develop — the conflict detection compares production's timestamp against develop's, producing false conflicts or missing real ones.

### Solution: reuse `metadata.json` per Remote

`createdAt` and `updatedAt` (server-generated, remote-specific) live alongside `id` inside `metadata.json`. `publishedAt` (user-defined) stays in frontmatter since it is the same logical value across remotes.

```jsonc
// .leadcms/remotes/production/metadata.json
{
  "content": {
    "en": {
      "blog/my-post": {
        "createdAt": "2026-01-15T10:00:00Z",
        "updatedAt": "2026-03-01T14:30:00Z"
      },
      "blog/another": {
        "createdAt": "2026-02-01T09:00:00Z",
        "updatedAt": "2026-02-28T16:45:00Z"
      }
    }
  }
}

// .leadcms/remotes/develop/metadata.json
{
  "content": {
    "en": {
      "blog/my-post": {
        "createdAt": "2026-03-05T11:00:00Z",
        "updatedAt": "2026-03-10T09:15:00Z"
      }
    }
  }
}
```

The same nested shape is used for `emailTemplates` inside `metadata.json`.

### How It Works

**On pull** (from remote X):

- Save the remote's `createdAt` and `updatedAt` to X's `metadata.json`
- `publishedAt` is written to frontmatter (it is user-defined content, same across remotes)
- For content: write `createdAt` / `updatedAt` to frontmatter only from the default remote
- For email templates: write `createdAt` / `updatedAt` to local file metadata only from the default remote
- For non-default remotes, these values are preserved in the per-remote map instead of replacing local default-remote metadata

**On push** (to remote X):

- Read the conflict baseline `updatedAt` from X's `metadata.json` (not from frontmatter)
- Compare against remote's current `updatedAt` for conflict detection
- After successful push, update X's `metadata.json` with the response timestamps

**Three-way merge** (pull from remote X):

- `SERVER_CONTROLLED_FIELDS` for `createdAt`/`updatedAt`: resolution uses X's incoming values (already correct — the remote provides them)
- `publishedAt`: still server-controlled in merge behavior (take remote value if different), but the value is user-defined and written to frontmatter
- No change needed in merge algorithm itself; only the storage/retrieval of the baseline changes

---

## Frontmatter vs External Storage: Analysis

The question of where to store `id`, `createdAt`, and `updatedAt` has significant implications for backward compatibility, git history noise, and multi-remote correctness.

### Option A: Keep Default Remote's Values in Frontmatter (Recommended)

**How it works**: Frontmatter contains `id`, `createdAt`, `updatedAt` from the **default remote** only. Non-default remotes store these values exclusively in their `metadata.json`.

| Pros                                                                                                                                                          | Cons                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Backward compatible** — existing sites that read `id`, `createdAt`, `updatedAt` from frontmatter continue to work without changes                           | Frontmatter still changes when pulling from the default remote, generating some git noise |
| **No migration needed** — single-remote projects work identically to today                                                                                    | Switching the default remote triggers frontmatter rewrites across all files               |
| **Framework integrations preserved** — `CMSContent.id`, `publishedAt`, `updatedAt` remain accessible from file-based content loading (Astro, Next.js, Gatsby) | Developers must understand that frontmatter values belong to the default remote           |
| **Gradual adoption** — teams can add multi-remote without touching existing content files                                                                     |                                                                                           |

### Option B: Remove All Server-Generated Values from Frontmatter

**How it works**: `id`, `createdAt`, `updatedAt` are stored ONLY in per-remote `metadata.json`. Frontmatter contains only user-authored fields (`title`, `description`, `body`, `slug`, `type`, `language`, `publishedAt`, `tags`, etc).

| Pros                                                                                                                          | Cons                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cleanest git history** — content file changes are always meaningful (actual content edits), never just timestamp/ID updates | **Breaking change** — any site reading `id`, `createdAt`, or `updatedAt` from frontmatter breaks                                                                            |
| **No remote-switching noise** — changing default remote has zero effect on content files                                      | **Migration required** — all existing content files need `id`/`createdAt`/`updatedAt` stripped                                                                              |
| **Simpler mental model** — frontmatter = content, metadata files = sync state                                                 | `CMSContent` interface must change: `id` source changes from frontmatter to metadata lookup                                                                                 |
| **No ambiguity** about which remote's values are in frontmatter                                                               | **Draft detection** via `isDraft()` currently uses `publishedAt` from frontmatter — this still works (we keep `publishedAt`) but `createdAt` is lost from file-level access |
|                                                                                                                               | Frameworks that statically build from content files (e.g., Astro content collections) lose access to `createdAt`/`updatedAt` without SDK helper functions                   |

### Option C: Hybrid — Remove Only `id` from Frontmatter, Keep Timestamps

**How it works**: `id` moves to `metadata.json` exclusively. `createdAt`/`updatedAt` from default remote stay in frontmatter.

| Pros                                                        | Cons                                                                        |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| Eliminates the most problematic field (ID) from frontmatter | Still has timestamp git noise from default remote                           |
| Timestamps remain accessible for frameworks                 | `id` removal is still a breaking change for consumers using `CMSContent.id` |
| Smaller migration (only strip `id`, not timestamps)         | Inconsistent — some server values in frontmatter, some not                  |

### Recommendation: Option A (Default Remote Values in Frontmatter)

**Rationale**:

1. **Backward compatibility wins** — LeadCMS SDK is used across multiple frameworks, and any consumer that reads `id` or `updatedAt` from file content would break with Option B.

2. **Git noise is manageable** — In multi-remote setups, only pulling from the _default remote_ updates frontmatter. Pushing to target remotes (develop, staging) never touches frontmatter. The common workflow (pull from production, push to develop) generates no extra git noise beyond what already exists today.

3. **Option B is a future possibility** — Once per-remote `metadata.json` is established (Phases 3-4), a future major version (v4) could offer a config flag like `"externalizeMetadata": true` that stops writing `id`/`createdAt`/`updatedAt` to frontmatter entirely. This gives teams an opt-in migration path.

4. **`publishedAt` stays in frontmatter regardless** — It is user-defined content, not server-generated sync state. It belongs in frontmatter in all options.

**The implementation for Option A**:

- Default remote: `id`, `createdAt`, `updatedAt` written to both frontmatter AND the remote's map files
- Non-default remotes: `id`, `createdAt`, `updatedAt` written ONLY to the remote's map files
- `publishedAt`: always written to frontmatter (user-defined, same across remotes)
- Future v4 flag `"externalizeMetadata": true`: disables frontmatter writes for `id`/`createdAt`/`updatedAt` entirely

---

## CLI Changes

### Remote Management Commands

```bash
# List all configured remotes
leadcms remote list
# Output:
#   * production  https://prod.leadcms.example.com  [default]
#     develop     https://dev.leadcms.example.com

# Add a new remote
leadcms remote add <name> <url>
leadcms remote add production https://prod.example.com
leadcms remote add develop https://dev.example.com

# Remove a remote
leadcms remote remove <name>

# Set the default remote
leadcms remote set-default <name>

# Show details about a remote
leadcms remote show <name>
# Output:
#   Remote: production
#   URL: https://prod.leadcms.example.com
#   API Key: configured (LEADCMS_REMOTE_PRODUCTION_API_KEY)
#   Content sync token: 2026-03-01T14:30:00Z
#   Media sync token: 2026-02-28T16:45:00Z
#   Mapped content items: 42

# Reset remote state (sync tokens and metadata)
# Useful after DB migration or when remote state becomes stale
leadcms remote reset <name>
```

### --remote / -r Flag on All Commands

```bash
# Pull from a specific remote
leadcms pull --remote production
leadcms pull -r production
leadcms pull-content -r production --force

# Push to a specific remote
leadcms push --remote develop
leadcms push -r develop --force

# Status against a specific remote
leadcms status --remote production
leadcms status-content -r develop

# Watch a specific remote
leadcms watch -r production

# Without --remote: uses defaultRemote
leadcms pull                    # uses production (if default)
leadcms push                    # uses production (if default)
```

---

## The Production → Local → Develop Workflow

Complete example of the target multi-remote workflow:

```bash
# ── Initial Setup ───────────────────────────────────────────────

# Configure remotes
leadcms remote add production https://prod.cms.com
leadcms remote add develop https://dev.cms.com
leadcms remote set-default production

# Set API keys
export LEADCMS_REMOTE_PRODUCTION_API_KEY=prod-key-xxx
export LEADCMS_REMOTE_DEVELOP_API_KEY=dev-key-xxx

# ── Pull from Production ────────────────────────────────────────

leadcms pull -r production
# → Uses production's sync token (from .leadcms/remotes/production/)
# → Three-way merge with any local changes
# → Updates production's metadata.json with received IDs and timestamps
# → Writes IDs and timestamps to frontmatter (production = default)
# → Saves new sync token to production's directory

# ── Developer Edits Content Locally ─────────────────────────────

# Edit MDX/JSON files in .leadcms/content/ as usual

# ── Push to Develop ─────────────────────────────────────────────

leadcms push -r develop --force
# → Reads develop's metadata.json to find correct IDs for PUT calls
# → Reads develop's metadata.json for conflict baseline (skipped with --force)
# → Items without develop ID → matched by slug+language, or created new
# → Stores new/updated IDs and timestamps in develop's metadata.json
# → Does NOT update frontmatter timestamps (develop ≠ default remote)
# → Production sync state completely untouched

# ── Later: Pull Production Updates ──────────────────────────────

leadcms pull -r production
# → Production's sync token is still correct and accurate
# → Incremental sync retrieves only what changed since last production pull
# → Three-way merge works correctly (base items match production's state)
# → Updates production's metadata.json
# → Updates frontmatter timestamps (production = default)

# ── Push Merged Content to Develop ──────────────────────────────

leadcms push -r develop --force
# → Develop's metadata has the correct develop IDs
# → Correctly maps merged content to develop's content items
# → New content from production gets created fresh on develop
# → Develop's metadata.json updated with new baselines

# ── Check Status Against Either Remote ──────────────────────────

leadcms status -r production    # What would change if we pushed to production?
leadcms status -r develop       # What would change if we pushed to develop?
```

---

## Internal Architecture: `RemoteContext`

All operations that interact with a remote need a `RemoteContext` object threaded through:

```typescript
interface RemoteConfig {
  url: string;
}

interface RemoteContext {
  /** Remote name (e.g., "production", "develop", or "default" for single-remote) */
  name: string;
  /** CMS instance URL */
  url: string;
  /** API key (resolved from env vars) */
  apiKey?: string;
  /** Whether this is the default remote */
  isDefault: boolean;
  /** Path to remote state directory: .leadcms/remotes/{name}/ */
  stateDir: string;
}
```

### Resolution Logic

```typescript
function resolveRemote(remoteName?: string): RemoteContext {
  const config = getConfig();

  // Single-remote mode (no remotes block)
  if (!config.remotes) {
    return {
      name: "default",
      url: config.url,
      apiKey: config.apiKey,
      isDefault: true,
      stateDir: ".leadcms/remotes/default/",
    };
  }

  // Multi-remote mode
  const name = remoteName || config.defaultRemote;
  const remote = config.remotes[name];
  const apiKey = resolveApiKey(name);

  return {
    name,
    url: remote.url,
    apiKey,
    isDefault: name === config.defaultRemote,
    stateDir: `.leadcms/remotes/${name}/`,
  };
}

function resolveApiKey(remoteName: string): string | undefined {
  const envName = remoteName.toUpperCase().replace(/-/g, "_");
  return (
    process.env[`LEADCMS_REMOTE_${envName}_API_KEY`] ||
    (remoteName === getConfig().defaultRemote
      ? process.env.LEADCMS_API_KEY || process.env.NEXT_PUBLIC_LEADCMS_API_KEY
      : undefined)
  );
}
```

### Refactoring `leadcms-helpers.ts`

Currently, `leadCMSUrl` and `leadCMSApiKey` are module-level constants computed at import time:

```typescript
// Current (problematic for multi-remote)
const config = getConfig();
export const leadCMSUrl = config.url;
export const leadCMSApiKey = config.apiKey;
```

These must become functions or accept `RemoteContext`:

```typescript
// New: context-aware helpers
export function getRemoteUrl(ctx: RemoteContext): string {
  return ctx.url;
}

export function getRemoteApiKey(ctx: RemoteContext): string | undefined {
  return ctx.apiKey;
}

// During transition: module-level exports maintained for backward compat
// but marked @deprecated, resolving from default remote
export const leadCMSUrl = getConfig().url; // @deprecated: use RemoteContext
export const leadCMSApiKey = getConfig().apiKey; // @deprecated: use RemoteContext
```

Every function that calls the API (`pullContentSync`, `pushContent`, etc.) gains a `RemoteContext` parameter. Functions that currently use module-level `leadCMSUrl` / `leadCMSApiKey` switch to reading from the context.

---

## Sync Token Functions

```typescript
// Current
async function readSyncToken(): Promise<{
  token: string | undefined;
  migrated: boolean;
}>;
async function writeSyncToken(token: string): Promise<void>;

// New: remote-aware
async function readSyncToken(
  ctx: RemoteContext,
  entityType: "content" | "media" | "comments",
): Promise<{ token: string | undefined; migrated: boolean }>;
async function writeSyncToken(
  ctx: RemoteContext,
  entityType: "content" | "media" | "comments",
  token: string,
): Promise<void>;

// Token path resolution
function syncTokenPath(ctx: RemoteContext, entityType: string): string {
  return path.join(ctx.stateDir, `${entityType}-sync-token`);
}
```

---

## Metadata Functions

```typescript
interface MetadataEntry {
  id?: number | string;
  createdAt?: string;
  updatedAt?: string;
}

interface MetadataMap {
  content: Record<string, Record<string, MetadataEntry>>;
  emailTemplates?: Record<string, Record<string, MetadataEntry>>;
}

async function readMetadataMap(ctx: RemoteContext): Promise<MetadataMap>;
async function writeMetadataMap(
  ctx: RemoteContext,
  map: MetadataMap,
): Promise<void>;

// Canonical key for a content item
function contentKey(language: string, slug: string): string {
  return `${language}/${slug}`;
}

// Resolve the remote-specific ID for a content item
function resolveContentId(
  ctx: RemoteContext,
  metadataMap: MetadataMap,
  language: string,
  slug: string,
): number | string | undefined {
  return metadataMap.content[language]?.[slug]?.id;
}
```

---

## Metadata Map Functions

```typescript
interface RemoteTimestamps {
  createdAt?: string;
  updatedAt?: string;
  // NOTE: publishedAt is user-defined and stays in frontmatter.
  // It is NOT stored in per-remote metadata.
}

type MetadataMap = Record<string, RemoteTimestamps>; // key = canonical content key

async function readMetadataMap(ctx: RemoteContext): Promise<MetadataMap>;
async function writeMetadataMap(
  ctx: RemoteContext,
  map: MetadataMap,
): Promise<void>;

// Read conflict detection baseline for a specific content item
function getRemoteUpdatedAt(
  metadataMap: MetadataMap,
  language: string,
  slug: string,
): Date {
  const key = contentKey(language, slug);
  const ts = metadataMap[key]?.updatedAt;
  return ts ? new Date(ts) : new Date(0);
}
```

### Push Conflict Detection Change

```typescript
// Current: reads updatedAt from frontmatter
const localUpdated = local.metadata.updatedAt
  ? new Date(local.metadata.updatedAt)
  : new Date(0);

// New: reads updatedAt from remote-specific metadata map
const metadataMap = await readMetadataMap(ctx);
const localBaseline = getRemoteUpdatedAt(metadataMap, local.locale, local.slug);

const remoteUpdated = match.updatedAt ? new Date(match.updatedAt) : new Date(0);

if (remoteUpdated > localBaseline) {
  // Conflict: remote changed since our last sync with THIS remote
}
```

---

## Config Schema Changes

```typescript
interface RemoteConfig {
  /** CMS instance URL */
  url: string;
}

interface LeadCMSConfig {
  // ... existing fields ...

  /** Named remote CMS instances */
  remotes?: Record<string, RemoteConfig>;
  /** Default remote name (used when --remote is not specified) */
  defaultRemote?: string;
}
```

Validation rules:

- If `remotes` is present, `defaultRemote` must reference an existing remote
- If `remotes` is present but `defaultRemote` is missing, error with explicit instruction
- Remote names: alphanumeric + hyphens, lowercase, no spaces
- If both `remotes` and flat `url` exist: warn and prefer `remotes`

---

## Implementation Phases

### Phase 1: Per-Remote Sync Tokens (Fixes the Immediate Bug)

**Scope**: Isolate sync tokens per remote so pulling from one instance never corrupts another's sync state.

- Add `--remote` / `-r` flag to pull/push/status CLI commands
- Add `remotes` + `defaultRemote` to `LeadCMSConfig` interface
- Implement `RemoteContext` resolution (`resolveRemote()`)
- Store sync tokens under `.leadcms/remotes/{name}/`
- Thread `RemoteContext` through `readSyncToken()` / `writeSyncToken()`
- Refactor `leadcms-helpers.ts` to resolve URL/apiKey from context
- Migration: auto-detect and move existing tokens when `remotes` config appears
- Backward compat: no `remotes` → single implicit `"default"` remote

**What this fixes**: Sync token cross-contamination between instances.

### Phase 2: Remote Management Commands

**Scope**: User-friendly remote configuration.

- `leadcms remote add/remove/list/show/set-default` commands
- Interactive `leadcms init` updated to ask about multiple remotes
- Config file reader/writer for `remotes` block
- API key env var resolution with helpful error messages
- `leadcms remote show` displays sync state and connectivity

### Phase 3: Per-Remote Metadata

**Scope**: Content identity isolation so the same content can be tracked across instances.

- `metadata.json` per remote
- Modify push to resolve content ID from remote-specific map
- Modify pull to update the map on content receipt
- Modify post-push metadata sync to update the correct remote's map
- Frontmatter `id` = default remote's ID (backward compat)
- Push `--force`: handle ID mismatches gracefully when intentional overwrite is needed

**What this fixes**: ID conflicts when pushing content between instances.

### Phase 4: Per-Remote Timestamps

**Scope**: Correct conflict detection per remote.

- `metadata.json` per remote
- Modify push conflict detection to read baseline from remote-specific metadata (not frontmatter)
- Modify post-push sync to update remote-specific metadata
- Modify pull to save timestamps to remote-specific metadata
- Frontmatter timestamps = default remote's timestamps (backward compat)
- Three-way merge continues to use incoming remote values (no change)

**What this fixes**: False conflicts when pushing to a different remote than last pulled from.

### Phase 5: Explicit Behavioral Defaults

**Scope**: Keep behavior predictable across all remotes and require explicit flags for destructive operations.

- All remotes use the same default behavior for pull/push/status operations
- `--force` remains explicit on push (never implied by remote configuration)
- Keep warnings and conflict checks consistent regardless of selected remote

---

## Files Requiring Changes

| File                                  | Phase   | Changes                                                                     |
| ------------------------------------- | ------- | --------------------------------------------------------------------------- |
| `src/lib/config.ts`                   | 1       | Add `remotes`, `defaultRemote` to interface; validation; env var resolution |
| `src/lib/cms-config-types.ts`         | 1       | `RemoteConfig`, `RemoteContext` types                                       |
| `src/scripts/leadcms-helpers.ts`      | 1       | Deprecate module-level constants; add context-aware helpers                 |
| `src/scripts/pull-leadcms-content.ts` | 1, 4    | Remote-aware sync tokens; remote-aware timestamp storage                    |
| `src/scripts/push-leadcms-content.ts` | 1, 3, 4 | Remote-aware URL/key; metadata lookup; timestamp baseline from metadata     |
| `src/scripts/pull-content.ts`         | 1       | Thread `--remote` through to pull functions                                 |
| `src/cli/index.ts`                    | 1, 2    | `--remote` flag on all commands; `remote` subcommands                       |
| `src/lib/data-service.ts`             | 1       | Accept URL/apiKey per call instead of from module-level config              |
| `src/lib/content-merge.ts`            | 4       | No algorithmic changes; timestamp source changes in callers                 |
| `src/lib/content-transformation.ts`   | 3, 4    | Conditional frontmatter ID/timestamp writes based on `isDefault`            |
| `src/scripts/push-comments.ts`        | 1, 3    | Remote-aware API calls and metadata lookup                                  |
| `src/scripts/push-media.ts`           | 1       | Remote-aware API calls                                                      |
| `src/scripts/settings-manager.ts`     | 1       | Remote-aware API calls                                                      |
| `src/scripts/sse-watcher.ts`          | 1       | Remote-aware SSE connection                                                 |
| `leadcms.config.json.sample`          | 2       | Add `remotes` example                                                       |

---

## .gitignore Considerations

```gitignore
# Remote state (sync tokens, metadata, timestamps) — developer-local state
.leadcms/remotes/
```

OR selectively:

```gitignore
# Sync tokens are developer-local
.leadcms/remotes/*/content-sync-token
.leadcms/remotes/*/media-sync-token
.leadcms/remotes/*/comments-sync-token

# Metadata COULD be committed (shared team state)
# .leadcms/remotes/*/metadata.json
```

Whether `metadata.json` is committed is a team decision. Committing it means new team members get the correct remote IDs and timestamp baselines without pulling first. Not committing means each developer builds their own metadata locally.

---

## Edge Cases

### Creating Content on Develop, Then Pushing to Production

1. Developer creates `en/blog/new-post.mdx` locally
2. `leadcms push -r develop` → created on develop with ID 12 → stored in develop's metadata
3. `leadcms push -r production` → no production ID in metadata → matched by slug or created new → gets ID 87 → stored in production's metadata
4. Frontmatter `id` = 87 (production is default remote)
5. Both remotes now track the content with their own IDs

### Renaming a Slug

1. Developer renames `my-post.mdx` → `my-updated-post.mdx`
2. Push to either remote: slug-change detection works via metadata lookup (lookup by old slug → finds ID → recognized as rename)
3. Both metadata files updated with new canonical key

### Deleting Content

1. `leadcms push -r develop --delete` → deletes remote items not in local
2. Develop's metadata entries removed for deleted items
3. Production's metadata unaffected

### Reset / Fresh Start

```bash
leadcms pull -r production --reset
# → Deletes production's sync tokens and metadata
# → Full fresh pull from production
# → Rebuilds all production mappings from scratch
```

### Switching Default Remote

```bash
leadcms remote set-default develop
# → Next pull/push without --remote goes to develop
# → Frontmatter IDs and timestamps now reflect develop's values
# → Requires a pull from develop to update frontmatter
```

### Production DB Migrated to Develop Environment

A common scenario: the production database is copied/restored into the develop environment (e.g., to reset dev to a known state or to test with real data).

**What happens**:

- Develop's backend now has production's data, but the SDK's _develop remote state_ (sync token and metadata) still reflects the old develop instance
- The develop sync token points to a position in the old develop's change log — but the underlying DB is now production's, with a completely different change history
- Content IDs on develop are now production's IDs — so develop's `metadata.json` has stale mappings

**Does change detection "just work"?**

No. The develop sync token is invalid for the new DB. Incremental sync would return incorrect or incomplete results.

**Solution: `leadcms remote reset`**

```bash
leadcms remote reset develop
# → Deletes develop's sync tokens and metadata
# → Next pull from develop will be a full fresh sync
# → Next push to develop will re-match all content by slug+language
```

This is equivalent to `leadcms pull -r develop --reset` but explicitly scoped to the remote's state only (does not touch local content files or other remotes).

For the common case of "dev was reset to prod data":

```bash
# 1. Reset develop remote state
leadcms remote reset develop

# 2. Push local content (which already matches production) to develop
#    Since IDs are now production's IDs, slug+language matching will
#    correctly identify existing content and build new metadata entries
leadcms push -r develop --force
```

Alternatively, if the developer wants to pull first to verify:

```bash
leadcms remote reset develop
leadcms pull -r develop
# → Full sync (no token), gets all content with production IDs
# → Rebuilds develop's metadata from scratch
# → Three-way merge with local changes (if any differ)
```
