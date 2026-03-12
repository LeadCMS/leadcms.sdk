import axios from 'axios';

import { createTestConfig } from './test-helpers';

jest.mock('axios', () => ({
    get: jest.fn(),
}));

jest.mock('../src/lib/config.js', () => ({
    getConfig: jest.fn(() => createTestConfig({
        commentsDir: '.leadcms-test/comments',
        contentDir: '.leadcms-test/content',
        mediaDir: '.leadcms-test/media',
        defaultLanguage: 'en',
    })),
}));

jest.mock('../src/scripts/leadcms-helpers.js', () => ({
    leadCMSUrl: 'https://cms.example.com',
    leadCMSApiKey: 'secret-api-key',
}));

import { pullCommentSync, toStoredComment } from '../src/scripts/pull-leadcms-comments.js';
import type { Comment } from '../src/lib/comment-types.js';

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('comment pull privacy', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('pulls comment sync without authentication headers', async () => {
        mockedAxios.get.mockResolvedValue({
            status: 200,
            data: { items: [], deleted: [] },
            headers: { 'x-next-sync-token': '' },
        } as any);

        await pullCommentSync();

        expect(mockedAxios.get).toHaveBeenCalledWith(
            expect.stringContaining('/api/comments/sync'),
            { headers: {} }
        );
    });

    it('removes authorEmail from stored pulled comments', () => {
        const comment: Comment = {
            id: 1,
            parentId: null,
            authorName: 'Jane',
            authorEmail: 'jane@example.com',
            body: 'Hello',
            createdAt: '2024-01-01T00:00:00Z',
            commentableId: 10,
            commentableType: 'Content',
            language: 'en',
        };

        const stored = toStoredComment(comment);

        expect(stored.authorEmail).toBeUndefined();
        expect(stored.authorName).toBe('Jane');
    });
});
