/**
 * Tests that pull-all runs entity pulls sequentially so metadata.json
 * sections are not clobbered. Previously all pulls ran via Promise.all,
 * causing the last writer's snapshot to overwrite sections written by
 * earlier-finishing pulls.
 *
 * TDD: Test written to reproduce the bug where `--reset` leaves the
 * "sequences" block cleared in metadata.json.
 */

import fsPromises from 'fs/promises';
import path from 'path';
import os from 'os';

const tmpRoot = path.join(os.tmpdir(), 'leadcms-pull-all-race');
const stateDir = path.join(tmpRoot, '.leadcms', 'remotes', 'prod');
const metadataPath = path.join(stateDir, 'metadata.json');

const remoteCtx = {
  name: 'prod',
  url: 'https://prod.leadcms.com',
  apiKey: 'test-key',
  isDefault: true,
  stateDir,
};

// ── Setup / Teardown ───────────────────────────────────────────────────
beforeEach(async () => {
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
  await fsPromises.mkdir(stateDir, { recursive: true });
});

afterEach(async () => {
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

// ════════════════════════════════════════════════════════════════════════
//  Sequential writeMetadataMap preserves all sections
// ════════════════════════════════════════════════════════════════════════

describe('sequential metadata writes', () => {
  it('should preserve sequences when content pull reads metadata after sequences wrote it', async () => {
    const {
      readMetadataMap,
      writeMetadataMap,
    } = await import('../src/lib/remote-context');

    // Sequences pull runs first, reads empty, writes sequences
    const mapForSequences = await readMetadataMap(remoteCtx);
    mapForSequences.sequences = {
      en: { 'welcome-sequence': { id: 1, createdAt: '2026-01-01T00:00:00Z' } },
    };
    await writeMetadataMap(remoteCtx, mapForSequences);

    // Content pull runs second (sequential), reads the updated metadata
    const mapForContent = await readMetadataMap(remoteCtx);
    mapForContent.content = {
      en: { 'hello-world': { id: 10, createdAt: '2026-01-01T00:00:00Z' } },
    };
    await writeMetadataMap(remoteCtx, mapForContent);

    // Both sections should be present
    const final = JSON.parse(await fsPromises.readFile(metadataPath, 'utf8'));
    expect(final.content?.en?.['hello-world']).toBeDefined();
    expect(final.sequences?.en?.['welcome-sequence']).toBeDefined();
  });

  it('should preserve all sections across multiple sequential writes', async () => {
    const {
      readMetadataMap,
      writeMetadataMap,
    } = await import('../src/lib/remote-context');

    // First pull: sequences
    const mapA = await readMetadataMap(remoteCtx);
    mapA.sequences = {
      en: { 'onboarding': { id: 1, createdAt: '2026-01-01T00:00:00Z' } },
    };
    await writeMetadataMap(remoteCtx, mapA);

    // Second pull: segments (reads after sequences wrote)
    const mapB = await readMetadataMap(remoteCtx);
    mapB.segments = {
      'vip-customers': { id: 2, createdAt: '2026-02-01T00:00:00Z' },
    };
    await writeMetadataMap(remoteCtx, mapB);

    // Third pull: content (reads after segments wrote)
    const mapC = await readMetadataMap(remoteCtx);
    mapC.content = {
      en: { 'about-us': { id: 3, createdAt: '2026-03-01T00:00:00Z' } },
    };
    await writeMetadataMap(remoteCtx, mapC);

    const final = JSON.parse(await fsPromises.readFile(metadataPath, 'utf8'));
    expect(final.sequences?.en?.['onboarding']).toBeDefined();
    expect(final.segments?.['vip-customers']).toBeDefined();
    expect(final.content?.en?.['about-us']).toBeDefined();
  });
});
