import fs from 'fs/promises';
import path from 'path';
import os from 'os';

import { createTestConfig } from './test-helpers';

const tmpRoot = path.join(os.tmpdir(), 'leadcms-push-comments-tests');
const commentsDir = path.join(tmpRoot, 'comments');

let dataServiceMock: any;

jest.mock('../src/lib/config.js', () => ({
  getConfig: jest.fn(() => createTestConfig({
    commentsDir,
    contentDir: path.join(tmpRoot, 'content'),
    mediaDir: path.join(tmpRoot, 'media'),
    defaultLanguage: 'en',
  })),
}));

jest.mock('../src/lib/data-service.js', () => {
  dataServiceMock = {
    isApiKeyConfigured: jest.fn(() => true),
    createComment: jest.fn(),
    updateComment: jest.fn(),
    deleteComment: jest.fn(),
  };

  return {
    leadCMSDataService: dataServiceMock,
  };
});

jest.mock('../src/scripts/fetch-leadcms-comments.js', () => {
  const actual = jest.requireActual('../src/scripts/fetch-leadcms-comments.js');
  return {
    ...actual,
    fetchCommentSync: jest.fn(),
  };
});

import { buildCommentStatus, pushComments, statusComments } from '../src/scripts/push-comments';
import { fetchCommentSync } from '../src/scripts/fetch-leadcms-comments';

const mockedFetchCommentSync = fetchCommentSync as jest.MockedFunction<typeof fetchCommentSync>;

async function writeCommentFile(relativePath: string, comments: any[]): Promise<string> {
  const filePath = path.join(commentsDir, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(comments, null, 2), 'utf8');
  return filePath;
}

