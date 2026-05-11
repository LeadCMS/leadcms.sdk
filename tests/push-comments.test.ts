import fs from "fs/promises";
import path from "path";
import os from "os";

import { createTestConfig } from "./test-helpers";

const tmpRoot = path.join(os.tmpdir(), "leadcms-push-comments-tests");
const commentsDir = path.join(tmpRoot, "comments");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let dataServiceMock: any;

jest.mock("../src/lib/config.js", () => ({
  getConfig: jest.fn(() =>
    createTestConfig({
      commentsDir,
      contentDir: path.join(tmpRoot, "content"),
      mediaDir: path.join(tmpRoot, "media"),
      defaultLanguage: "en",
    })
  ),
}));

jest.mock("../src/lib/data-service.js", () => {
  dataServiceMock = {
    isApiKeyConfigured: jest.fn(() => true),
    createComment: jest.fn(),
    updateComment: jest.fn(),
    deleteComment: jest.fn(),
    getServerVersion: jest.fn(() => Promise.resolve("1.5.16-pre")),
  };

  return {
    leadCMSDataService: dataServiceMock,
  };
});

jest.mock("../src/scripts/pull-leadcms-comments.js", () => {
  const actual = jest.requireActual("../src/scripts/pull-leadcms-comments.js");
  return {
    ...actual,
    pullCommentSync: jest.fn(),
    pullLeadCMSComments: jest.fn(),
  };
});

import { buildCommentStatus, pushComments, statusComments } from "../src/scripts/push-comments";
import { pullCommentSync, pullLeadCMSComments } from "../src/scripts/pull-leadcms-comments";

const mockedPullCommentSync = pullCommentSync as jest.MockedFunction<typeof pullCommentSync>;
const mockedPullLeadCMSComments = pullLeadCMSComments as jest.MockedFunction<
  typeof pullLeadCMSComments
>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function writeCommentFile(relativePath: string, comments: any[]): Promise<string> {
  const filePath = path.join(commentsDir, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(comments, null, 2), "utf8");
  return filePath;
}

