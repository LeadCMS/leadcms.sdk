/**
 * Tests for pull-redirects.ts
 *
 * Covers:
 *  - mergeRedirects logic (upsert, deletions)
 *  - toLocalRedirect mapping (field preservation, isAutoDiscovered flag)
 *  - YAML file format (redirects sorted by id)
 *  - detectSourceType / detectTargetType helpers
 *  - pullLeadCMSRedirects integration (axios mocked, real temp FS)
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import yaml from 'js-yaml';
import { jest } from '@jest/globals';

// ── Shared mutable state for test control ─────────────────────────────
let redirectsDir = '/tmp/test-redirects';
let stateDirForTest = '/tmp/test-redirects-state';

/** In-memory metadata store keyed by stateDir path. Reset in beforeEach. */
const metadataStore = new Map<string, any>();

jest.mock('../src/scripts/leadcms-helpers.js', () => ({
  get REDIRECTS_DIR() { return redirectsDir; },
  leadCMSUrl: 'https://test.leadcms.com',
  leadCMSApiKey: 'test-api-key',
}));

jest.mock('../src/lib/remote-context.js', () => ({
  syncTokenPath: (ctx: any, entityType: string) =>
    require('path').join(ctx.stateDir, `${entityType}-sync-token`),
  resolveRemote: () => ({
    name: 'default',
    url: 'https://test.leadcms.com',
    isDefault: true,
    get stateDir() { return stateDirForTest; },
  }),
  readMetadataMap: async (ctx: any) =>
    metadataStore.get(ctx.stateDir) ?? { content: {}, redirects: {} },
  writeMetadataMap: async (ctx: any, map: any) =>
    metadataStore.set(ctx.stateDir, map),
}));

const mockAxiosGet = jest.fn<() => Promise<any>>();
const mockAxiosPost = jest.fn<() => Promise<any>>();
jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: (...args: any[]) => mockAxiosGet(...args),
    post: (...args: any[]) => mockAxiosPost(...args),
    create: jest.fn(),
  },
  get: (...args: any[]) => mockAxiosGet(...args),
  post: (...args: any[]) => mockAxiosPost(...args),
}));

// Must come after mocks
import {
  detectSourceType,
  detectTargetType,
  toLocalRedirect,
  buildRedirectsFile,
  flattenRedirectsFile,
} from '../src/lib/automation-types';
import type { RedirectDetailsDto, LocalRedirect, LocalRedirectsFile } from '../src/lib/automation-types';

// ── Test data helpers ─────────────────────────────────────────────────

function makeDto(overrides: Partial<RedirectDetailsDto> = {}): RedirectDetailsDto {
  return {
    id: 1,
    sourceType: 'InternalPath',
    targetType: 'ExternalUrl',
    kind: 'Permanent',
    fromPath: '/old-path',
    fromLanguage: null,
    fromSlug: null,
    fromContentId: null,
    toUrl: 'https://example.com',
    toPath: null,
    toLanguage: null,
    toSlug: null,
    toContentId: null,
    isAutoDiscoverySuppressed: false,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: null,
    ...overrides,
  };
}

// ── Unit: detectSourceType ────────────────────────────────────────────

describe('detectSourceType', () => {
  it('returns InternalPath when fromPath is set', () => {
    const r: LocalRedirect = { kind: 'Permanent', fromPath: '/about' };
    expect(detectSourceType(r)).toBe('InternalPath');
  });

  it('returns ContentId when fromContentId is set (and no fromPath)', () => {
    const r: LocalRedirect = { kind: 'Permanent', fromContentId: 42 };
    expect(detectSourceType(r)).toBe('ContentId');
  });

  it('returns ContentSlug when fromLanguage+fromSlug are set', () => {
    const r: LocalRedirect = { kind: 'Permanent', fromLanguage: 'en', fromSlug: 'my-article' };
    expect(detectSourceType(r)).toBe('ContentSlug');
  });
});

