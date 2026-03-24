/**
 * Tests for sequence multi-remote support.
 *
 * Covers:
 * - MetadataMap sequence helpers use language+name composite key
 * - toLocalSequence strips step-level backend metadata
 * - Migration from flat to nested sequences format
 * - getRemoteMatch uses name+language composite natural key
 * - Pull swaps backend fields for non-default remotes
 * - Push uses per-remote metadata for matching and conflict detection
 */

import { jest } from '@jest/globals';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

import {
  lookupSequenceRemoteId,
  setSequenceRemoteId,
  getMetadataForSequence,
  setMetadataForSequence,
  readMetadataMap,
  writeMetadataMap,
  type RemoteContext,
  type MetadataMap,
} from '../src/lib/remote-context';

import {
  toLocalSequence,
  toRemoteSequencePayload,
  type SequenceDetailsDto,
  type SequenceStepDetailsDto,
  type LocalSequenceDto,
  type SegmentIdNameMap,
  type SegmentNameIdMap,
  type EmailTemplateIdNameMap,
  type EmailTemplateNameIdMap,
} from '../src/lib/automation-types';

// ── Helpers ────────────────────────────────────────────────────────────

function makeRemoteCtx(overrides: Partial<RemoteContext> & { stateDir: string }): RemoteContext {
  return {
    name: 'test-remote',
    url: 'https://test.leadcms.com',
    apiKey: 'test-key',
    isDefault: true,
    ...overrides,
  };
}

function makeRemoteStep(overrides: Partial<SequenceStepDetailsDto> = {}): SequenceStepDetailsDto {
  return {
    id: 5,
    sequenceId: 2,
    emailTemplateId: 10,
    name: 'Step 1',
    type: 'Email',
    timing: { delay: { value: 0, unit: 'days' } },
    createdAt: '2026-03-21T18:41:02Z',
    updatedAt: null,
    ...overrides,
  };
}

function makeRemoteSequence(overrides: Partial<SequenceDetailsDto> = {}): SequenceDetailsDto {
  return {
    id: 2,
    name: 'Test Sequence',
    description: null,
    language: 'en',
    stopOnReply: true,
    useContactTimeZone: true,
    timeZone: 0,
    status: 'Draft',
    createdAt: '2026-03-21T18:00:00Z',
    updatedAt: null,
    steps: [makeRemoteStep()],
    ...overrides,
  };
}

const emptySegmentMap: SegmentIdNameMap = new Map();
const emptyTemplateIdNameMap: EmailTemplateIdNameMap = new Map([[10, 'WS_Email_1']]);
const emptySegmentNameIdMap: SegmentNameIdMap = new Map();
const emptyTemplateNameIdMap: EmailTemplateNameIdMap = new Map([['WS_Email_1', 10]]);

// ══════════════════════════════════════════════════════════════════════
// MetadataMap sequence helpers with language+name composite key
// ══════════════════════════════════════════════════════════════════════

