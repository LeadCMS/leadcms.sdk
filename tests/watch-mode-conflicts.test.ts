/**
 * Tests for watch mode (SSE watcher) conflict prevention.
 *
 * These tests verify that:
 * 1. fetchLeadCMSContent({ forceOverwrite: true }) always overwrites local
 *    files with remote content, skipping three-way merge entirely.
 * 2. Without forceOverwrite, the merge path is exercised when local files
 *    differ from base (normal pull behavior).
 * 3. The race condition scenario (concurrent syncs seeing stale base) does
 *    not produce conflict markers when forceOverwrite is enabled.
 *
 * The root cause of watch-mode conflicts:
 *   - SSE events fire concurrently, triggering overlapping fetchLeadCMSContent calls
 *   - Both reads share the same sync token (neither has updated it yet)
 *   - First fetch overwrites local V1 → V2
 *   - Second fetch sees local=V2, base=V1, remote=V2 → enters merge path
 *   - Small differences (timestamp precision, etc.) can produce real conflicts
 */

import fsPromises from 'fs/promises';
import path from 'path';
import os from 'os';
import { jest } from '@jest/globals';
import { listContentFiles, createSyncTestHarness } from './test-helpers';

// ── Temp directories for isolation ─────────────────────────────────────
const tmpRoot = path.join(os.tmpdir(), 'leadcms-watch-mode-conflicts');
const contentDir = path.join(tmpRoot, 'content');
const mediaDir = path.join(tmpRoot, 'media');

const harness = createSyncTestHarness({ contentDir, mediaDir });

jest.mock('../src/lib/config.js', () => ({
  getConfig: jest.fn(() => harness.config),
}));
jest.mock('axios', () => harness.axiosMock);

import { fetchLeadCMSContent } from '../src/scripts/fetch-leadcms-content';
import { pullAll } from '../src/scripts/pull-all';
import { pullContent } from '../src/scripts/pull-content';

// ── Shared setup / teardown ────────────────────────────────────────────
beforeEach(() => harness.setup());
afterEach(() => harness.cleanup());

// ════════════════════════════════════════════════════════════════════════
//  forceOverwrite: true skips merge and always overwrites
// ════════════════════════════════════════════════════════════════════════