describe("push-comments", () => {
  beforeEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
    await fs.mkdir(commentsDir, { recursive: true });
    jest.clearAllMocks();
    dataServiceMock.isApiKeyConfigured.mockReturnValue(true);
    dataServiceMock.getServerVersion.mockResolvedValue("1.5.16-pre");
    mockedPullCommentSync.mockResolvedValue({
      items: [],
      deleted: [],
      nextSyncToken: "sync-1",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    mockedPullLeadCMSComments.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("builds comment status with create, update, conflict, and delete operations", async () => {
    await writeCommentFile("content/110.json", [
      {
        id: 10,
        parentId: 864,
        authorName: "Peter Liapin",
        authorEmail: "peter@xltools.net",
        body: "Updated locally",
        status: "Approved",
        answerStatus: "Answered",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-02T00:00:00Z",
        commentableId: 110,
        commentableType: "Content",
        language: "ru-RU",
      },
      {
        parentId: 864,
        authorName: "Peter Liapin",
        authorEmail: "peter@xltools.net",
        body: "Brand new local reply",
        status: "Approved",
        commentableId: 110,
        commentableType: "Content",
        language: "ru-RU",
      },
      {
        id: 11,
        parentId: 864,
        authorName: "Peter Liapin",
        authorEmail: "peter@xltools.net",
        body: "Conflicting local edit",
        status: "Approved",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
        commentableId: 110,
        commentableType: "Content",
        language: "ru-RU",
      },
    ]);

    mockedPullCommentSync.mockResolvedValue({
      items: [
        {
          id: 10,
          parentId: 864,
          authorName: "Peter Liapin",
          authorEmail: "peter@xltools.net",
          body: "Original remote body",
          status: "Approved",
          answerStatus: "Answered",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
          commentableId: 110,
          commentableType: "Content",
          language: "ru-RU",
        },
        {
          id: 11,
          parentId: 864,
          authorName: "Peter Liapin",
          authorEmail: "peter@xltools.net",
          body: "Remote changed after pull",
          status: "Approved",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-02-01T00:00:00Z",
          commentableId: 110,
          commentableType: "Content",
          language: "ru-RU",
        },
        {
          id: 12,
          parentId: 864,
          authorName: "Remote only",
          authorEmail: "remote@example.com",
          body: "Remote only reply",
          status: "Approved",
          createdAt: "2024-01-05T00:00:00Z",
          updatedAt: "2024-01-05T00:00:00Z",
          commentableId: 110,
          commentableType: "Content",
          language: "ru-RU",
        },
      ],
      deleted: [],
      nextSyncToken: "sync-2",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const result = await buildCommentStatus({ showDelete: true });

    expect(result.operations.filter((op) => op.type === "create")).toHaveLength(1);
    expect(result.operations.filter((op) => op.type === "update")).toHaveLength(1);
    expect(result.operations.filter((op) => op.type === "conflict")).toHaveLength(1);
    expect(result.operations.filter((op) => op.type === "delete")).toHaveLength(1);
  });

  it("creates new comments using file-derived metadata and updates the local file with API response", async () => {
    const filePath = await writeCommentFile("ru-RU/content/110.json", [
      {
        parentId: 864,
        authorName: "Peter Liapin",
        authorEmail: "peter@xltools.net",
        avatarUrl: "https://example.com/avatars/peter.png",
        body: "Brand new local reply",
        status: "Approved",
      },
    ]);

    dataServiceMock.createComment.mockResolvedValue({
      id: 1001,
      parentId: 864,
      authorName: "Peter Liapin",
      authorEmail: "peter@xltools.net",
      avatarUrl: "https://example.com/avatars/peter.png",
      body: "Brand new local reply",
      status: "Approved",
      createdAt: "2024-03-01T00:00:00Z",
      updatedAt: "2024-03-01T00:00:00Z",
      commentableId: 110,
      commentableType: "Content",
      language: "ru-RU",
    });

    await pushComments();

    expect(dataServiceMock.createComment).toHaveBeenCalledWith({
      parentId: 864,
      authorName: "Peter Liapin",
      authorEmail: "peter@xltools.net",
      body: "Brand new local reply",
      status: "Approved",
      commentableId: 110,
      commentableType: "Content",
      language: "ru-RU",
    });
    expect(mockedPullLeadCMSComments).toHaveBeenCalledTimes(1);

    const saved = JSON.parse(await fs.readFile(filePath, "utf8"));
    expect(saved[0].id).toBe(1001);
    expect(saved[0].commentableId).toBe(110);
    expect(saved[0].commentableType).toBe("Content");
    expect(saved[0].language).toBe("ru-RU");
    expect(saved[0].avatarUrl).toBe("https://example.com/avatars/peter.png");
  });

  it("stamps translationKey and clears authorEmail on non-default remote create so the post-push pull can merge without duplicating", async () => {
    const filePath = await writeCommentFile("ru-RU/content/162.json", [
      {
        parentId: 864,
        authorName: "Peter Liapin",
        authorEmail: "peter@xltools.net",
        avatarUrl: "https://www.gravatar.com/avatar/abc?size=48&d=mp",
        body: "Здравствуйте, Геннадий!",
        publishedAt: "2026-01-15T09:00:00Z",
        commentableId: 162,
        commentableType: "Content",
        language: "ru-RU",
      },
    ]);

    dataServiceMock.createComment.mockResolvedValue({
      id: 957,
      parentId: 864,
      authorName: "Peter Liapin",
      body: "Здравствуйте, Геннадий!",
      status: "Approved",
      createdAt: "2026-01-15T09:00:00Z",
      updatedAt: "2026-01-15T09:00:00Z",
      publishedAt: "2026-01-15T09:00:00Z",
      commentableId: 162,
      commentableType: "Content",
      language: "ru-RU",
      translationKey: "comment_content_162_27b170fc_a4906d49",
    });

    const metaStateDir = path.join(tmpRoot, ".leadcms", "remotes", "loc");
    await fs.mkdir(metaStateDir, { recursive: true });

    const remoteContext = {
      name: "loc",
      url: "http://localhost:45437",
      apiKey: "loc-key",
      isDefault: false,
      stateDir: metaStateDir,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await pushComments({ remoteContext: remoteContext as any });

    const saved = JSON.parse(await fs.readFile(filePath, "utf8"));
    // Single entry — no duplicate row created by push
    expect(saved).toHaveLength(1);
    // translationKey is stamped so the post-push anonymous pull can merge by key
    expect(saved[0].translationKey).toBe("comment_content_162_27b170fc_a4906d49");
    // authorEmail MUST be preserved so the same entry can still be CREATE-d on
    // the default remote later (create requires authorEmail). It's the pull
    // after the default-remote push that finally strips it.
    expect(saved[0].authorEmail).toBe("peter@xltools.net");
    // id/createdAt/updatedAt remain the default remote's responsibility, so not written
    expect(saved[0]).not.toHaveProperty("id");
    expect(saved[0]).not.toHaveProperty("createdAt");
    expect(saved[0]).not.toHaveProperty("updatedAt");
  });

  it("updates matching comments and deletes remote-only comments when delete mode is enabled", async () => {
    await writeCommentFile("content/110.json", [
      {
        id: 20,
        parentId: 864,
        authorName: "Peter Liapin",
        authorEmail: "peter@xltools.net",
        avatarUrl: "https://example.com/avatars/peter-local.png",
        body: "Locally updated reply",
        status: "Approved",
        answerStatus: "Answered",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-02T00:00:00Z",
        commentableId: 110,
        commentableType: "Content",
        language: "en",
      },
    ]);

    mockedPullCommentSync.mockResolvedValue({
      items: [
        {
          id: 20,
          parentId: 864,
          authorName: "Peter Liapin",
          authorEmail: "peter@xltools.net",
          avatarUrl: "https://example.com/avatars/peter-remote-old.png",
          body: "Remote old reply",
          status: "Approved",
          answerStatus: "Unanswered",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
          commentableId: 110,
          commentableType: "Content",
          language: "en",
        },
        {
          id: 21,
          parentId: 864,
          authorName: "Remote only",
          authorEmail: "remote@example.com",
          body: "Delete me remotely",
          status: "Approved",
          createdAt: "2024-01-03T00:00:00Z",
          updatedAt: "2024-01-03T00:00:00Z",
          commentableId: 110,
          commentableType: "Content",
          language: "en",
        },
      ],
      deleted: [],
      nextSyncToken: "sync-3",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    dataServiceMock.updateComment.mockResolvedValue({
      id: 20,
      parentId: 864,
      authorName: "Peter Liapin",
      authorEmail: "peter@xltools.net",
      avatarUrl: "https://example.com/avatars/peter-local.png",
      body: "Locally updated reply",
      status: "Approved",
      answerStatus: "Answered",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-03-01T00:00:00Z",
      commentableId: 110,
      commentableType: "Content",
      language: "en",
    });

    await pushComments({ allowDelete: true });

    expect(dataServiceMock.updateComment).toHaveBeenCalledWith(20, {
      body: "Locally updated reply",
      authorName: "Peter Liapin",
      language: "en",
      parentId: 864,
      commentableId: 110,
      status: "Approved",
      answerStatus: "Answered",
    });
    expect(dataServiceMock.deleteComment).toHaveBeenCalledWith(21);
    expect(mockedPullLeadCMSComments).toHaveBeenCalledTimes(1);
  });

  it("skips conflicting updates unless force is enabled", async () => {
    await writeCommentFile("content/110.json", [
      {
        id: 30,
        parentId: 864,
        authorName: "Peter Liapin",
        authorEmail: "peter@xltools.net",
        avatarUrl: "https://example.com/avatars/peter-local.png",
        body: "Local conflicting body",
        status: "Approved",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
        commentableId: 110,
        commentableType: "Content",
        language: "en",
      },
    ]);

    mockedPullCommentSync.mockResolvedValue({
      items: [
        {
          id: 30,
          parentId: 864,
          authorName: "Peter Liapin",
          authorEmail: "peter@xltools.net",
          avatarUrl: "https://example.com/avatars/peter-remote.png",
          body: "Remote conflicting body",
          status: "Approved",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-02-01T00:00:00Z",
          commentableId: 110,
          commentableType: "Content",
          language: "en",
        },
      ],
      deleted: [],
      nextSyncToken: "sync-4",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    await pushComments();
    expect(dataServiceMock.updateComment).not.toHaveBeenCalled();

    dataServiceMock.updateComment.mockResolvedValue({
      id: 30,
      parentId: 864,
      authorName: "Peter Liapin",
      authorEmail: "peter@xltools.net",
      avatarUrl: "https://example.com/avatars/peter-local.png",
      body: "Local conflicting body",
      status: "Approved",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-03-01T00:00:00Z",
      commentableId: 110,
      commentableType: "Content",
      language: "en",
    });

    await pushComments({ force: true });
    expect(dataServiceMock.updateComment).toHaveBeenCalledWith(30, {
      body: "Local conflicting body",
      authorName: "Peter Liapin",
      language: "en",
      parentId: 864,
      commentableId: 110,
      status: "Approved",
    });
    expect(mockedPullLeadCMSComments).toHaveBeenCalledTimes(1);
  });

  it("does not treat avatarUrl-only local edits as client-side updates", async () => {
    await writeCommentFile("content/110.json", [
      {
        id: 50,
        parentId: 864,
        authorName: "Peter Liapin",
        authorEmail: "peter@xltools.net",
        avatarUrl: "https://example.com/avatars/peter-local.png",
        body: "Unchanged body",
        status: "Approved",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-02T00:00:00Z",
        commentableId: 110,
        commentableType: "Content",
        language: "en",
      },
    ]);

    mockedPullCommentSync.mockResolvedValue({
      items: [
        {
          id: 50,
          parentId: 864,
          authorName: "Peter Liapin",
          authorEmail: "peter@xltools.net",
          avatarUrl: "https://example.com/avatars/peter-server.png",
          body: "Unchanged body",
          status: "Approved",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
          commentableId: 110,
          commentableType: "Content",
          language: "en",
        },
      ],
      deleted: [],
      nextSyncToken: "sync-avatar",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const result = await buildCommentStatus();

    expect(result.operations).toHaveLength(0);
  });

  it("removes authorEmail locally after create before anonymous refresh completes", async () => {
    const filePath = await writeCommentFile("content/110.json", [
      {
        parentId: 864,
        authorName: "Peter Liapin",
        authorEmail: "peter@xltools.net",
        body: "Brand new local reply",
        status: "Approved",
      },
    ]);

    dataServiceMock.createComment.mockResolvedValue({
      id: 1002,
      parentId: 864,
      authorName: "Peter Liapin",
      authorEmail: "peter@xltools.net",
      body: "Brand new local reply",
      status: "Approved",
      createdAt: "2024-03-01T00:00:00Z",
      updatedAt: "2024-03-01T00:00:00Z",
      commentableId: 110,
      commentableType: "Content",
      language: "en",
    });
    mockedPullLeadCMSComments.mockRejectedValue(new Error("refresh failed"));

    await expect(pushComments()).rejects.toThrow("refresh failed");

    const saved = JSON.parse(await fs.readFile(filePath, "utf8"));
    expect(saved[0].id).toBe(1002);
    expect(saved[0].authorEmail).toBeUndefined();
  });

  it("shows detailed preview for comment updates when preview is enabled", async () => {
    await writeCommentFile("content/110.json", [
      {
        id: 40,
        parentId: 864,
        authorName: "Peter Liapin",
        authorEmail: "peter@xltools.net",
        body: "Local preview body",
        status: "Approved",
        answerStatus: "Answered",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-02T00:00:00Z",
        commentableId: 110,
        commentableType: "Content",
        language: "en",
      },
    ]);

    mockedPullCommentSync.mockResolvedValue({
      items: [
        {
          id: 40,
          parentId: 864,
          authorName: "Peter Liapin",
          authorEmail: "peter@xltools.net",
          body: "Remote preview body",
          status: "Approved",
          answerStatus: "Unanswered",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
          commentableId: 110,
          commentableType: "Content",
          language: "en",
        },
      ],
      deleted: [],
      nextSyncToken: "sync-5",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => { });

    await statusComments({ showDetailedPreview: true });

    const output = logSpy.mock.calls.flat().join("\n");
    expect(output).toContain("Comment diff preview:");
    expect(output).toContain("answerStatus");
    expect(output).toContain("Local preview body");

    logSpy.mockRestore();
  });

  it('does not print a duplicate "new" comment reference for create rows in status output', async () => {
    await writeCommentFile("content/110.json", [
      {
        parentId: 864,
        authorName: "Peter Liapin",
        authorEmail: "peter@xltools.net",
        body: "Brand new\n\nlocal reply   with extra   spaces",
        status: "Approved",
        commentableId: 110,
        commentableType: "Content",
        language: "en",
      },
    ]);

    mockedPullCommentSync.mockResolvedValue({
      items: [],
      deleted: [],
      nextSyncToken: "sync-new-status",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const logSpy = jest.spyOn(console, "log").mockImplementation(() => { });

    await statusComments();

    const output = logSpy.mock.calls.flat().join("\n");
    expect(output).toContain("new:");
    expect(output).toContain("Content #110");
    expect(output).toContain('"Brand new local reply with extra spaces"');
    expect(output).not.toContain("comment new");
    expect(output).not.toContain("Brand new\n\nlocal reply");

    logSpy.mockRestore();
  });

  describe("metadata-aware comment matching", () => {
    it("uses metadata map to match comments by translationKey when remoteContext is provided", async () => {
      // Local file has defaultRemote's ID (id: 50) but the non-default remote has id: 500
      await writeCommentFile("content/110.json", [
        {
          id: 50, // default remote's ID
          translationKey: "tk-match-1",
          authorName: "Test Author",
          body: "Updated locally",
          status: "Approved",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
          commentableId: 110,
          commentableType: "Content",
          language: "en",
        },
      ]);

      // Remote returns the non-default remote's comment with id: 500
      mockedPullCommentSync.mockResolvedValue({
        items: [
          {
            id: 500,
            translationKey: "tk-match-1",
            authorName: "Test Author",
            body: "Remote body - same",
            status: "Approved",
            createdAt: "2024-01-01T00:00:00Z",
            updatedAt: "2024-01-02T00:00:00Z",
            commentableId: 110,
            commentableType: "Content",
            language: "en",
          },
        ],
        deleted: [],
        nextSyncToken: "sync-meta-1",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      // Mock the remote-context module to provide a metadata map
      const metaStateDir = path.join(tmpRoot, ".leadcms", "remotes", "develop");
      await fs.mkdir(metaStateDir, { recursive: true });
      await fs.writeFile(
        path.join(metaStateDir, "metadata.json"),
        JSON.stringify({
          content: {},
          emailTemplates: {},
          comments: {
            en: {
              "tk-match-1": {
                id: 500,
                createdAt: "2024-01-01T00:00:00Z",
                updatedAt: "2024-01-02T00:00:00Z",
              },
            },
          },
        })
      );

      const remoteContext = {
        name: "develop",
        url: "https://dev.example.com",
        apiKey: "dev-key",
        isDefault: false,
        stateDir: metaStateDir,
      };

      const result = await buildCommentStatus({ remoteContext });

      // Should match via metadata map (translationKey) → finds the update, not a create
      const creates = result.operations.filter((op) => op.type === "create");
      const updates = result.operations.filter((op) => op.type === "update");
      expect(creates).toHaveLength(0);
      // The body differs so it should be an update
      expect(updates).toHaveLength(1);
    });

    it("falls back to translationKey matching against remote when no metadata entry exists", async () => {
      await writeCommentFile("content/110.json", [
        {
          // No id — brand new locally but has translationKey
          translationKey: "tk-new-remote",
          authorName: "New Author",
          body: "Local body",
          status: "Approved",
          commentableId: 110,
          commentableType: "Content",
          language: "en",
        },
      ]);

      // Remote happens to have a comment with the same translationKey
      mockedPullCommentSync.mockResolvedValue({
        items: [
          {
            id: 700,
            translationKey: "tk-new-remote",
            authorName: "New Author",
            body: "Remote body different",
            status: "Approved",
            createdAt: "2024-01-01T00:00:00Z",
            updatedAt: "2024-01-02T00:00:00Z",
            commentableId: 110,
            commentableType: "Content",
            language: "en",
          },
        ],
        deleted: [],
        nextSyncToken: "sync-tk-1",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const result = await buildCommentStatus({});

      // Should match via translationKey fallback → update, not create
      const creates = result.operations.filter((op) => op.type === "create");
      const updates = result.operations.filter((op) => op.type === "update");
      expect(creates).toHaveLength(0);
      expect(updates).toHaveLength(1);
    });

    it("uses metadata map timestamps for conflict detection", async () => {
      await writeCommentFile("content/110.json", [
        {
          id: 60,
          translationKey: "tk-conflict",
          authorName: "Author",
          body: "Local edit",
          status: "Approved",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-05T00:00:00Z", // Default remote's timestamp
          commentableId: 110,
          commentableType: "Content",
          language: "en",
        },
      ]);

      // Remote has newer updatedAt than what's in the metadata map
      mockedPullCommentSync.mockResolvedValue({
        items: [
          {
            id: 600,
            translationKey: "tk-conflict",
            authorName: "Author",
            body: "Remote changed body",
            status: "Approved",
            createdAt: "2024-01-01T00:00:00Z",
            updatedAt: "2024-03-01T00:00:00Z", // Newer than metadata map
            commentableId: 110,
            commentableType: "Content",
            language: "en",
          },
        ],
        deleted: [],
        nextSyncToken: "sync-conflict-1",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const metaStateDir = path.join(tmpRoot, ".leadcms", "remotes", "staging");
      await fs.mkdir(metaStateDir, { recursive: true });
      await fs.writeFile(
        path.join(metaStateDir, "metadata.json"),
        JSON.stringify({
          content: {},
          emailTemplates: {},
          comments: {
            en: {
              "tk-conflict": {
                id: 600,
                createdAt: "2024-01-01T00:00:00Z",
                updatedAt: "2024-02-01T00:00:00Z",
              },
            },
          },
        })
      );

      const remoteContext = {
        name: "staging",
        url: "https://staging.example.com",
        apiKey: "staging-key",
        isDefault: false,
        stateDir: metaStateDir,
      };

      const result = await buildCommentStatus({ remoteContext });

      // Remote updatedAt (2024-03) > metadata map updatedAt (2024-02) → conflict
      const conflicts = result.operations.filter((op) => op.type === "conflict");
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].reason).toContain("Remote comment changed after the last pull");
    });
  });

  it("passes remoteContext to pullLeadCMSComments during post-push refresh", async () => {
    await writeCommentFile("content/110.json", [
      {
        parentId: null,
        authorName: "Test Author",
        authorEmail: "test@example.com",
        body: "Brand new comment",
        status: "Approved",
      },
    ]);

    dataServiceMock.createComment.mockResolvedValue({
      id: 2000,
      parentId: null,
      authorName: "Test Author",
      body: "Brand new comment",
      status: "Approved",
      createdAt: "2024-06-01T00:00:00Z",
      updatedAt: "2024-06-01T00:00:00Z",
      commentableId: 110,
      commentableType: "Content",
      language: "en",
    });

    const remoteContext = {
      name: "prod",
      url: "https://prod.example.com",
      apiKey: "prod-key",
      isDefault: true,
      stateDir: path.join(tmpRoot, ".leadcms", "remotes", "prod"),
    };

    await pushComments({ remoteContext });

    expect(mockedPullLeadCMSComments).toHaveBeenCalledTimes(1);
    expect(mockedPullLeadCMSComments).toHaveBeenCalledWith(remoteContext);
  });

  it("supports updating parentId for comments", async () => {
    // Create a local comment that changes the parentId from 100 to 200
    await writeCommentFile("content/110.json", [
      {
        id: 50,
        parentId: 200, // Different from remote
        authorName: "Test Author",
        authorEmail: "test@example.com",
        body: "Comment body",
        status: "Approved",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T12:00:00Z",
        commentableId: 110,
        commentableType: "Content",
        language: "en",
      },
    ]);

    // Mock remote comment with different parentId
    mockedPullCommentSync.mockResolvedValue({
      items: [
        {
          id: 50,
          parentId: 100, // Original parentId
          authorName: "Test Author",
          authorEmail: "test@example.com",
          body: "Comment body",
          status: "Approved",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z", // Older than local
          commentableId: 110,
          commentableType: "Content",
          language: "en",
        },
      ],
      deleted: [],
      nextSyncToken: "sync-parentid-test",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    dataServiceMock.updateComment.mockResolvedValue({
      id: 50,
      parentId: 200,
      authorName: "Test Author",
      authorEmail: "test@example.com",
      body: "Comment body",
      status: "Approved",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T12:00:00Z",
      commentableId: 110,
      commentableType: "Content",
      language: "en",
    });

    await pushComments();

    // Verify that updateComment was called with parentId included
    expect(dataServiceMock.updateComment).toHaveBeenCalledTimes(1);
    expect(dataServiceMock.updateComment).toHaveBeenCalledWith(
      50,
      expect.objectContaining({
        parentId: 200,
      })
    );

    // Verify that the update was performed (not treated as a conflict)
    const result = await buildCommentStatus();
    const updates = result.operations.filter((op) => op.type === "update");
    expect(updates).toHaveLength(1);
  });

  it("allows pushing updates when local commentableId differs from remote (file relocation scenario)", async () => {
    // Scenario: user moved a comment's file from content/110.json to content/162.json
    // (by renaming the file) and also updated parentId to reparent the comment thread.
    // On LeadCMS >= 1.5.16-pre the API accepts both parentId and commentableId in
    // the update, so the SDK should push both so the server reparents the comment.
    await writeCommentFile("content/162.json", [
      {
        id: 864,
        parentId: 900, // Changed locally to new parent comment
        authorName: "Test Author",
        authorEmail: "test@example.com",
        body: "Reparented comment",
        status: "Approved",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-02T00:00:00Z",
        commentableId: 162, // New location (derived from filename)
        commentableType: "Content",
        language: "ru-RU",
      },
    ]);

    mockedPullCommentSync.mockResolvedValue({
      items: [
        {
          id: 864,
          parentId: 800, // Old parent
          authorName: "Test Author",
          authorEmail: "test@example.com",
          body: "Reparented comment",
          status: "Approved",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
          commentableId: 110, // Still at old location on remote
          commentableType: "Content",
          language: "ru-RU",
        },
      ],
      deleted: [],
      nextSyncToken: "sync-reparent",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    dataServiceMock.updateComment.mockResolvedValue({
      id: 864,
      parentId: 900,
      authorName: "Test Author",
      authorEmail: "test@example.com",
      body: "Reparented comment",
      status: "Approved",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-02-01T00:00:00Z",
      commentableId: 162,
      commentableType: "Content",
      language: "ru-RU",
    });

    // buildCommentStatus should treat this as an update, not a conflict
    const statusResult = await buildCommentStatus();
    const conflicts = statusResult.operations.filter((op) => op.type === "conflict");
    const updates = statusResult.operations.filter((op) => op.type === "update");
    expect(conflicts).toHaveLength(0);
    expect(updates).toHaveLength(1);

    await pushComments();

    // Payload must include both parentId and commentableId so the server can
    // reparent the comment (LeadCMS >= 1.5.16-pre).
    expect(dataServiceMock.updateComment).toHaveBeenCalledTimes(1);
    const [calledId, payload] = dataServiceMock.updateComment.mock.calls[0];
    expect(calledId).toBe(864);
    expect(payload.parentId).toBe(900);
    expect(payload.commentableId).toBe(162);
    // commentableType is not part of CommentUpdateDto and must not be sent
    expect(payload).not.toHaveProperty("commentableType");
  });

  it("warns and strips parentId/commentableId on older servers that do not support reparenting", async () => {
    // Older LeadCMS (< 1.5.16-pre) does not accept parentId/commentableId in
    // update payloads. The SDK must not attempt to send those fields and must
    // surface a warning so the user knows their reparent change won't sync.
    dataServiceMock.getServerVersion.mockResolvedValue("1.5.15-pre");

    await writeCommentFile("content/162.json", [
      {
        id: 864,
        parentId: 900,
        authorName: "Test Author",
        authorEmail: "test@example.com",
        body: "Body edited locally",
        status: "Approved",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-02T00:00:00Z",
        commentableId: 162,
        commentableType: "Content",
        language: "ru-RU",
      },
    ]);

    mockedPullCommentSync.mockResolvedValue({
      items: [
        {
          id: 864,
          parentId: 800,
          authorName: "Test Author",
          authorEmail: "test@example.com",
          body: "Original body",
          status: "Approved",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
          commentableId: 110,
          commentableType: "Content",
          language: "ru-RU",
        },
      ],
      deleted: [],
      nextSyncToken: "sync-legacy",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    dataServiceMock.updateComment.mockResolvedValue({
      id: 864,
      parentId: 800,
      authorName: "Test Author",
      authorEmail: "test@example.com",
      body: "Body edited locally",
      status: "Approved",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-02-01T00:00:00Z",
      commentableId: 110,
      commentableType: "Content",
      language: "ru-RU",
    });

    const warnings: string[] = [];
    const originalWarn = console.warn;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    console.warn = (...args: any[]) => {
      warnings.push(String(args[0]));
    };

    try {
      await pushComments();
    } finally {
      console.warn = originalWarn;
    }

    expect(dataServiceMock.updateComment).toHaveBeenCalledTimes(1);
    const [calledId, payload] = dataServiceMock.updateComment.mock.calls[0];
    expect(calledId).toBe(864);
    // Editable fields still pushed
    expect(payload.body).toBe("Body edited locally");
    // Reparenting fields stripped on older servers
    expect(payload).not.toHaveProperty("parentId");
    expect(payload).not.toHaveProperty("commentableId");

    expect(warnings.some((msg) => msg.includes("1.5.16-pre") && msg.includes("864"))).toBe(true);
  });

  it("continues processing after a 404 from createComment and reports the failure", async () => {
    // Two new local comments targeting different content items. The first target
    // (Content #263) no longer exists on the server so createComment rejects
    // with a 404 ProblemDetails response. The second comment must still be
    // created and the overall push must not throw.
    await writeCommentFile("content/263.json", [
      {
        parentId: 823,
        authorName: "Peter Liapin",
        authorEmail: "peter@xltools.net",
        body: "Orphan comment on missing content",
        status: "Approved",
        commentableId: 263,
        commentableType: "Content",
        language: "en-US",
      },
    ]);
    await writeCommentFile("content/20.json", [
      {
        parentId: 819,
        authorName: "Peter Liapin",
        authorEmail: "peter@xltools.net",
        body: "Healthy comment on existing content",
        status: "Approved",
        commentableId: 20,
        commentableType: "Content",
        language: "en-US",
      },
    ]);

    mockedPullCommentSync.mockResolvedValue({
      items: [],
      deleted: [],
      nextSyncToken: "sync-404",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const notFoundError: any = new Error("Request failed with status code 404");
    notFoundError.response = {
      status: 404,
      data: {
        type: "https://tools.ietf.org/html/rfc9110#section-15.5.5",
        title: "Not Found",
        status: 404,
        entityType: "Content",
        entityUid: "263",
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dataServiceMock.createComment.mockImplementation(async (payload: any) => {
      if (payload.commentableId === 263) {
        throw notFoundError;
      }
      return {
        id: 9999,
        parentId: payload.parentId,
        authorName: payload.authorName,
        authorEmail: payload.authorEmail,
        body: payload.body,
        status: payload.status,
        createdAt: "2026-04-23T12:00:00Z",
        updatedAt: null,
        commentableId: payload.commentableId,
        commentableType: payload.commentableType,
        language: payload.language,
        translationKey: "comment_content_20_new",
      };
    });

    const warnings: string[] = [];
    const errors: string[] = [];
    const originalWarn = console.warn;
    const originalError = console.error;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    console.warn = (...args: any[]) => {
      warnings.push(String(args[0]));
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    console.error = (...args: any[]) => {
      errors.push(String(args[0]));
    };

    try {
      await expect(pushComments()).resolves.toBeUndefined();
    } finally {
      console.warn = originalWarn;
      console.error = originalError;
    }

    // Both creates were attempted
    expect(dataServiceMock.createComment).toHaveBeenCalledTimes(2);

    // 404 target produced a warning mentioning the missing entity
    expect(warnings.some((msg) => msg.includes("Content #263") && msg.includes("404"))).toBe(true);

    // Summary warning at the end
    expect(warnings.some((msg) => /1 comment operation[s]? failed/i.test(msg))).toBe(true);

    // No uncaught errors logged that would indicate a crash
    expect(errors).toEqual([]);

    // Post-push refresh still ran because at least one create succeeded
    expect(mockedPullLeadCMSComments).toHaveBeenCalledTimes(1);
  });
});
