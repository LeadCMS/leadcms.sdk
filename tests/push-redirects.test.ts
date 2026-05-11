/**
 * Tests for push-redirects.ts
 *
 * Covers:
 *  - Create new redirects (no id in local YAML)
 *  - Update changed redirects (surrogate-key match, payload differs)
 *  - Skip unchanged redirects (surrogate-key match, payload identical)
 *  - Delete remote-only redirects when allowDelete=true
 *  - Dry run mode (no API calls, no file writes)
 *  - Auto-detected source/target types in create payload
 *  - No id/dates written back to local YAML after push
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import yaml from 'js-yaml';
let redirectsDir = '/tmp/test-push-redirects';

jest.mock('../src/scripts/leadcms-helpers.js', () => ({
  get REDIRECTS_DIR() { return redirectsDir; },
  leadCMSUrl: 'https://test.leadcms.com',
  leadCMSApiKey: 'test-api-key',
}));

// ── Mock data service ─────────────────────────────────────────────────

const mockGetAllRedirects = jest.fn();
const mockCreateRedirect = jest.fn();
const mockUpdateRedirect = jest.fn();
const mockDeleteRedirect = jest.fn();
const mockConfigureForRemote = jest.fn();

jest.mock('../src/lib/data-service.js', () => ({
  leadCMSDataService: {
    getAllRedirects: (...args: any[]) => mockGetAllRedirects(...args),
    createRedirect: (...args: any[]) => mockCreateRedirect(...args),
    updateRedirect: (...args: any[]) => mockUpdateRedirect(...args),
    deleteRedirect: (...args: any[]) => mockDeleteRedirect(...args),
    configureForRemote: (...args: any[]) => mockConfigureForRemote(...args),
  },
}));

import type { LocalRedirectsFile, RedirectDetailsDto } from '../src/lib/automation-types';
import { buildRedirectsFile, flattenRedirectsFile } from '../src/lib/automation-types';
import { buildRedirectStatus, pushRedirects } from '../src/scripts/push-redirects';

// ── Test data helpers ─────────────────────────────────────────────────

function makeLocal(overrides: Partial<any> = {}): any {
  return {
    kind: 'Permanent',
    fromPath: '/old',
    toUrl: 'https://example.com',
    ...overrides,
  };
}

function makeRemote(overrides: Partial<RedirectDetailsDto> = {}): RedirectDetailsDto {
  return {
    id: 1,
    sourceType: 'InternalPath',
    targetType: 'ExternalUrl',
    kind: 'Permanent',
    fromPath: '/old',
    fromLanguage: null,
    fromSlug: null,
    fromContentId: null,
    toUrl: 'https://example.com',
    toPath: null,
    toLanguage: null,
    toSlug: null,
    toContentId: null,
    isAutoDiscovered: false,
    isAutoDiscoverySuppressed: false,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: null,
    ...overrides,
  };
}

async function writeLocalRedirects(dir: string, redirects: any[]): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const file = buildRedirectsFile(redirects);
  const content = yaml.dump(file, { indent: 2 });
  await fs.writeFile(path.join(dir, 'redirects.yaml'), content, 'utf8');
}

/** Read the redirects.yaml and flatten to a LocalRedirect[] for assertions. */
async function readParsedRedirects(dir: string): Promise<any[]> {
  const raw = await fs.readFile(path.join(dir, 'redirects.yaml'), 'utf8');
  const file = yaml.load(raw) as LocalRedirectsFile;
  return flattenRedirectsFile(file);
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('pushRedirects', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'leadcms-push-red-'));
    redirectsDir = tmpDir;
    mockGetAllRedirects.mockReset();
    mockCreateRedirect.mockReset();
    mockUpdateRedirect.mockReset();
    mockDeleteRedirect.mockReset();
    mockConfigureForRemote.mockReset();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ── Create ────────────────────────────────────────────────────────

  it('creates a new redirect when local has no id', async () => {
    const local = makeLocal({ id: undefined });
    await writeLocalRedirects(tmpDir, [local]);

    mockGetAllRedirects.mockResolvedValueOnce([]);
    const created = makeRemote({ id: 99, fromPath: '/old', toUrl: 'https://example.com' });
    mockCreateRedirect.mockResolvedValueOnce(created);

    await pushRedirects({ dryRun: false });

    expect(mockCreateRedirect).toHaveBeenCalledTimes(1);
    const arg = mockCreateRedirect.mock.calls[0][0];
    expect(arg.sourceType).toBe('InternalPath');
    expect(arg.targetType).toBe('ExternalUrl');
    expect(arg.kind).toBe('Permanent');
  });

  it('does not write id or server-managed fields back to local YAML after create', async () => {
    const local = makeLocal();
    await writeLocalRedirects(tmpDir, [local]);

    mockGetAllRedirects.mockResolvedValueOnce([]);
    mockCreateRedirect.mockResolvedValueOnce(
      makeRemote({ id: 42, fromPath: '/old', toUrl: 'https://example.com', updatedAt: '2024-06-01T00:00:00Z' }),
    );

    await pushRedirects({ dryRun: false });

    const items = await readParsedRedirects(tmpDir);
    expect((items[0] as any).id).toBeUndefined();
    expect((items[0] as any).createdAt).toBeUndefined();
    expect((items[0] as any).updatedAt).toBeUndefined();
  });

  // ── Update ────────────────────────────────────────────────────────

  it('updates a redirect when local and remote payloads differ', async () => {
    const local = makeLocal({ id: 1, toUrl: 'https://new-url.com' });
    await writeLocalRedirects(tmpDir, [local]);

    const remote = makeRemote({ id: 1, toUrl: 'https://old-url.com' });
    mockGetAllRedirects.mockResolvedValueOnce([remote]);
    mockUpdateRedirect.mockResolvedValueOnce(makeRemote({ id: 1, toUrl: 'https://new-url.com' }));

    await pushRedirects({ dryRun: false });

    expect(mockUpdateRedirect).toHaveBeenCalledTimes(1);
    expect(mockUpdateRedirect.mock.calls[0][0]).toBe(1);
  });

  it('skips update when local and remote payloads are identical', async () => {
    const local = makeLocal({ id: 1, fromPath: '/old', toUrl: 'https://example.com' });
    await writeLocalRedirects(tmpDir, [local]);

    const remote = makeRemote({ id: 1, fromPath: '/old', toUrl: 'https://example.com' });
    mockGetAllRedirects.mockResolvedValueOnce([remote]);

    await pushRedirects({ dryRun: false });

    expect(mockUpdateRedirect).not.toHaveBeenCalled();
    expect(mockCreateRedirect).not.toHaveBeenCalled();
  });

  // ── Delete ────────────────────────────────────────────────────────

  it('deletes remote-only redirect when allowDelete=true', async () => {
    // Local has redirect #1; remote also has #5 (not in local) → #5 should be deleted
    const local = makeLocal({ id: 1, fromPath: '/existing', toUrl: 'https://example.com' });
    await writeLocalRedirects(tmpDir, [local]);
    const remoteMatch = makeRemote({ id: 1, fromPath: '/existing', toUrl: 'https://example.com' });
    const remoteExtra = makeRemote({ id: 5, fromPath: '/remote-only', toUrl: 'https://other.com' });
    mockGetAllRedirects.mockResolvedValueOnce([remoteMatch, remoteExtra]);
    mockDeleteRedirect.mockResolvedValueOnce(undefined);

    await pushRedirects({ allowDelete: true, dryRun: false });

    expect(mockDeleteRedirect).toHaveBeenCalledWith(5);
  });

  it('does NOT delete remote-only redirect when allowDelete is false', async () => {
    await writeLocalRedirects(tmpDir, []);
    mockGetAllRedirects.mockResolvedValueOnce([makeRemote({ id: 5 })]);

    await pushRedirects({ allowDelete: false, dryRun: false });

    expect(mockDeleteRedirect).not.toHaveBeenCalled();
  });

  // ── Dry run ───────────────────────────────────────────────────────

  it('does not call create/update/delete in dry run mode', async () => {
    const local = makeLocal({ id: undefined });
    await writeLocalRedirects(tmpDir, [local]);
    mockGetAllRedirects.mockResolvedValueOnce([]);

    await pushRedirects({ dryRun: true });

    expect(mockCreateRedirect).not.toHaveBeenCalled();
    expect(mockUpdateRedirect).not.toHaveBeenCalled();
    expect(mockDeleteRedirect).not.toHaveBeenCalled();
  });

  it('dry run does not modify the local YAML file', async () => {
    const local = makeLocal({ id: undefined, fromPath: '/dry-test', toUrl: 'https://example.com' });
    await writeLocalRedirects(tmpDir, [local]);
    const filePath = path.join(tmpDir, 'redirects.yaml');
    const statBefore = await fs.stat(filePath);

    mockGetAllRedirects.mockResolvedValueOnce([]);

    await pushRedirects({ dryRun: true });

    const statAfter = await fs.stat(filePath);
    expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
  });

  // ── ContentSlug type detection ────────────────────────────────────

  it('auto-detects ContentSlug source and target types', async () => {
    const local = makeLocal({
      id: undefined,
      fromPath: undefined,
      fromLanguage: 'en',
      fromSlug: 'old-article',
      toUrl: undefined,
      toLanguage: 'en',
      toSlug: 'new-article',
    });
    await writeLocalRedirects(tmpDir, [local]);
    mockGetAllRedirects.mockResolvedValueOnce([]);
    mockCreateRedirect.mockResolvedValueOnce(makeRemote({ id: 7, fromLanguage: 'en', fromSlug: 'old-article' }));

    await pushRedirects({ dryRun: false });

    const arg = mockCreateRedirect.mock.calls[0][0];
    expect(arg.sourceType).toBe('ContentSlug');
    expect(arg.targetType).toBe('ContentSlug');
    expect(arg.fromLanguage).toBe('en');
    expect(arg.fromSlug).toBe('old-article');
    expect(arg.toSlug).toBe('new-article');
  });

  // ── No local file ─────────────────────────────────────────────────

  it('handles missing redirects.yaml gracefully (no ops)', async () => {
    // tmpDir is empty — no redirects.yaml
    mockGetAllRedirects.mockResolvedValueOnce([makeRemote({ id: 1 })]);

    await expect(pushRedirects({ dryRun: false })).resolves.not.toThrow();
    // No local redirects means nothing to create or update; no delete without allowDelete
    expect(mockCreateRedirect).not.toHaveBeenCalled();
    expect(mockDeleteRedirect).not.toHaveBeenCalled();
  });

  // ── Multiple redirects ────────────────────────────────────────────

  it('handles multiple create operations in one push', async () => {
    const locals = [
      makeLocal({ fromPath: '/a', toUrl: 'https://a.com' }),
      makeLocal({ fromPath: '/b', toUrl: 'https://b.com' }),
    ];
    await writeLocalRedirects(tmpDir, locals);
    mockGetAllRedirects.mockResolvedValueOnce([]);
    mockCreateRedirect
      .mockResolvedValueOnce(makeRemote({ id: 10, fromPath: '/a', toUrl: 'https://a.com' }))
      .mockResolvedValueOnce(makeRemote({ id: 11, fromPath: '/b', toUrl: 'https://b.com' }));

    await pushRedirects({ dryRun: false });

    expect(mockCreateRedirect).toHaveBeenCalledTimes(2);
  });
});

