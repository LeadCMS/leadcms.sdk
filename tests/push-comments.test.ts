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

jest.mock('../src/scripts/pull-leadcms-comments.js', () => {
  const actual = jest.requireActual('../src/scripts/pull-leadcms-comments.js');
  return {
    ...actual,
    pullCommentSync: jest.fn(),
    pullLeadCMSComments: jest.fn(),
  };
});

import { buildCommentStatus, pushComments, statusComments } from '../src/scripts/push-comments';
import { pullCommentSync, pullLeadCMSComments } from '../src/scripts/pull-leadcms-comments';

const mockedPullCommentSync = pullCommentSync as jest.MockedFunction<typeof pullCommentSync>;
const mockedPullLeadCMSComments = pullLeadCMSComments as jest.MockedFunction<typeof pullLeadCMSComments>;

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
    mockedPullCommentSync.mockResolvedValue({ items: [], deleted: [], nextSyncToken: 'sync-1' } as any);
    mockedPullLeadCMSComments.mockResolvedValue(undefined);
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

    mockedPullCommentSync.mockResolvedValue({
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
        avatarUrl: 'https://example.com/avatars/peter.png',
        body: 'Brand new local reply',
        status: 'Approved',
      },
    ]);

    dataServiceMock.createComment.mockResolvedValue({
      id: 1001,
      parentId: 864,
      authorName: 'Peter Liapin',
      authorEmail: 'peter@xltools.net',
      avatarUrl: 'https://example.com/avatars/peter.png',
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
    expect(mockedPullLeadCMSComments).toHaveBeenCalledTimes(1);

    const saved = JSON.parse(await fs.readFile(filePath, 'utf8'));
    expect(saved[0].id).toBe(1001);
    expect(saved[0].commentableId).toBe(110);
    expect(saved[0].commentableType).toBe('Content');
    expect(saved[0].language).toBe('ru-RU');
    expect(saved[0].avatarUrl).toBe('https://example.com/avatars/peter.png');
  });

  it('updates matching comments and deletes remote-only comments when delete mode is enabled', async () => {
    await writeCommentFile('content/110.json', [
      {
        id: 20,
        parentId: 864,
        authorName: 'Peter Liapin',
        authorEmail: 'peter@xltools.net',
        avatarUrl: 'https://example.com/avatars/peter-local.png',
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

    mockedPullCommentSync.mockResolvedValue({
      items: [
        {
          id: 20,
          parentId: 864,
          authorName: 'Peter Liapin',
          authorEmail: 'peter@xltools.net',
          avatarUrl: 'https://example.com/avatars/peter-remote-old.png',
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
      avatarUrl: 'https://example.com/avatars/peter-local.png',
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
      language: 'en',
      status: 'Approved',
      answerStatus: 'Answered',
    });
    expect(dataServiceMock.deleteComment).toHaveBeenCalledWith(21);
    expect(mockedPullLeadCMSComments).toHaveBeenCalledTimes(1);
  });

  it('skips conflicting updates unless force is enabled', async () => {
    await writeCommentFile('content/110.json', [
      {
        id: 30,
        parentId: 864,
        authorName: 'Peter Liapin',
        authorEmail: 'peter@xltools.net',
        avatarUrl: 'https://example.com/avatars/peter-local.png',
        body: 'Local conflicting body',
        status: 'Approved',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        commentableId: 110,
        commentableType: 'Content',
        language: 'en',
      },
    ]);

    mockedPullCommentSync.mockResolvedValue({
      items: [
        {
          id: 30,
          parentId: 864,
          authorName: 'Peter Liapin',
          authorEmail: 'peter@xltools.net',
          avatarUrl: 'https://example.com/avatars/peter-remote.png',
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
      avatarUrl: 'https://example.com/avatars/peter-local.png',
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
      language: 'en',
      status: 'Approved',
    });
    expect(mockedPullLeadCMSComments).toHaveBeenCalledTimes(1);
  });

  it('does not treat avatarUrl-only local edits as client-side updates', async () => {
    await writeCommentFile('content/110.json', [
      {
        id: 50,
        parentId: 864,
        authorName: 'Peter Liapin',
        authorEmail: 'peter@xltools.net',
        avatarUrl: 'https://example.com/avatars/peter-local.png',
        body: 'Unchanged body',
        status: 'Approved',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        commentableId: 110,
        commentableType: 'Content',
        language: 'en',
      },
    ]);

    mockedPullCommentSync.mockResolvedValue({
      items: [
        {
          id: 50,
          parentId: 864,
          authorName: 'Peter Liapin',
          authorEmail: 'peter@xltools.net',
          avatarUrl: 'https://example.com/avatars/peter-server.png',
          body: 'Unchanged body',
          status: 'Approved',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-02T00:00:00Z',
          commentableId: 110,
          commentableType: 'Content',
          language: 'en',
        },
      ],
      deleted: [],
      nextSyncToken: 'sync-avatar',
    } as any);

    const result = await buildCommentStatus();

    expect(result.operations).toHaveLength(0);
  });

  it('removes authorEmail locally after create before anonymous refresh completes', async () => {
    const filePath = await writeCommentFile('content/110.json', [
      {
        parentId: 864,
        authorName: 'Peter Liapin',
        authorEmail: 'peter@xltools.net',
        body: 'Brand new local reply',
        status: 'Approved',
      },
    ]);

    dataServiceMock.createComment.mockResolvedValue({
      id: 1002,
      parentId: 864,
      authorName: 'Peter Liapin',
      authorEmail: 'peter@xltools.net',
      body: 'Brand new local reply',
      status: 'Approved',
      createdAt: '2024-03-01T00:00:00Z',
      updatedAt: '2024-03-01T00:00:00Z',
      commentableId: 110,
      commentableType: 'Content',
      language: 'en',
    });
    mockedPullLeadCMSComments.mockRejectedValue(new Error('refresh failed'));

    await expect(pushComments()).rejects.toThrow('refresh failed');

    const saved = JSON.parse(await fs.readFile(filePath, 'utf8'));
    expect(saved[0].id).toBe(1002);
    expect(saved[0].authorEmail).toBeUndefined();
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

    mockedPullCommentSync.mockResolvedValue({
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

  describe('metadata-aware comment matching', () => {
    it('uses metadata map to match comments by translationKey when remoteContext is provided', async () => {
      // Local file has defaultRemote's ID (id: 50) but the non-default remote has id: 500
      await writeCommentFile('content/110.json', [
        {
          id: 50, // default remote's ID
          translationKey: 'tk-match-1',
          authorName: 'Test Author',
          body: 'Updated locally',
          status: 'Approved',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-02T00:00:00Z',
          commentableId: 110,
          commentableType: 'Content',
          language: 'en',
        },
      ]);

      // Remote returns the non-default remote's comment with id: 500
      mockedPullCommentSync.mockResolvedValue({
        items: [
          {
            id: 500,
            translationKey: 'tk-match-1',
            authorName: 'Test Author',
            body: 'Remote body - same',
            status: 'Approved',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-02T00:00:00Z',
            commentableId: 110,
            commentableType: 'Content',
            language: 'en',
          },
        ],
        deleted: [],
        nextSyncToken: 'sync-meta-1',
      } as any);

      // Mock the remote-context module to provide a metadata map
      const metaStateDir = path.join(tmpRoot, '.leadcms', 'remotes', 'develop');
      await fs.mkdir(metaStateDir, { recursive: true });
      await fs.writeFile(
        path.join(metaStateDir, 'metadata.json'),
        JSON.stringify({
          content: {},
          emailTemplates: {},
          comments: {
            en: { 'tk-match-1': { id: 500, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-02T00:00:00Z' } },
          },
        }),
      );

      const remoteContext = {
        name: 'develop',
        url: 'https://dev.example.com',
        apiKey: 'dev-key',
        isDefault: false,
        stateDir: metaStateDir,
      };

      const result = await buildCommentStatus({ remoteContext });

      // Should match via metadata map (translationKey) → finds the update, not a create
      const creates = result.operations.filter(op => op.type === 'create');
      const updates = result.operations.filter(op => op.type === 'update');
      expect(creates).toHaveLength(0);
      // The body differs so it should be an update
      expect(updates).toHaveLength(1);
    });

    it('falls back to translationKey matching against remote when no metadata entry exists', async () => {
      await writeCommentFile('content/110.json', [
        {
          // No id — brand new locally but has translationKey
          translationKey: 'tk-new-remote',
          authorName: 'New Author',
          body: 'Local body',
          status: 'Approved',
          commentableId: 110,
          commentableType: 'Content',
          language: 'en',
        },
      ]);

      // Remote happens to have a comment with the same translationKey
      mockedPullCommentSync.mockResolvedValue({
        items: [
          {
            id: 700,
            translationKey: 'tk-new-remote',
            authorName: 'New Author',
            body: 'Remote body different',
            status: 'Approved',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-02T00:00:00Z',
            commentableId: 110,
            commentableType: 'Content',
            language: 'en',
          },
        ],
        deleted: [],
        nextSyncToken: 'sync-tk-1',
      } as any);

      const result = await buildCommentStatus({});

      // Should match via translationKey fallback → update, not create
      const creates = result.operations.filter(op => op.type === 'create');
      const updates = result.operations.filter(op => op.type === 'update');
      expect(creates).toHaveLength(0);
      expect(updates).toHaveLength(1);
    });

    it('uses metadata map timestamps for conflict detection', async () => {
      await writeCommentFile('content/110.json', [
        {
          id: 60,
          translationKey: 'tk-conflict',
          authorName: 'Author',
          body: 'Local edit',
          status: 'Approved',
          createdAt: '2024-01-01T00:00:00Z',
          updatedAt: '2024-01-05T00:00:00Z', // Default remote's timestamp
          commentableId: 110,
          commentableType: 'Content',
          language: 'en',
        },
      ]);

      // Remote has newer updatedAt than what's in the metadata map
      mockedPullCommentSync.mockResolvedValue({
        items: [
          {
            id: 600,
            translationKey: 'tk-conflict',
            authorName: 'Author',
            body: 'Remote changed body',
            status: 'Approved',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-03-01T00:00:00Z', // Newer than metadata map
            commentableId: 110,
            commentableType: 'Content',
            language: 'en',
          },
        ],
        deleted: [],
        nextSyncToken: 'sync-conflict-1',
      } as any);

      const metaStateDir = path.join(tmpRoot, '.leadcms', 'remotes', 'staging');
      await fs.mkdir(metaStateDir, { recursive: true });
      await fs.writeFile(
        path.join(metaStateDir, 'metadata.json'),
        JSON.stringify({
          content: {},
          emailTemplates: {},
          comments: {
            en: { 'tk-conflict': { id: 600, createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-02-01T00:00:00Z' } },
          },
        }),
      );

      const remoteContext = {
        name: 'staging',
        url: 'https://staging.example.com',
        apiKey: 'staging-key',
        isDefault: false,
        stateDir: metaStateDir,
      };

      const result = await buildCommentStatus({ remoteContext });

      // Remote updatedAt (2024-03) > metadata map updatedAt (2024-02) → conflict
      const conflicts = result.operations.filter(op => op.type === 'conflict');
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].reason).toContain('Remote comment changed after the last pull');
    });
  });
});