describe('push-comments', () => {
  beforeEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
    await fs.mkdir(commentsDir, { recursive: true });
    jest.clearAllMocks();
    dataServiceMock.isApiKeyConfigured.mockReturnValue(true);
    mockedFetchCommentSync.mockResolvedValue({ items: [], deleted: [], nextSyncToken: 'sync-1' } as any);
  });

  afterAll(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('builds comment status with create, update, conflict, and delete operations', async () => {
    await writeCommentFile('content/110.json', [
      {
        id: 10,
        parentId: 864,
        authorName: 'Peter Liapin',
        authorEmail: 'peter@xltools.net',
        body: 'Updated locally',
        status: 'Approved',
        answerStatus: 'Answered',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        commentableId: 110,
        commentableType: 'Content',
        language: 'ru-RU',
      },
      {
        parentId: 864,
        authorName: 'Peter Liapin',
        authorEmail: 'peter@xltools.net',
        body: 'Brand new local reply',
        status: 'Approved',
        commentableId: 110,
        commentableType: 'Content',
        language: 'ru-RU',
      },
      {
        id: 11,
        parentId: 864,
        authorName: 'Peter Liapin',
        authorEmail: 'peter@xltools.net',
        body: 'Conflicting local edit',
        status: 'Approved',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        commentableId: 110,
        commentableType: 'Content',
        language: 'ru-RU',
      },
    ]);

    mockedFetchCommentSync.mockResolvedValue({
      items: [
        {
          id: 10,
          parentId: 864,
          authorName: 'Peter Liapin',
          authorEmail: 'peter@xltools.net',
          body: 'Original remote body',
          status: 'Approved',
          answerStatus: 'Answered',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-02T00:00:00Z',
          commentableId: 110,
          commentableType: 'Content',
          language: 'ru-RU',
        },
        {
          id: 11,
          parentId: 864,
          authorName: 'Peter Liapin',
          authorEmail: 'peter@xltools.net',
          body: 'Remote changed after pull',
          status: 'Approved',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-02-01T00:00:00Z',
          commentableId: 110,
          commentableType: 'Content',
          language: 'ru-RU',
        },
        {
          id: 12,
          parentId: 864,
          authorName: 'Remote only',
          authorEmail: 'remote@example.com',
          body: 'Remote only reply',
          status: 'Approved',
          createdAt: '2024-01-05T00:00:00Z',
          updatedAt: '2024-01-05T00:00:00Z',
          commentableId: 110,
          commentableType: 'Content',
          language: 'ru-RU',
        },
      ],
      deleted: [],
      nextSyncToken: 'sync-2',
    } as any);

    const result = await buildCommentStatus({ showDelete: true });

    expect(result.operations.filter(op => op.type === 'create')).toHaveLength(1);
    expect(result.operations.filter(op => op.type === 'update')).toHaveLength(1);
    expect(result.operations.filter(op => op.type === 'conflict')).toHaveLength(1);
    expect(result.operations.filter(op => op.type === 'delete')).toHaveLength(1);
  });

  it('creates new comments using file-derived metadata and updates the local file with API response', async () => {
    const filePath = await writeCommentFile('ru-RU/content/110.json', [
      {
        parentId: 864,
        authorName: 'Peter Liapin',
        authorEmail: 'peter@xltools.net',
        body: 'Brand new local reply',
        status: 'Approved',
      },
    ]);

    dataServiceMock.createComment.mockResolvedValue({
      id: 1001,
      parentId: 864,
      authorName: 'Peter Liapin',
      authorEmail: 'peter@xltools.net',
      body: 'Brand new local reply',
      status: 'Approved',
      createdAt: '2024-03-01T00:00:00Z',
      updatedAt: '2024-03-01T00:00:00Z',
      commentableId: 110,
      commentableType: 'Content',
      language: 'ru-RU',
    });

    await pushComments();

    expect(dataServiceMock.createComment).toHaveBeenCalledWith({
      parentId: 864,
      authorName: 'Peter Liapin',
      authorEmail: 'peter@xltools.net',
      body: 'Brand new local reply',
      status: 'Approved',
      commentableId: 110,
      commentableType: 'Content',
      language: 'ru-RU',
    });

    const saved = JSON.parse(await fs.readFile(filePath, 'utf8'));
    expect(saved[0].id).toBe(1001);
    expect(saved[0].commentableId).toBe(110);
    expect(saved[0].commentableType).toBe('Content');
    expect(saved[0].language).toBe('ru-RU');
  });

  it('updates matching comments and deletes remote-only comments when delete mode is enabled', async () => {
    await writeCommentFile('content/110.json', [
      {
        id: 20,
        parentId: 864,
        authorName: 'Peter Liapin',
        authorEmail: 'peter@xltools.net',
        body: 'Locally updated reply',
        status: 'Approved',
        answerStatus: 'Answered',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        commentableId: 110,
        commentableType: 'Content',
        language: 'en',
      },
    ]);

    mockedFetchCommentSync.mockResolvedValue({
      items: [
        {
          id: 20,
          parentId: 864,
          authorName: 'Peter Liapin',
          authorEmail: 'peter@xltools.net',
          body: 'Remote old reply',
          status: 'Approved',
          answerStatus: 'Unanswered',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-02T00:00:00Z',
          commentableId: 110,
          commentableType: 'Content',
          language: 'en',
        },
        {
          id: 21,
          parentId: 864,
          authorName: 'Remote only',
          authorEmail: 'remote@example.com',
          body: 'Delete me remotely',
          status: 'Approved',
          createdAt: '2024-01-03T00:00:00Z',
          updatedAt: '2024-01-03T00:00:00Z',
          commentableId: 110,
          commentableType: 'Content',
          language: 'en',
        },
      ],
      deleted: [],
      nextSyncToken: 'sync-3',
    } as any);

    dataServiceMock.updateComment.mockResolvedValue({
      id: 20,
      parentId: 864,
      authorName: 'Peter Liapin',
      authorEmail: 'peter@xltools.net',
      body: 'Locally updated reply',
      status: 'Approved',
      answerStatus: 'Answered',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-03-01T00:00:00Z',
      commentableId: 110,
      commentableType: 'Content',
      language: 'en',
    });

    await pushComments({ allowDelete: true });

    expect(dataServiceMock.updateComment).toHaveBeenCalledWith(20, {
      body: 'Locally updated reply',
      authorName: 'Peter Liapin',
      authorEmail: 'peter@xltools.net',
      language: 'en',
      status: 'Approved',
      answerStatus: 'Answered',
    });
    expect(dataServiceMock.deleteComment).toHaveBeenCalledWith(21);
  });

  it('skips conflicting updates unless force is enabled', async () => {
    await writeCommentFile('content/110.json', [
      {
        id: 30,
        parentId: 864,
        authorName: 'Peter Liapin',
        authorEmail: 'peter@xltools.net',
        body: 'Local conflicting body',
        status: 'Approved',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        commentableId: 110,
        commentableType: 'Content',
        language: 'en',
      },
    ]);

    mockedFetchCommentSync.mockResolvedValue({
      items: [
        {
          id: 30,
          parentId: 864,
          authorName: 'Peter Liapin',
          authorEmail: 'peter@xltools.net',
          body: 'Remote conflicting body',
          status: 'Approved',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-02-01T00:00:00Z',
          commentableId: 110,
          commentableType: 'Content',
          language: 'en',
        },
      ],
      deleted: [],
      nextSyncToken: 'sync-4',
    } as any);

    await pushComments();
    expect(dataServiceMock.updateComment).not.toHaveBeenCalled();

    dataServiceMock.updateComment.mockResolvedValue({
      id: 30,
      parentId: 864,
      authorName: 'Peter Liapin',
      authorEmail: 'peter@xltools.net',
      body: 'Local conflicting body',
      status: 'Approved',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-03-01T00:00:00Z',
      commentableId: 110,
      commentableType: 'Content',
      language: 'en',
    });

    await pushComments({ force: true });
    expect(dataServiceMock.updateComment).toHaveBeenCalledWith(30, {
      body: 'Local conflicting body',
      authorName: 'Peter Liapin',
      authorEmail: 'peter@xltools.net',
      language: 'en',
      status: 'Approved',
    });
  });

  it('shows detailed preview for comment updates when preview is enabled', async () => {
    await writeCommentFile('content/110.json', [
      {
        id: 40,
        parentId: 864,
        authorName: 'Peter Liapin',
        authorEmail: 'peter@xltools.net',
        body: 'Local preview body',
        status: 'Approved',
        answerStatus: 'Answered',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        commentableId: 110,
        commentableType: 'Content',
        language: 'en',
      },
    ]);

    mockedFetchCommentSync.mockResolvedValue({
      items: [
        {
          id: 40,
          parentId: 864,
          authorName: 'Peter Liapin',
          authorEmail: 'peter@xltools.net',
          body: 'Remote preview body',
          status: 'Approved',
          answerStatus: 'Unanswered',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-02T00:00:00Z',
          commentableId: 110,
          commentableType: 'Content',
          language: 'en',
        },
      ],
      deleted: [],
      nextSyncToken: 'sync-5',
    } as any);

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => { });

    await statusComments({ showDetailedPreview: true });

    const output = logSpy.mock.calls.flat().join('\n');
    expect(output).toContain('Comment diff preview:');
    expect(output).toContain('answerStatus');
    expect(output).toContain('Local preview body');

    logSpy.mockRestore();
  });
});
