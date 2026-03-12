/**
 * Integration tests: when pulling from a non-default remote, frontmatter
 * metadata (id, createdAt, updatedAt) must always reflect the defaultRemote's
 * values. The pulled remote's own metadata goes only into its per-remote
 * metadata file.
 *
 * Scenario:
 *   Config has remotes prod (default) and local.
 *   Prod's metadata is pre-populated with existing content ids/dates.
 *   We pull from "local" with --reset.  The saved files must carry prod's
 *   metadata, not local's.
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import matter from 'gray-matter';
import { jest } from '@jest/globals';
import { createSyncTestHarness } from './test-helpers';

// ── Temp directory layout ──────────────────────────────────────────────
const tmpRoot = path.join(os.tmpdir(), 'leadcms-pull-default-meta');
const contentDir = path.join(tmpRoot, 'content');
const mediaDir = path.join(tmpRoot, 'media');

// Remote state directories (mirrors .leadcms/remotes/{name}/)
const prodStateDir = path.join(tmpRoot, '.leadcms', 'remotes', 'prod');
const localStateDir = path.join(tmpRoot, '.leadcms', 'remotes', 'local');

const harness = createSyncTestHarness({
  contentDir,
  mediaDir,
  configOverrides: {
    remotes: {
      prod: { url: 'https://cms.prod.example.com' },
      local: { url: 'https://cms.local.example.com' },
    },
    defaultRemote: 'prod',
  },
});

jest.mock('../src/lib/config.js', () => ({
  getConfig: jest.fn(() => harness.config),
}));
jest.mock('axios', () => harness.axiosMock);
jest.mock('../src/lib/data-service.js', () => ({
  leadCMSDataService: {
    getAllEmailGroups: jest.fn(() => Promise.resolve([])),
  },
}));

import { pullLeadCMSContent } from '../src/scripts/pull-leadcms-content';
import { pullLeadCMSEmailTemplates } from '../src/scripts/pull-leadcms-email-templates';
import { parseEmailTemplateFileContent } from '../src/lib/email-template-transformation';

// We need the real remote-context module but must override `REMOTES_BASE_DIR`.
// Since it resolves relative to CWD we use process.chdir().
let originalCwd: string;

beforeEach(async () => {
  originalCwd = process.cwd();
  await harness.setup();
  // Ensure remote state dirs exist
  await fs.mkdir(prodStateDir, { recursive: true });
  await fs.mkdir(localStateDir, { recursive: true });
  // chdir so path.resolve('.leadcms/remotes', name) lands in tmpRoot
  process.chdir(tmpRoot);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await harness.cleanup();
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

// ── Helpers ────────────────────────────────────────────────────────────

function makeLocalCtx() {
  return {
    name: 'local',
    url: 'https://cms.local.example.com',
    apiKey: 'local-key',
    isDefault: false,
    stateDir: localStateDir,
  };
}

async function writeProdMetadata(
  content: Record<string, Record<string, { id?: number | string; createdAt?: string; updatedAt?: string }>>,
  emailTemplates: Record<string, Record<string, { id?: number | string; createdAt?: string; updatedAt?: string }>> = {},
) {
  await fs.writeFile(
    path.join(prodStateDir, 'metadata.json'),
    JSON.stringify({ content, emailTemplates }, null, 2),
  );
}

async function readLocalMetadata(): Promise<{
  content: Record<string, Record<string, { id?: number | string; createdAt?: string; updatedAt?: string }>>;
  emailTemplates: Record<string, Record<string, { id?: number | string; createdAt?: string; updatedAt?: string }>>;
}> {
  const data = JSON.parse(await fs.readFile(path.join(localStateDir, 'metadata.json'), 'utf-8'));
  return data;
}

// ════════════════════════════════════════════════════════════════════════
//  Frontmatter metadata sourced from defaultRemote
// ════════════════════════════════════════════════════════════════════════

describe('pull from non-default remote: frontmatter metadata from defaultRemote', () => {
  it('uses defaultRemote ids and timestamps in frontmatter', async () => {
    // Pre-populate prod's metadata
    await writeProdMetadata({
      en: {
        'hello-world': {
          id: 42,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-06-15T12:00:00Z',
        },
      },
    });

    // Content from the "local" remote has its own different id/dates
    const remoteContent = {
      id: 999,
      slug: 'hello-world',
      type: 'article',
      language: 'en',
      title: 'Hello World',
      description: 'Test article',
      body: '# Hello',
      author: 'test-author',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    };

    harness.addContentSync([remoteContent], [], 'token-1');
    await pullLeadCMSContent({ remoteContext: makeLocalCtx() });

    // Read the saved MDX file
    const filePath = path.join(contentDir, 'hello-world.mdx');
    const fileContent = await fs.readFile(filePath, 'utf8');
    const parsed = matter(fileContent);

    // Frontmatter must have prod's values, NOT local's
    expect(parsed.data.id).toBe(42);
    expect(parsed.data.createdAt).toBe('2025-01-01T00:00:00Z');
    expect(parsed.data.updatedAt).toBe('2025-06-15T12:00:00Z');

    // id and createdAt must appear before title in frontmatter (field order)
    const idPos = fileContent.indexOf('id:');
    const createdAtPos = fileContent.indexOf('createdAt:');
    const titlePos = fileContent.indexOf('title:');
    expect(idPos).toBeLessThan(titlePos);
    expect(createdAtPos).toBeLessThan(titlePos);
  });

  it('does not include empty tags array in frontmatter', async () => {
    await writeProdMetadata({
      en: {
        'no-tags': { id: 50, createdAt: '2025-01-01T00:00:00Z' },
      },
    });

    const remoteContent = {
      id: 600,
      slug: 'no-tags',
      type: 'article',
      language: 'en',
      title: 'No Tags',
      description: 'Article with empty tags',
      body: '# Hello',
      author: 'test-author',
      tags: [],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    harness.addContentSync([remoteContent], [], 'token-tags');
    await pullLeadCMSContent({ remoteContext: makeLocalCtx() });

    const filePath = path.join(contentDir, 'no-tags.mdx');
    const fileContent = await fs.readFile(filePath, 'utf8');
    expect(fileContent).not.toMatch(/^tags:\s*\[\]/m);
  });

  it('omits id/dates from frontmatter when content is new to defaultRemote', async () => {
    // Prod metadata is empty — no entry for this content
    await writeProdMetadata({});

    const remoteContent = {
      id: 100,
      slug: 'brand-new',
      type: 'article',
      language: 'en',
      title: 'Brand New',
      description: 'Not in prod',
      body: '# New',
      author: 'test-author',
      createdAt: '2026-02-01T00:00:00Z',
      updatedAt: '2026-02-01T00:00:00Z',
    };

    harness.addContentSync([remoteContent], [], 'token-2');
    await pullLeadCMSContent({ remoteContext: makeLocalCtx() });

    const filePath = path.join(contentDir, 'brand-new.mdx');
    const fileContent = await fs.readFile(filePath, 'utf8');
    const parsed = matter(fileContent);

    // No prod metadata → fields should be absent
    expect(parsed.data.id).toBeUndefined();
    expect(parsed.data.createdAt).toBeUndefined();
    expect(parsed.data.updatedAt).toBeUndefined();
  });

  it('stores the pulled remote own metadata in its per-remote maps', async () => {
    await writeProdMetadata({
      en: {
        'hello-world': {
          id: 42,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-06-15T12:00:00Z',
        },
      },
    });

    const remoteContent = {
      id: 999,
      slug: 'hello-world',
      type: 'article',
      language: 'en',
      title: 'Hello World',
      description: 'Test',
      body: '# Hello',
      author: 'test-author',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    };

    harness.addContentSync([remoteContent], [], 'token-3');
    await pullLeadCMSContent({ remoteContext: makeLocalCtx() });

    // The local remote's metadata should have its own values (999, not 42)
    const localMeta = await readLocalMetadata();
    expect(localMeta.content['en']['hello-world'].id).toBe(999);
    expect(localMeta.content['en']['hello-world'].createdAt).toBe('2026-01-01T00:00:00Z');
    expect(localMeta.content['en']['hello-world'].updatedAt).toBe('2026-03-01T00:00:00Z');
  });

  it('handles mixed content: some in prod, some not', async () => {
    await writeProdMetadata({
      en: {
        existing: {
          id: 10,
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-06-01T00:00:00Z',
        },
      },
    });

    const existingInProd = {
      id: 500,
      slug: 'existing',
      type: 'article',
      language: 'en',
      title: 'Existing in Prod',
      description: 'Present in prod',
      body: '# Existing',
      author: 'test-author',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    const newInLocal = {
      id: 501,
      slug: 'local-only',
      type: 'article',
      language: 'en',
      title: 'Local Only',
      description: 'Not in prod',
      body: '# Local',
      author: 'test-author',
      createdAt: '2026-02-01T00:00:00Z',
      updatedAt: '2026-02-01T00:00:00Z',
    };

    harness.addContentSync([existingInProd, newInLocal], [], 'token-4');
    await pullLeadCMSContent({ remoteContext: makeLocalCtx() });

    // "existing" should get prod's metadata
    const existingFile = await fs.readFile(path.join(contentDir, 'existing.mdx'), 'utf8');
    const existingParsed = matter(existingFile);
    expect(existingParsed.data.id).toBe(10);
    expect(existingParsed.data.createdAt).toBe('2024-01-01T00:00:00Z');

    // "local-only" should have no id/dates
    const localOnlyFile = await fs.readFile(path.join(contentDir, 'local-only.mdx'), 'utf8');
    const localOnlyParsed = matter(localOnlyFile);
    expect(localOnlyParsed.data.id).toBeUndefined();
    expect(localOnlyParsed.data.createdAt).toBeUndefined();
  });

  it('preserves defaultRemote metadata on repeated pulls', async () => {
    await writeProdMetadata({
      en: {
        stable: {
          id: 7,
          createdAt: '2024-05-01T00:00:00Z',
          updatedAt: '2024-12-01T00:00:00Z',
        },
      },
    });

    const contentV1 = {
      id: 800,
      slug: 'stable',
      type: 'article',
      language: 'en',
      title: 'Stable v1',
      description: 'First version',
      body: '# V1',
      author: 'test-author',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    const contentV2 = {
      id: 800,
      slug: 'stable',
      type: 'article',
      language: 'en',
      title: 'Stable v2',
      description: 'Updated body',
      body: '# V2',
      author: 'test-author',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    };

    harness.addContentSync([contentV1], [], 'token-5');
    harness.addContentSync([contentV2], [], 'token-6');

    await pullLeadCMSContent({ remoteContext: makeLocalCtx() });
    await pullLeadCMSContent({ remoteContext: makeLocalCtx() });

    const fileContent = await fs.readFile(path.join(contentDir, 'stable.mdx'), 'utf8');
    const parsed = matter(fileContent);

    // Even after second pull, frontmatter must still reflect prod values
    expect(parsed.data.id).toBe(7);
    expect(parsed.data.createdAt).toBe('2024-05-01T00:00:00Z');
    expect(parsed.data.updatedAt).toBe('2024-12-01T00:00:00Z');
    // Body should be updated from v2
    expect(parsed.content.trim()).toContain('# V2');
  });
});

// ════════════════════════════════════════════════════════════════════════
//  Email templates: frontmatter metadata sourced from defaultRemote
// ════════════════════════════════════════════════════════════════════════

describe('pull email templates from non-default remote: frontmatter metadata from defaultRemote', () => {
  const emailTemplatesDir = path.join(tmpRoot, 'email-templates');

  it('uses defaultRemote ids and timestamps in email template frontmatter', async () => {
    // Pre-populate prod's metadata with email template data
    await writeProdMetadata({}, {
      en: {
        WelcomeEmail: {
          id: 42,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-06-15T12:00:00Z',
        },
      },
    });

    // Template from the "local" remote has its own different id/dates
    const remoteTemplate = {
      id: 999,
      name: 'WelcomeEmail',
      subject: 'Welcome!',
      bodyTemplate: '<h1>Welcome</h1>',
      fromEmail: 'noreply@example.com',
      fromName: 'Test',
      language: 'en',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    };

    harness.addEmailTemplateSync([remoteTemplate], [], 'et-token-1');
    await pullLeadCMSEmailTemplates(makeLocalCtx());

    // Read the saved HTML file
    const filePath = path.join(emailTemplatesDir, 'ungrouped', 'welcomeemail.html');
    const fileContent = await fs.readFile(filePath, 'utf8');
    const parsed = parseEmailTemplateFileContent(fileContent);

    // Frontmatter must have prod's values, NOT local's
    expect(parsed.metadata.id).toBe(42);
    expect(parsed.metadata.createdAt).toBe('2025-01-01T00:00:00Z');
    expect(parsed.metadata.updatedAt).toBe('2025-06-15T12:00:00Z');
  });

  it('omits id/dates from email template frontmatter when new to defaultRemote', async () => {
    // Prod metadata is empty — no entry for this template
    await writeProdMetadata({}, {});

    const remoteTemplate = {
      id: 100,
      name: 'NewTemplate',
      subject: 'New!',
      bodyTemplate: '<h1>New</h1>',
      fromEmail: 'noreply@example.com',
      fromName: 'Test',
      language: 'en',
      createdAt: '2026-02-01T00:00:00Z',
      updatedAt: '2026-02-01T00:00:00Z',
    };

    harness.addEmailTemplateSync([remoteTemplate], [], 'et-token-2');
    await pullLeadCMSEmailTemplates(makeLocalCtx());

    const filePath = path.join(emailTemplatesDir, 'ungrouped', 'newtemplate.html');
    const fileContent = await fs.readFile(filePath, 'utf8');
    const parsed = parseEmailTemplateFileContent(fileContent);

    // No prod metadata → fields should be absent
    expect(parsed.metadata.id).toBeUndefined();
    expect(parsed.metadata.createdAt).toBeUndefined();
    expect(parsed.metadata.updatedAt).toBeUndefined();
  });

  it('stores the pulled remote own email template metadata in its per-remote maps', async () => {
    await writeProdMetadata({}, {
      en: {
        WelcomeEmail: {
          id: 42,
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-06-15T12:00:00Z',
        },
      },
    });

    const remoteTemplate = {
      id: 999,
      name: 'WelcomeEmail',
      subject: 'Welcome!',
      bodyTemplate: '<h1>Welcome</h1>',
      fromEmail: 'noreply@example.com',
      fromName: 'Test',
      language: 'en',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-03-01T00:00:00Z',
    };

    harness.addEmailTemplateSync([remoteTemplate], [], 'et-token-3');
    await pullLeadCMSEmailTemplates(makeLocalCtx());

    // The local remote's metadata should have its own values (999, not 42)
    const localMeta = await readLocalMetadata();
    expect(localMeta.emailTemplates['en']['WelcomeEmail'].id).toBe(999);
    expect(localMeta.emailTemplates['en']['WelcomeEmail'].createdAt).toBe('2026-01-01T00:00:00Z');
    expect(localMeta.emailTemplates['en']['WelcomeEmail'].updatedAt).toBe('2026-03-01T00:00:00Z');
  });
});
