/**
 * Integration test: pull with remote slug rename
 *
 * Scenario:
 *   1. Remote content (id=1, slug="old-slug") is pulled → creates old-slug.mdx
 *   2. The slug is changed remotely to "new-slug"
 *   3. Pull again (the sync API returns the updated content with slug="new-slug")
 *   4. After the second pull, only ONE file should exist locally (new-slug.mdx)
 *
 * This test calls the real fetchLeadCMSContent function and only mocks the
 * HTTP layer (axios) so the test stays in sync with the actual implementation.
 */

import fsPromises from 'fs/promises';
import path from 'path';
import os from 'os';
import { jest } from '@jest/globals';
import { listContentFiles, createSyncTestHarness } from './test-helpers';

// ── Temp directories for isolation ─────────────────────────────────────
const tmpRoot = path.join(os.tmpdir(), 'leadcms-slug-rename-test');
const contentDir = path.join(tmpRoot, 'content');
const mediaDir = path.join(tmpRoot, 'media');

const harness = createSyncTestHarness({
  contentDir,
  mediaDir,
  contentTypes: [{ uid: 'article', format: 'MDX' }],
});

jest.mock('../src/lib/config.js', () => ({
  getConfig: jest.fn(() => harness.config),
}));
jest.mock('axios', () => harness.axiosMock);

// Import the real pull function — all internal logic (saveContentFile,
// findAndDeleteContentFile, sync token handling, etc.) runs for real.
import { fetchLeadCMSContent } from '../src/scripts/fetch-leadcms-content';

describe('Pull: remote slug rename scenario', () => {
  beforeEach(() => harness.setup());
  afterEach(() => harness.cleanup());

  it('should have only one file after pulling content whose slug was renamed', async () => {
    const remoteContentV1 = {
      id: 1,
      slug: 'old-slug',
      type: 'article',
      language: 'en',
      title: 'My Article',
      description: 'A test article',
      body: '# Hello World',
      publishedAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    };

    const remoteContentV2 = {
      ...remoteContentV1,
      slug: 'new-slug',
      updatedAt: '2025-02-01T00:00:00Z',
    };

    // Set up the sync responses: first pull returns V1, second pull returns V2
    harness.addContentSync([remoteContentV1], [], 'token-1');
    harness.addContentSync([remoteContentV2], [], 'token-2');

    // ── First pull ─────────────────────────────────────────────────────
    await fetchLeadCMSContent();

    const filesAfterFirstPull = await listContentFiles(contentDir);
    expect(filesAfterFirstPull).toHaveLength(1);
    expect(filesAfterFirstPull[0]).toContain('old-slug.mdx');

    // ── Second pull (slug was renamed remotely) ────────────────────────
    await fetchLeadCMSContent();

    // ── Verify: only ONE file should remain (new-slug.mdx) ────────────
    const filesAfterSecondPull = await listContentFiles(contentDir);
    expect(filesAfterSecondPull).toHaveLength(1);
    expect(filesAfterSecondPull[0]).toContain('new-slug.mdx');
  });
});
