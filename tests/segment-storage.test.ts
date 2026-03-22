/**
 * Tests for segment local file format.
 * Segments should be stored as flat JSON (no _entityType wrapper).
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { jest } from '@jest/globals';
import { createTestConfig, createDataServiceMock } from './test-helpers';

jest.mock('../src/lib/config.js', () => ({
    getConfig: jest.fn(() => createTestConfig({ segmentsDir: '/tmp/test-segments' })),
}));

jest.mock('../src/lib/data-service.js', () => ({
    leadCMSDataService: createDataServiceMock(),
}));

describe('segment local file format', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'leadcms-seg-test-'));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('toLocalSegment strips runtime fields and returns flat object', async () => {
        const { toLocalSegment } = await import('../src/scripts/pull-segments');

        const remote = {
            id: 1,
            name: 'Corporate Domains',
            description: null,
            type: 'Dynamic' as const,
            definition: {
                includeRules: {
                    id: 'default-group',
                    connector: 'And',
                    rules: [{ id: 'r1', fieldId: 'domain.free', operator: 'IsFalse', value: '' }],
                    groups: [],
                },
                excludeRules: null,
            },
            contactCount: 42,
            createdById: 5,
            updatedById: null,
            createdByIp: '127.0.0.1',
            createdByUserAgent: 'Mozilla/5.0',
            updatedByIp: null,
            updatedByUserAgent: null,
            contactIds: [1, 2, 3],
            createdAt: '2026-03-21T18:38:09.037845Z',
            updatedAt: null,
        };

        const local = toLocalSegment(remote);

        // Should NOT have runtime fields
        expect(local).not.toHaveProperty('contactCount');
        expect(local).not.toHaveProperty('createdById');
        expect(local).not.toHaveProperty('contactIds');

        // Should have core fields at root level
        expect(local.id).toBe(1);
        expect(local.name).toBe('Corporate Domains');
        expect(local.type).toBe('Dynamic');

        // Should strip null values and empty arrays from definition
        expect(local.definition).toEqual({
            includeRules: {
                id: 'default-group',
                connector: 'And',
                rules: [{ id: 'r1', fieldId: 'domain.free', operator: 'IsFalse', value: '' }],
            },
        });
        expect(local.definition!.includeRules).not.toHaveProperty('groups');
        expect(local.definition).not.toHaveProperty('excludeRules');

        // Should strip null top-level fields
        expect(local).not.toHaveProperty('description');
        expect(local).not.toHaveProperty('updatedAt');

        // Should NOT have _entityType wrapper
        expect(local).not.toHaveProperty('_entityType');
        expect(local).not.toHaveProperty('data');
    });

    it('buildSegmentIdIndex reads flat format files', async () => {
        const { buildSegmentIdIndex } = await import('../src/scripts/pull-segments');

        // Write a flat-format segment file
        const flat = { id: 7, name: 'Test Segment', type: 'Dynamic' };
        await fs.writeFile(path.join(tmpDir, 'test-segment.json'), JSON.stringify(flat));

        const index = await buildSegmentIdIndex(tmpDir);
        expect(index.get('7')).toBe(path.join(tmpDir, 'test-segment.json'));
    });

    it('buildSegmentIdIndex reads legacy _entityType wrapper files', async () => {
        const { buildSegmentIdIndex } = await import('../src/scripts/pull-segments');

        // Write a legacy wrapper-format segment file
        const legacy = { _entityType: 'segment', data: { id: 9, name: 'Legacy Segment', type: 'Dynamic' } };
        await fs.writeFile(path.join(tmpDir, 'legacy.json'), JSON.stringify(legacy));

        const index = await buildSegmentIdIndex(tmpDir);
        expect(index.get('9')).toBe(path.join(tmpDir, 'legacy.json'));
    });

    it('saveSegmentFile produces flat JSON without _entityType wrapper', async () => {
        const { saveSegmentFile } = await import('../src/scripts/pull-segments');

        const segment = {
            id: 1,
            name: 'Corporate Domains',
            description: null,
            type: 'Dynamic' as const,
            definition: { includeRules: null, excludeRules: null },
            contactCount: 10,
            createdByIp: '127.0.0.1',
            createdAt: '2026-03-21T18:38:09.037845Z',
            updatedAt: null,
        };

        const { content } = saveSegmentFile(segment);
        const parsed = JSON.parse(content);

        // Must be flat — no wrapper
        expect(parsed).not.toHaveProperty('_entityType');
        expect(parsed).not.toHaveProperty('data');

        // Core fields at root
        expect(parsed.id).toBe(1);
        expect(parsed.name).toBe('Corporate Domains');
        expect(parsed.type).toBe('Dynamic');

        // Runtime fields stripped
        expect(parsed).not.toHaveProperty('contactCount');
        expect(parsed).not.toHaveProperty('createdByIp');

        // Null values stripped
        expect(parsed).not.toHaveProperty('description');
        expect(parsed).not.toHaveProperty('updatedAt');
    });
});
