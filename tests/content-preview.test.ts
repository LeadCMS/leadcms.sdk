import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { jest } from '@jest/globals';
import { createDataServiceMock, createTestConfig } from './test-helpers';

jest.mock('../src/lib/config.js', () => ({
    getConfig: jest.fn(() => createTestConfig()),
}));

jest.mock('../src/lib/data-service.js', () => ({
    leadCMSDataService: createDataServiceMock(),
}));

jest.mock('../src/lib/content-transformation.js', () => ({
    transformRemoteToLocalFormat: jest.fn(async () => Array.from({ length: 12 }, (_, index) => `old line ${index + 1}`).join('\n')),
    transformRemoteForComparison: jest.fn(),
    hasContentDifferences: jest.fn(),
    stripTimestampMetadata: jest.fn((content: string) => content),
}));

import { displayDetailedDiff } from '../src/scripts/push-leadcms-content';

describe('content detailed preview', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'leadcms-preview-test-'));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
        jest.restoreAllMocks();
    });

    it('shows all diff lines for single-content detailed previews', async () => {
        const filePath = path.join(tmpDir, 'article.mdx');
        const localBody = Array.from({ length: 12 }, (_, index) => `new line ${index + 1}`).join('\n');
        await fs.writeFile(filePath, localBody, 'utf-8');

        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => { });

        await displayDetailedDiff({
            local: {
                slug: 'article',
                locale: 'en',
                type: 'page',
                filePath,
                metadata: {},
                body: localBody,
                isLocal: true,
            },
            remote: {
                id: 161,
                slug: 'article',
                type: 'page',
                title: 'Article',
                body: '',
                language: 'en',
                isLocal: false,
            },
        } as any, 'Modified', {}, { limitPreviewLines: false });

        const output = logSpy.mock.calls.flat().join('\n');

        expect(output).toContain('new line 12');
        expect(output).toContain('old line 12');
        expect(output).not.toContain('more changes');
    });
});