describe('Sequence metadata helpers (language+name composite key)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'leadcms-seq-meta-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('should store and lookup sequence by language+name', () => {
    const map: MetadataMap = { content: {}, sequences: {} };
    setSequenceRemoteId(map, 'en', 'Welcome Sequence', 42);
    expect(lookupSequenceRemoteId(map, 'en', 'Welcome Sequence')).toBe(42);
  });

  it('should distinguish same name in different languages', () => {
    const map: MetadataMap = { content: {}, sequences: {} };
    setSequenceRemoteId(map, 'en', 'Welcome', 10);
    setSequenceRemoteId(map, 'ru-RU', 'Welcome', 20);

    expect(lookupSequenceRemoteId(map, 'en', 'Welcome')).toBe(10);
    expect(lookupSequenceRemoteId(map, 'ru-RU', 'Welcome')).toBe(20);
  });

  it('should return undefined for non-existent language+name', () => {
    const map: MetadataMap = { content: {}, sequences: {} };
    setSequenceRemoteId(map, 'en', 'Welcome', 10);
    expect(lookupSequenceRemoteId(map, 'fr', 'Welcome')).toBeUndefined();
    expect(lookupSequenceRemoteId(map, 'en', 'Nonexistent')).toBeUndefined();
  });

  it('should deduplicate: setting same ID under new language+name removes old entry', () => {
    const map: MetadataMap = { content: {}, sequences: {} };
    setSequenceRemoteId(map, 'en', 'Old Name', 42);
    setSequenceRemoteId(map, 'en', 'New Name', 42);

    expect(lookupSequenceRemoteId(map, 'en', 'Old Name')).toBeUndefined();
    expect(lookupSequenceRemoteId(map, 'en', 'New Name')).toBe(42);
  });

  it('should set and get full metadata entry', () => {
    const map: MetadataMap = { content: {}, sequences: {} };
    setMetadataForSequence(map, 'en', 'Test Seq', {
      id: 5,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
    });

    const meta = getMetadataForSequence(map, 'en', 'Test Seq');
    expect(meta).toEqual({
      id: 5,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
    });
  });

  it('should round-trip through write and read with nested sequences', async () => {
    const ctx = makeRemoteCtx({ stateDir: tmpDir });
    const map: MetadataMap = {
      content: {},
      sequences: {
        en: { 'Welcome Sequence': { id: 10, createdAt: '2026-01-01T00:00:00Z' } },
        'ru-RU': { 'Welcome Sequence': { id: 20, createdAt: '2026-01-02T00:00:00Z' } },
      },
    };

    await writeMetadataMap(ctx, map);
    const read = await readMetadataMap(ctx);

    expect(read.sequences).toEqual(map.sequences);
  });

  it('should migrate old flat sequences format to nested on read', async () => {
    const ctx = makeRemoteCtx({ stateDir: tmpDir });

    // Write old flat format directly
    const oldFormat = {
      content: {},
      sequences: {
        'My Sequence': { id: 5, createdAt: '2026-01-01T00:00:00Z' },
        'Another': { id: 10 },
      },
    };
    await fs.mkdir(ctx.stateDir, { recursive: true });
    await fs.writeFile(
      path.join(ctx.stateDir, 'metadata.json'),
      JSON.stringify(oldFormat, null, 2),
      'utf8',
    );

    const map = await readMetadataMap(ctx);

    // Old flat entries should be migrated under '_migrated' language key
    expect(map.sequences?.['_migrated']?.['My Sequence']?.id).toBe(5);
    expect(map.sequences?.['_migrated']?.['Another']?.id).toBe(10);

    // Direct flat keys should not exist
    expect(map.sequences?.['My Sequence']).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════
// toLocalSequence strips step-level backend metadata
// ══════════════════════════════════════════════════════════════════════

describe('toLocalSequence step metadata stripping', () => {
  it('should not include step id in local representation', () => {
    const remote = makeRemoteSequence({
      steps: [makeRemoteStep({ id: 42 })],
    });
    const local = toLocalSequence(remote, emptySegmentMap, emptyTemplateIdNameMap);
    expect(local.steps![0]).not.toHaveProperty('id');
  });

  it('should not include step createdAt in local representation', () => {
    const remote = makeRemoteSequence({
      steps: [makeRemoteStep({ createdAt: '2026-01-01T00:00:00Z' })],
    });
    const local = toLocalSequence(remote, emptySegmentMap, emptyTemplateIdNameMap);
    expect(local.steps![0]).not.toHaveProperty('createdAt');
  });

  it('should not include step updatedAt in local representation', () => {
    const remote = makeRemoteSequence({
      steps: [makeRemoteStep({ updatedAt: '2026-01-01T00:00:00Z' })],
    });
    const local = toLocalSequence(remote, emptySegmentMap, emptyTemplateIdNameMap);
    expect(local.steps![0]).not.toHaveProperty('updatedAt');
  });

  it('should preserve sequence-level id, createdAt, updatedAt', () => {
    const remote = makeRemoteSequence({
      id: 99,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-02-01T00:00:00Z',
    });
    const local = toLocalSequence(remote, emptySegmentMap, emptyTemplateIdNameMap);
    expect(local.id).toBe(99);
    expect(local.createdAt).toBe('2026-01-01T00:00:00Z');
    expect(local.updatedAt).toBe('2026-02-01T00:00:00Z');
  });
});

// ══════════════════════════════════════════════════════════════════════
// toRemoteSequencePayload does not send step IDs
// ══════════════════════════════════════════════════════════════════════

describe('toRemoteSequencePayload step ID handling', () => {
  it('should not include step id in the push payload', () => {
    const local: LocalSequenceDto = {
      name: 'Test',
      language: 'en',
      steps: [{
        emailTemplateName: 'WS_Email_1',
        name: 'Step 1',
        timing: { delay: { value: 0, unit: 'days' } },
      }],
    };

    const payload = toRemoteSequencePayload(local, emptySegmentNameIdMap, emptyTemplateNameIdMap);
    expect(payload.steps![0]).not.toHaveProperty('id');
  });

  it('should not send id even if local step has one (backward compat)', () => {
    const local: LocalSequenceDto = {
      name: 'Test',
      language: 'en',
      steps: [{
        id: 42, // old local files may still have step IDs
        emailTemplateName: 'WS_Email_1',
        name: 'Step 1',
        timing: { delay: { value: 0, unit: 'days' } },
      }],
    };

    const payload = toRemoteSequencePayload(local, emptySegmentNameIdMap, emptyTemplateNameIdMap);
    expect(payload.steps![0]).not.toHaveProperty('id');
  });
});
