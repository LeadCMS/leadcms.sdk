/**
 * Tests for pull-media --reset sync token cleanup.
 *
 * Bug: pull-media --reset removes media files but does NOT pass remoteContext
 * to resetMediaState(), so the per-remote sync token survives. Subsequent
 * sync calls send the stale token and the API returns 204 (no changes).
 *
 * TDD: Test written first to reproduce the bug.
 */

import fsPromises from 'fs/promises';
import path from 'path';
import os from 'os';
import { jest } from '@jest/globals';
import { createTestConfig, createDataServiceMock } from './test-helpers';

// ── Temp directories ───────────────────────────────────────────────────
const tmpRoot = path.join(os.tmpdir(), 'leadcms-pull-media-reset');
const mediaDir = path.join(tmpRoot, 'media');
const contentDir = path.join(tmpRoot, 'content');
const remotesDir = path.join(tmpRoot, 'remotes');

// ── Mocks ──────────────────────────────────────────────────────────────
jest.mock('../src/lib/config.js', () => ({
  getConfig: jest.fn(() =>
    createTestConfig({ mediaDir, contentDir }),
  ),
}));

jest.mock('../src/lib/data-service.js', () => ({
  leadCMSDataService: createDataServiceMock(),
}));

jest.mock('../src/lib/cms-config-types.js', () => ({
  setCMSConfig: jest.fn(),
  isMediaSupported: jest.fn(() => true),
}));

// Mock axios to intercept both config and sync calls
let mediaSyncCalls: string[] = [];

jest.mock('axios', () => {
  const mockGet = jest.fn((url: string, _opts?: any) => {
    if (url.includes('/api/config')) {
      return Promise.resolve({
        status: 200,
        data: { features: ['media'] },
        headers: {},
      });
    }

    if (url.includes('/api/media/sync')) {
      mediaSyncCalls.push(url);
      // Always return 204 (no changes)
      return Promise.resolve({
        status: 204,
        data: null,
        headers: {},
      });
    }

    return Promise.resolve({ status: 200, data: {}, headers: {} });
  });

  const mockInstance: any = jest.fn(mockGet);
  mockInstance.get = mockGet;
  mockInstance.interceptors = {
    request: { use: jest.fn() },
    response: { use: jest.fn() },
  };
  mockInstance.default = mockInstance;
  return { __esModule: true, default: mockInstance };
});

// ── Setup / Teardown ───────────────────────────────────────────────────
beforeEach(async () => {
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
  await fsPromises.mkdir(mediaDir, { recursive: true });
  await fsPromises.mkdir(remotesDir, { recursive: true });
  mediaSyncCalls = [];
});

afterEach(async () => {
  await fsPromises.rm(tmpRoot, { recursive: true, force: true });
});

// ════════════════════════════════════════════════════════════════════════
//  pull-media --reset should clear per-remote sync token
// ════════════════════════════════════════════════════════════════════════

describe('pullMedia with reset clears per-remote sync token', () => {
  it('should delete the per-remote sync token when reset is true', async () => {
    const remoteStateDir = path.join(remotesDir, 'prod');
    await fsPromises.mkdir(remoteStateDir, { recursive: true });

    const remoteCtx = {
      name: 'prod',
      url: 'https://cms.example.com',
      isDefault: true,
      stateDir: remoteStateDir,
    };

    // Simulate an existing per-remote sync token
    const tokenPath = path.join(remoteStateDir, 'media-sync-token');
    await fsPromises.writeFile(tokenPath, 'stale-sync-token', 'utf8');

    // Also write some media files
    await fsPromises.writeFile(path.join(mediaDir, 'image.png'), 'fake-image');

    const { pullMedia } = await import('../src/scripts/pull-media');
    await pullMedia({ reset: true, remoteContext: remoteCtx });

    // Per-remote sync token should be deleted
    await expect(fsPromises.access(tokenPath)).rejects.toThrow();

    // Media directory files should also be cleaned
    let mediaFiles: string[] = [];
    try {
      mediaFiles = await fsPromises.readdir(mediaDir);
    } catch { /* directory deleted entirely — that's fine */ }
    // .sync-token and actual files should be gone
    expect(mediaFiles.filter(f => f !== '.sync-token')).toHaveLength(0);
  });

  it('should NOT leave stale token that causes 204 on next sync', async () => {
    const remoteStateDir = path.join(remotesDir, 'prod');
    await fsPromises.mkdir(remoteStateDir, { recursive: true });

    const remoteCtx = {
      name: 'prod',
      url: 'https://cms.example.com',
      isDefault: true,
      stateDir: remoteStateDir,
    };

    // Simulate an existing per-remote sync token
    const tokenPath = path.join(remoteStateDir, 'media-sync-token');
    await fsPromises.writeFile(tokenPath, 'stale-sync-token', 'utf8');

    const { pullMedia } = await import('../src/scripts/pull-media');
    await pullMedia({ reset: true, remoteContext: remoteCtx });

    // After reset, the token file should be gone
    let tokenExists = true;
    try {
      await fsPromises.access(tokenPath);
    } catch {
      tokenExists = false;
    }
    expect(tokenExists).toBe(false);
  });
});