// ── buildRedirectStatus ───────────────────────────────────────────────────────

describe('buildRedirectStatus', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'leadcms-red-status-'));
    redirectsDir = tmpDir;
    mockGetAllRedirects.mockReset();
    mockCreateRedirect.mockReset();
    mockUpdateRedirect.mockReset();
    mockDeleteRedirect.mockReset();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('reports create operation for local redirect not present remotely', async () => {
    await writeLocalRedirects(tmpDir, [makeLocal({ fromPath: '/new', toUrl: 'https://example.com' })]);
    mockGetAllRedirects.mockResolvedValueOnce([]);

    const result = await buildRedirectStatus();

    expect(result.totalLocal).toBe(1);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].type).toBe('create');
    expect(result.operations[0].local?.fromPath).toBe('/new');
  });

  it('reports update operation when local and remote payloads differ', async () => {
    await writeLocalRedirects(tmpDir, [makeLocal({ fromPath: '/existing', toUrl: 'https://new.com' })]);
    mockGetAllRedirects.mockResolvedValueOnce([makeRemote({ id: 3, fromPath: '/existing', toUrl: 'https://old.com' })]);

    const result = await buildRedirectStatus();

    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].type).toBe('update');
    expect(result.operations[0].remote?.id).toBe(3);
  });

  it('reports no operations when local and remote are in sync', async () => {
    await writeLocalRedirects(tmpDir, [makeLocal({ fromPath: '/same', toUrl: 'https://example.com' })]);
    mockGetAllRedirects.mockResolvedValueOnce([makeRemote({ id: 1, fromPath: '/same', toUrl: 'https://example.com' })]);

    const result = await buildRedirectStatus();

    expect(result.totalLocal).toBe(1);
    expect(result.operations).toHaveLength(0);
  });

  it('reports delete operation for remote-only redirect when showDelete=true', async () => {
    await writeLocalRedirects(tmpDir, []);
    mockGetAllRedirects.mockResolvedValueOnce([makeRemote({ id: 12, fromPath: '/gone', toUrl: 'https://example.com' })]);

    const result = await buildRedirectStatus({ showDelete: true });

    expect(result.operations).toHaveLength(1);
    expect(result.operations[0].type).toBe('delete');
    expect(result.operations[0].remote?.id).toBe(12);
  });

  it('does NOT report delete operation for remote-only redirect when showDelete=false', async () => {
    await writeLocalRedirects(tmpDir, []);
    mockGetAllRedirects.mockResolvedValueOnce([makeRemote({ id: 12, fromPath: '/gone', toUrl: 'https://example.com' })]);

    const result = await buildRedirectStatus({ showDelete: false });

    expect(result.operations).toHaveLength(0);
  });

  it('reports delete operation for ContentSlug redirect with no fromLanguage (single-language mode)', async () => {
    // This covers the bug where fromLanguage=null on a remote ContentSlug redirect
    // caused it to be labeled "unknown → unknown" — we verify it surfaces as a delete op
    await writeLocalRedirects(tmpDir, []);
    mockGetAllRedirects.mockResolvedValueOnce([
      makeRemote({
        id: 12,
        sourceType: 'ContentSlug',
        targetType: 'ContentSlug',
        kind: 'Permanent',
        fromPath: null,
        fromLanguage: null,  // language stripped in single-language YAML round-trip
        fromSlug: 'News',
        toUrl: null,
        toPath: null,
        toLanguage: null,
        toSlug: 'news/world-cup-2026',
      }),
    ]);

    const result = await buildRedirectStatus({ showDelete: true });

    expect(result.operations).toHaveLength(1);
    const op = result.operations[0];
    expect(op.type).toBe('delete');
    expect(op.remote?.fromSlug).toBe('News');
    expect(op.remote?.id).toBe(12);
  });

  it('totalLocal reflects the count of local redirects regardless of remote state', async () => {
    const locals = [
      makeLocal({ fromPath: '/a', toUrl: 'https://a.com' }),
      makeLocal({ fromPath: '/b', toUrl: 'https://b.com' }),
      makeLocal({ fromPath: '/c', toUrl: 'https://c.com' }),
    ];
    await writeLocalRedirects(tmpDir, locals);
    mockGetAllRedirects.mockResolvedValueOnce([]);

    const result = await buildRedirectStatus();

    expect(result.totalLocal).toBe(3);
  });
});