describe('Watch mode: forceOverwrite prevents merge conflicts', () => {
  const v1 = {
    id: 100,
    slug: 'watch-test',
    type: 'article',
    language: 'en',
    title: 'Original Title',
    description: 'Original description',
    body: '# Original Body',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const v2 = {
    id: 100,
    slug: 'watch-test',
    type: 'article',
    language: 'en',
    title: 'Updated Title',
    description: 'Updated description',
    body: '# Updated Body',
    updatedAt: '2026-02-01T00:00:00Z',
  };

  it('should overwrite local files when forceOverwrite is true, even with locally modified content', async () => {
    // Pull 1: initial content (V1) — establishes the local file
    harness.addContentSync([v1], [], 'token-1');
    await fetchLeadCMSContent();

    const files = await listContentFiles(contentDir);
    expect(files).toHaveLength(1);

    // Read original file and verify it was written
    const originalContent = await fsPromises.readFile(
      path.join(contentDir, 'watch-test.mdx'), 'utf8'
    );
    expect(originalContent).toContain('Original Title');

    // Simulate local modification (user edited the file)
    const modifiedContent = originalContent.replace('Original Title', 'Locally Modified Title');
    await fsPromises.writeFile(path.join(contentDir, 'watch-test.mdx'), modifiedContent, 'utf8');

    // Pull 2: V2 arrives with base=V1 and forceOverwrite=true
    // Even though local file was modified, forceOverwrite should skip merge
    harness.addContentSync([v2], [], 'token-2', { '100': v1 });
    await fetchLeadCMSContent({ forceOverwrite: true });

    const updatedContent = await fsPromises.readFile(
      path.join(contentDir, 'watch-test.mdx'), 'utf8'
    );

    // Should have remote content, not local modifications
    expect(updatedContent).toContain('Updated Title');
    expect(updatedContent).not.toContain('Locally Modified Title');
    // Must NOT contain conflict markers
    expect(updatedContent).not.toContain('<<<<<<< local');
    expect(updatedContent).not.toContain('=======');
    expect(updatedContent).not.toContain('>>>>>>> remote');
  });

  it('should NOT merge even when local differs from base (forceOverwrite=true)', async () => {
    // Pull 1: initial content (V1)
    harness.addContentSync([v1], [], 'token-1');
    await fetchLeadCMSContent();

    // Modify local file significantly
    const localFile = path.join(contentDir, 'watch-test.mdx');
    const original = await fsPromises.readFile(localFile, 'utf8');
    const heavilyModified = original
      .replace('Original Title', 'User Custom Title')
      .replace('Original description', 'User Custom Description')
      .replace('# Original Body', '# User Custom Body\n\nExtra paragraph added locally.');
    await fsPromises.writeFile(localFile, heavilyModified, 'utf8');

    // Pull 2: V2 arrives with base=V1 — in normal mode this would merge/conflict
    // With forceOverwrite, it should simply overwrite
    harness.addContentSync([v2], [], 'token-2', { '100': v1 });
    await fetchLeadCMSContent({ forceOverwrite: true });

    const result = await fsPromises.readFile(localFile, 'utf8');
    expect(result).toContain('Updated Title');
    expect(result).toContain('Updated description');
    expect(result).toContain('# Updated Body');
    expect(result).not.toContain('User Custom');
    expect(result).not.toContain('Extra paragraph');
    expect(result).not.toContain('<<<<<<< local');
  });

  it('without forceOverwrite, locally modified content enters merge path', async () => {
    // Pull 1: initial content (V1)
    harness.addContentSync([v1], [], 'token-1');
    await fetchLeadCMSContent();

    // Modify local file — change only the body (non-overlapping with V2 title change)
    const localFile = path.join(contentDir, 'watch-test.mdx');
    const original = await fsPromises.readFile(localFile, 'utf8');
    const locallyModified = original.replace('# Original Body', '# Locally Edited Body');
    await fsPromises.writeFile(localFile, locallyModified, 'utf8');

    // Pull 2: V2 arrives with base=V1 — should trigger three-way merge
    // V2 changes title+description+body, local only changed body → conflict on body
    harness.addContentSync([v2], [], 'token-2', { '100': v1 });
    await fetchLeadCMSContent(); // no forceOverwrite

    const result = await fsPromises.readFile(localFile, 'utf8');
    // The merge should have run — result should contain the updated title from remote
    // Body line was changed by both sides differently → conflict markers expected
    expect(result).toContain('Updated Title');
    expect(result).toContain('<<<<<<< local');
    expect(result).toContain('Locally Edited Body');
    expect(result).toContain('>>>>>>> remote');
  });
});

// ════════════════════════════════════════════════════════════════════════
//  Simulated race condition: two pulls see same base, forceOverwrite saves
// ════════════════════════════════════════════════════════════════════════

describe('Watch mode: race condition scenario', () => {
  const v1 = {
    id: 200,
    slug: 'race-test',
    type: 'article',
    language: 'en',
    title: 'Version One',
    description: 'V1 description',
    body: '# Content V1',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const v2 = {
    id: 200,
    slug: 'race-test',
    type: 'article',
    language: 'en',
    title: 'Version Two',
    description: 'V2 description',
    body: '# Content V2',
    updatedAt: '2026-02-01T00:00:00Z',
  };

  // Simulate V2 with slightly different timestamp precision (server-side variation)
  const v2Alt = {
    ...v2,
    updatedAt: '2026-02-01T00:00:00.0000001Z',
  };

  it('race condition: second fetch with stale base yields clean result with forceOverwrite', async () => {
    // Step 1: initial sync — creates local file with V1
    harness.addContentSync([v1], [], 'token-1');
    await fetchLeadCMSContent();

    // Step 2: first "SSE-triggered" fetch — overwrites V1 → V2
    harness.addContentSync([v2], [], 'token-2', { '200': v1 });
    await fetchLeadCMSContent({ forceOverwrite: true });

    const afterFirst = await fsPromises.readFile(
      path.join(contentDir, 'race-test.mdx'), 'utf8'
    );
    expect(afterFirst).toContain('Version Two');

    // Step 3: second "SSE-triggered" fetch (stale token → same base=V1, same remote=V2)
    // But the API might return slightly different timestamp precision
    harness.addContentSync([v2Alt], [], 'token-2', { '200': v1 });
    await fetchLeadCMSContent({ forceOverwrite: true });

    const afterSecond = await fsPromises.readFile(
      path.join(contentDir, 'race-test.mdx'), 'utf8'
    );
    expect(afterSecond).toContain('Version Two');
    expect(afterSecond).not.toContain('<<<<<<< local');
    expect(afterSecond).not.toContain('=======');
    expect(afterSecond).not.toContain('>>>>>>> remote');
  });

  it('race condition WITHOUT forceOverwrite can produce conflicts from timestamp differences', async () => {
    // Step 1: initial sync
    harness.addContentSync([v1], [], 'token-1');
    await fetchLeadCMSContent();

    // Step 2: first normal fetch (simulating first SSE event)
    harness.addContentSync([v2], [], 'token-2', { '200': v1 });
    await fetchLeadCMSContent();

    // Step 3: second normal fetch with same base but different timestamp precision
    // Local file was already overwritten to V2 by step 2 → isLocallyModified detects difference
    harness.addContentSync([v2Alt], [], 'token-2', { '200': v1 });
    await fetchLeadCMSContent();

    const result = await fsPromises.readFile(
      path.join(contentDir, 'race-test.mdx'), 'utf8'
    );
    // The content should still be V2 (either merged or overwritten)
    expect(result).toContain('Version Two');
    // The file should not be broken — at minimum V2 content should be present
  });
});

// ════════════════════════════════════════════════════════════════════════
//  forceOverwrite works for JSON content too
// ════════════════════════════════════════════════════════════════════════

describe('Watch mode: forceOverwrite with JSON content', () => {
  const jsonV1 = {
    id: 300,
    slug: 'component-test',
    type: 'component',
    language: 'en',
    title: 'Component V1',
    description: 'Component description',
    body: JSON.stringify({ heading: 'Hello', subtitle: 'World' }),
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const jsonV2 = {
    id: 300,
    slug: 'component-test',
    type: 'component',
    language: 'en',
    title: 'Component V2',
    description: 'Updated component',
    body: JSON.stringify({ heading: 'Updated', subtitle: 'Now', extra: true }),
    updatedAt: '2026-02-01T00:00:00Z',
  };

  it('should overwrite JSON content with forceOverwrite, skipping structural merge', async () => {
    // Pull 1: establish V1
    harness.addContentSync([jsonV1], [], 'token-1');
    await fetchLeadCMSContent();

    const files = await listContentFiles(contentDir);
    expect(files.some(f => f.endsWith('.json'))).toBe(true);

    // Locally modify the JSON file
    const jsonFile = path.join(contentDir, 'component-test.json');
    const original = await fsPromises.readFile(jsonFile, 'utf8');
    const parsed = JSON.parse(original);
    parsed.title = 'Locally Modified Component';
    await fsPromises.writeFile(jsonFile, JSON.stringify(parsed, null, 2), 'utf8');

    // Pull 2: V2 arrives with base=V1 and forceOverwrite
    harness.addContentSync([jsonV2], [], 'token-2', { '300': jsonV1 });
    await fetchLeadCMSContent({ forceOverwrite: true });

    const result = await fsPromises.readFile(jsonFile, 'utf8');
    const resultParsed = JSON.parse(result);
    expect(resultParsed.title).toBe('Component V2');
    expect(resultParsed.description).toBe('Updated component');
    // No conflict markers in JSON
    expect(result).not.toContain('<<<<<<< local');
  });
});

// ════════════════════════════════════════════════════════════════════════
//  Default behavior (forceOverwrite=false) is unchanged
// ════════════════════════════════════════════════════════════════════════

describe('Watch mode: default (no forceOverwrite) preserves merge behavior', () => {
  const v1 = {
    id: 400,
    slug: 'merge-preserved',
    type: 'article',
    language: 'en',
    title: 'Title V1',
    description: 'Desc V1',
    body: '# Body V1',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const v2 = {
    id: 400,
    slug: 'merge-preserved',
    type: 'article',
    language: 'en',
    title: 'Title V2',
    description: 'Desc V2',
    body: '# Body V1',
    updatedAt: '2026-02-01T00:00:00Z',
  };

  it('should auto-merge cleanly when local and remote change different parts', async () => {
    // Pull 1: initial V1
    harness.addContentSync([v1], [], 'token-1');
    await fetchLeadCMSContent();

    // Local modification: only change the body (V2 changes title+description, not body)
    const localFile = path.join(contentDir, 'merge-preserved.mdx');
    const original = await fsPromises.readFile(localFile, 'utf8');
    const locallyModified = original.replace('# Body V1', '# Body Locally Edited');
    await fsPromises.writeFile(localFile, locallyModified, 'utf8');

    // Pull 2: V2 changes title + description but keeps the same body
    harness.addContentSync([v2], [], 'token-2', { '400': v1 });
    await fetchLeadCMSContent(); // no forceOverwrite — should merge

    const result = await fsPromises.readFile(localFile, 'utf8');
    // Should have remote title and local body (auto-merged)
    expect(result).toContain('Title V2');
    expect(result).toContain('Body Locally Edited');
    expect(result).not.toContain('<<<<<<< local');
  });
});

// ════════════════════════════════════════════════════════════════════════
//  pullAll({ force: true }) and pullContent({ force: true }) pass through
// ════════════════════════════════════════════════════════════════════════

describe('CLI --force flag: pullAll and pullContent pass forceOverwrite', () => {
  const v1 = {
    id: 500,
    slug: 'cli-force-test',
    type: 'article',
    language: 'en',
    title: 'CLI V1',
    description: 'CLI V1 desc',
    body: '# CLI Body V1',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const v2 = {
    id: 500,
    slug: 'cli-force-test',
    type: 'article',
    language: 'en',
    title: 'CLI V2',
    description: 'CLI V2 desc',
    body: '# CLI Body V2',
    updatedAt: '2026-02-01T00:00:00Z',
  };

  it('pullAll({ force: true }) overwrites locally modified content', async () => {
    harness.addContentSync([v1], [], 'token-1');
    await pullAll();

    // Modify local file
    const localFile = path.join(contentDir, 'cli-force-test.mdx');
    const original = await fsPromises.readFile(localFile, 'utf8');
    await fsPromises.writeFile(localFile, original.replace('CLI V1', 'Locally Changed'), 'utf8');

    // Pull with force and base items
    harness.addContentSync([v2], [], 'token-2', { '500': v1 });
    await pullAll({ force: true });

    const result = await fsPromises.readFile(localFile, 'utf8');
    expect(result).toContain('CLI V2');
    expect(result).not.toContain('Locally Changed');
    expect(result).not.toContain('<<<<<<< local');
  });

  it('pullContent({ force: true }) overwrites locally modified content', async () => {
    harness.addContentSync([v1], [], 'token-1');
    await pullContent();

    // Modify local file
    const localFile = path.join(contentDir, 'cli-force-test.mdx');
    const original = await fsPromises.readFile(localFile, 'utf8');
    await fsPromises.writeFile(localFile, original.replace('CLI V1', 'Locally Changed'), 'utf8');

    // Pull content with force
    harness.addContentSync([v2], [], 'token-2', { '500': v1 });
    await pullContent({ force: true });

    const result = await fsPromises.readFile(localFile, 'utf8');
    expect(result).toContain('CLI V2');
    expect(result).not.toContain('Locally Changed');
    expect(result).not.toContain('<<<<<<< local');
  });
});