// ── Unit: detectTargetType ────────────────────────────────────────────

describe('detectTargetType', () => {
  it('returns ExternalUrl when toUrl is set', () => {
    const r: LocalRedirect = { kind: 'Permanent', toUrl: 'https://example.com' };
    expect(detectTargetType(r)).toBe('ExternalUrl');
  });

  it('returns InternalPath when toPath is set', () => {
    const r: LocalRedirect = { kind: 'Permanent', toPath: '/new-path' };
    expect(detectTargetType(r)).toBe('InternalPath');
  });

  it('returns ContentId when toContentId is set', () => {
    const r: LocalRedirect = { kind: 'Permanent', toContentId: 10 };
    expect(detectTargetType(r)).toBe('ContentId');
  });

  it('returns ContentSlug otherwise', () => {
    const r: LocalRedirect = { kind: 'Permanent', toLanguage: 'en', toSlug: 'new-article' };
    expect(detectTargetType(r)).toBe('ContentSlug');
  });
});

// ── Unit: toLocalRedirect ─────────────────────────────────────────────

describe('toLocalRedirect', () => {
  it('maps all non-null fields from DTO', () => {
    const dto = makeDto({
      id: 5,
      kind: 'Temporary',
      fromPath: '/old',
      toUrl: 'https://example.com/new',
      updatedAt: '2024-06-01T00:00:00Z',
    });
    const local = toLocalRedirect(dto);
    expect((local as any).id).toBeUndefined();
    expect((local as any).createdAt).toBeUndefined();
    expect((local as any).updatedAt).toBeUndefined();
    expect(local.kind).toBe('Temporary');
    expect(local.fromPath).toBe('/old');
    expect(local.toUrl).toBe('https://example.com/new');
  });

  it('does not include null fields in the output', () => {
    const dto = makeDto({ fromPath: null, toUrl: null, toPath: '/new' });
    const local = toLocalRedirect(dto);
    expect(local.fromPath).toBeUndefined();
    expect(local.toUrl).toBeUndefined();
    expect(local.toPath).toBe('/new');
  });

  it('handles ContentSlug type with language and slug', () => {
    const dto = makeDto({
      sourceType: 'ContentSlug',
      targetType: 'ContentSlug',
      fromPath: null,
      fromLanguage: 'en',
      fromSlug: 'old-article',
      toUrl: null,
      toLanguage: 'en',
      toSlug: 'new-article',
    });
    const local = toLocalRedirect(dto);
    expect(local.fromLanguage).toBe('en');
    expect(local.fromSlug).toBe('old-article');
    expect(local.toLanguage).toBe('en');
    expect(local.toSlug).toBe('new-article');
  });
});

// ── Integration: pullLeadCMSRedirects ─────────────────────────────────

describe('pullLeadCMSRedirects', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'leadcms-redirects-test-'));
    redirectsDir = tmpDir;
    stateDirForTest = tmpDir;
    metadataStore.clear();
    mockAxiosGet.mockReset();
    mockAxiosPost.mockReset();
    mockAxiosPost.mockResolvedValue({ status: 200, data: {} });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('creates redirects.yaml when syncing new items', async () => {
    const dto = makeDto({ id: 1, kind: 'Permanent', fromPath: '/old', toUrl: 'https://example.com' });

    mockAxiosGet
      .mockResolvedValueOnce({
        status: 200,
        data: { items: [dto], deleted: [] },
        headers: { 'x-next-sync-token': 'token-abc' },
      })
      .mockResolvedValueOnce({ status: 204, data: {}, headers: {} });

    const { pullLeadCMSRedirects } = await import('../src/scripts/pull-redirects');
    await pullLeadCMSRedirects();

    const filePath = path.join(tmpDir, 'redirects.yaml');
    const raw = await fs.readFile(filePath, 'utf8');
    const file = yaml.load(raw) as LocalRedirectsFile;
    const items = flattenRedirectsFile(file);

    expect(items).toHaveLength(1);
    expect((items[0] as any).id).toBeUndefined();
    expect(items[0].fromPath).toBe('/old');
    expect(items[0].toUrl).toBe('https://example.com');
  });

  it('persists sync token to .sync-token file', async () => {
    mockAxiosGet
      .mockResolvedValueOnce({
        status: 200,
        data: { items: [makeDto()], deleted: [] },
        headers: { 'x-next-sync-token': 'my-token-xyz' },
      })
      .mockResolvedValueOnce({ status: 204, data: {}, headers: {} });

    const { pullLeadCMSRedirects } = await import('../src/scripts/pull-redirects');
    await pullLeadCMSRedirects();

    const tokenPath = path.join(tmpDir, '.sync-token');
    const token = await fs.readFile(tokenPath, 'utf8');
    expect(token).toBe('my-token-xyz');
  });

  it('merges incoming items with existing YAML', async () => {
    // Pre-populate with an existing redirect (no id in local YAML)
    const existingFile = buildRedirectsFile([
      { kind: 'Permanent', fromPath: '/existing', toPath: '/new-existing' },
    ]);
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, 'redirects.yaml'),
      yaml.dump(existingFile),
      'utf8',
    );

    const incoming = makeDto({ id: 20, kind: 'Temporary', fromPath: '/another', toUrl: 'https://x.com' });
    mockAxiosGet
      .mockResolvedValueOnce({
        status: 200,
        data: { items: [incoming], deleted: [] },
        headers: { 'x-next-sync-token': 'token-2' },
      })
      .mockResolvedValueOnce({ status: 204, data: {}, headers: {} });

    const { pullLeadCMSRedirects } = await import('../src/scripts/pull-redirects');
    await pullLeadCMSRedirects();

    const raw = await fs.readFile(path.join(tmpDir, 'redirects.yaml'), 'utf8');
    const merged = flattenRedirectsFile(yaml.load(raw) as LocalRedirectsFile);

    const paths = merged.map(r => r.fromPath);
    expect(paths).toContain('/existing');
    expect(paths).toContain('/another');
  });

  it('removes deleted redirect IDs from local YAML', async () => {
    // Local YAML has no ids — surrogate keys are path:/a and path:/c
    const existingFile = buildRedirectsFile([
      { kind: 'Permanent', fromPath: '/a', toPath: '/b' },
      { kind: 'Permanent', fromPath: '/c', toPath: '/d' },
    ]);
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'redirects.yaml'), yaml.dump(existingFile), 'utf8');
    // Pre-populate id-map via in-memory metadata store
    metadataStore.set(tmpDir, { content: {}, redirects: { 'path:/a': 1, 'path:/c': 2 } });

    mockAxiosGet
      .mockResolvedValueOnce({
        status: 200,
        data: { items: [], deleted: [1] },
        headers: { 'x-next-sync-token': 'token-del' },
      })
      .mockResolvedValueOnce({ status: 204, data: {}, headers: {} });

    const { pullLeadCMSRedirects } = await import('../src/scripts/pull-redirects');
    await pullLeadCMSRedirects();

    const raw = await fs.readFile(path.join(tmpDir, 'redirects.yaml'), 'utf8');
    const items = flattenRedirectsFile(yaml.load(raw) as LocalRedirectsFile);

    expect(items).toHaveLength(1);
    expect(items[0].fromPath).toBe('/c');
  });

  it('sorts redirects by surrogate key in the output file', async () => {
    const dtos = [
      makeDto({ id: 30, fromPath: '/z', toPath: '/a' }),
      makeDto({ id: 5, fromPath: '/a', toPath: '/b' }),
      makeDto({ id: 15, fromPath: '/m', toPath: '/n' }),
    ];

    mockAxiosGet
      .mockResolvedValueOnce({
        status: 200,
        data: { items: dtos, deleted: [] },
        headers: { 'x-next-sync-token': 'token-sort' },
      })
      .mockResolvedValueOnce({ status: 204, data: {}, headers: {} });

    const { pullLeadCMSRedirects } = await import('../src/scripts/pull-redirects');
    await pullLeadCMSRedirects();

    const raw = await fs.readFile(path.join(tmpDir, 'redirects.yaml'), 'utf8');
    const items = flattenRedirectsFile(yaml.load(raw) as LocalRedirectsFile);
    // Surrogate keys: path:/z, path:/a, path:/m → sorted: path:/a, path:/m, path:/z
    const paths = items.map(r => r.fromPath);
    expect(paths).toEqual(['/a', '/m', '/z']);
  });

  it('does not write file if no changes (204 immediately)', async () => {
    // Pre-populate
    const existingFile = buildRedirectsFile([{ kind: 'Permanent', fromPath: '/a', toPath: '/b' }]);
    await fs.mkdir(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, 'redirects.yaml');
    await fs.writeFile(filePath, yaml.dump(existingFile), 'utf8');
    const statBefore = await fs.stat(filePath);

    mockAxiosGet.mockResolvedValueOnce({ status: 204, data: {}, headers: {} });

    const { pullLeadCMSRedirects } = await import('../src/scripts/pull-redirects');
    await pullLeadCMSRedirects();

    const statAfter = await fs.stat(filePath);
    // mtime should be the same if file wasn't rewritten
    expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
  });

  it('triggers discover before sync (POST before GET)', async () => {
    mockAxiosGet.mockResolvedValueOnce({ status: 204, data: {}, headers: {} });

    const { pullLeadCMSRedirects } = await import('../src/scripts/pull-redirects');
    await pullLeadCMSRedirects();

    expect(mockAxiosPost).toHaveBeenCalledWith(
      expect.stringContaining('/api/redirects/discover'),
      null,
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-api-key' }) }),
    );
    expect(mockAxiosGet).toHaveBeenCalledWith(
      expect.stringContaining('/api/redirects/sync'),
      expect.any(Object),
    );
  });

  it('continues even if discover fails (best-effort)', async () => {
    mockAxiosPost.mockRejectedValueOnce(new Error('network error'));
    mockAxiosGet.mockResolvedValueOnce({ status: 204, data: {}, headers: {} });

    const { pullLeadCMSRedirects } = await import('../src/scripts/pull-redirects');
    await expect(pullLeadCMSRedirects()).resolves.not.toThrow();
  });

  it('passes syncToken from file to the sync request', async () => {
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(path.join(tmpDir, '.sync-token'), 'previous-token', 'utf8');

    mockAxiosGet.mockResolvedValueOnce({ status: 204, data: {}, headers: {} });

    const { pullLeadCMSRedirects } = await import('../src/scripts/pull-redirects');
    await pullLeadCMSRedirects();

    const callUrl: string = mockAxiosGet.mock.calls[0][0];
    expect(callUrl).toContain('syncToken=previous-token');
  });

  it('paginates through multiple sync pages', async () => {
    const dto1 = makeDto({ id: 1, fromPath: '/a', toPath: '/b' });
    const dto2 = makeDto({ id: 2, fromPath: '/c', toPath: '/d' });

    mockAxiosGet
      .mockResolvedValueOnce({
        status: 200,
        data: { items: [dto1], deleted: [] },
        headers: { 'x-next-sync-token': 'page-2' },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: { items: [dto2], deleted: [] },
        headers: { 'x-next-sync-token': 'page-3' },
      })
      .mockResolvedValueOnce({ status: 204, data: {}, headers: {} });

    const { pullLeadCMSRedirects } = await import('../src/scripts/pull-redirects');
    await pullLeadCMSRedirects();

    const raw = await fs.readFile(path.join(tmpDir, 'redirects.yaml'), 'utf8');
    const items = flattenRedirectsFile(yaml.load(raw) as LocalRedirectsFile);
    expect(items).toHaveLength(2);
  });
});
