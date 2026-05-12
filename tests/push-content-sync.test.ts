import type { ContentOperations } from "../src/scripts/push-leadcms-content";
import fs from "fs/promises";
import os from "os";
import path from "path";
import matter from "gray-matter";

describe("content push post-push sync", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does not pull content or media after a successful push when syncAfterPush=false", async () => {
    const deleteContent = jest.fn().mockResolvedValue(undefined);
    const pullLeadCMSContent = jest.fn().mockResolvedValue(undefined);
    const pullLeadCMSMedia = jest.fn().mockResolvedValue(undefined);

    jest.unstable_mockModule("../src/lib/data-service.js", () => ({
      leadCMSDataService: {
        deleteContent,
      },
    }));

    jest.unstable_mockModule("../src/scripts/pull-leadcms-content.js", () => ({
      pullLeadCMSContent,
    }));

    jest.unstable_mockModule("../src/scripts/pull-leadcms-media.js", () => ({
      pullLeadCMSMedia,
    }));

    const consoleLog = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const { executePush } = await import("../src/scripts/push-leadcms-content.js");

    const operations: ContentOperations = {
      create: [],
      update: [],
      rename: [],
      typeChange: [],
      conflict: [],
      delete: [
        {
          local: {
            filePath: "/tmp/delete-me.mdx",
            slug: "delete-me",
            locale: "en",
            type: "post",
            metadata: { type: "post" },
            body: "# Delete Me",
            isLocal: true,
          },
          remote: {
            id: 2,
            slug: "delete-me",
            type: "post",
            title: "Delete Me",
            description: "Delete Me",
            body: "# Delete Me",
            author: "Test",
            language: "en",
            updatedAt: "2024-01-01T00:00:00Z",
            isLocal: false,
          },
        },
      ],
      remoteDeleted: [],
      remoteCreated: [],
    };

    const result = await executePush(operations, { syncAfterPush: false, quiet: true });

    expect(result).toEqual({ successful: 1, failed: 0 });
    // Per-record success lines always show regardless of quiet mode (quiet suppresses section
    // headers and aggregate results only, not individual progress lines)
    expect(pullLeadCMSContent).not.toHaveBeenCalled();
    expect(pullLeadCMSMedia).not.toHaveBeenCalled();

    consoleLog.mockRestore();
  });

  it("refreshes pushed local content from the API response without pulling all content", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "leadcms-push-sync-"));
    const filePath = path.join(tempDir, "response-sync.mdx");
    await fs.writeFile(
      filePath,
      matter.stringify("# Local body", {
        title: "Response Sync",
        type: "post",
        slug: "response-sync",
      }),
      "utf-8"
    );

    const { leadCMSDataService } = await import("../src/lib/data-service.js");
    const createContent = jest.spyOn(leadCMSDataService, "createContent").mockResolvedValue({
      id: 7,
      slug: "response-sync",
      type: "post",
      title: "Response Sync",
      body: "# Server body",
      author: "Test",
      language: "en",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-06-15T12:00:00Z",
    });
    const pullLeadCMSContent = jest.fn().mockResolvedValue(undefined);
    const pullLeadCMSMedia = jest.fn().mockResolvedValue(undefined);

    jest.unstable_mockModule("../src/scripts/pull-leadcms-content.js", () => ({
      pullLeadCMSContent,
    }));

    jest.unstable_mockModule("../src/scripts/pull-leadcms-media.js", () => ({
      pullLeadCMSMedia,
    }));

    const { executePush } = await import("../src/scripts/push-leadcms-content.js");

    const operations: ContentOperations = {
      create: [
        {
          local: {
            filePath,
            slug: "response-sync",
            locale: "en",
            type: "post",
            metadata: { type: "post", title: "Response Sync" },
            body: "# Local body",
            isLocal: true,
          },
          remote: undefined,
        },
      ],
      update: [],
      rename: [],
      typeChange: [],
      conflict: [],
      delete: [],
      remoteDeleted: [],
      remoteCreated: [],
    };

    const result = await executePush(operations, { quiet: true });

    expect(result).toEqual({ successful: 1, failed: 0 });
    expect(createContent).toHaveBeenCalledTimes(1);
    expect(pullLeadCMSContent).not.toHaveBeenCalled();
    expect(pullLeadCMSMedia).not.toHaveBeenCalled();

    const synced = matter(await fs.readFile(filePath, "utf-8"));
    expect(synced.data.id).toBe(7);
    expect(synced.data.updatedAt).toBe("2024-06-15T12:00:00Z");
    expect(synced.content.trim()).toBe("# Server body");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Bug regression: updateLocalMetadata must update stale slug in frontmatter
// even for non-default remotes (Bug 2 - rename loops on status).
// ────────────────────────────────────────────────────────────────────────────
describe("updateLocalMetadata - non-default remote slug fix (Bug 2)", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("updates stale slug in frontmatter for non-default remote after rename push", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "leadcms-slug-fix-"));
    const filePath = path.join(tempDir, "new-slug.mdx");
    // File has old slug in frontmatter (was written by a previous default-remote pull
    // before the user renamed checklists.mdx → checklists-23333.mdx)
    await fs.writeFile(
      filePath,
      matter.stringify("# Article body", {
        id: 130,
        slug: "old-slug",
        type: "post",
        title: "Renamed Article",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      }),
      "utf-8"
    );

    // Mock remote-context to avoid real metadata-map I/O
    jest.unstable_mockModule("../src/lib/remote-context.js", () => ({
      readMetadataMap: jest.fn().mockResolvedValue({
        content: {},
        emailTemplates: {},
        comments: {},
        segments: {},
        sequences: {},
      }),
      setRemoteId: jest.fn(),
      setMetadataForContent: jest.fn(),
      writeMetadataMap: jest.fn().mockResolvedValue(undefined),
    }));

    const { updateLocalMetadata } = await import("../src/scripts/push-leadcms-content.js");

    const localContent = {
      filePath,
      slug: "new-slug", // derived from renamed file
      locale: "en",
      type: "post",
      metadata: { id: 130, type: "post", title: "Renamed Article", slug: "old-slug" },
      body: "# Article body",
      isLocal: true,
    };

    const remoteResponse = {
      id: 130,
      slug: "new-slug", // server confirmed the rename
      type: "post",
      title: "Renamed Article",
      body: "# Article body",
      author: "Test",
      language: "en",
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-06-15T00:00:00Z",
    };

    const remoteCtx = {
      name: "develop",
      url: "https://dev.leadcms.com",
      isDefault: false,
      stateDir: tempDir,
    };

    await updateLocalMetadata(localContent as never, remoteResponse as never, remoteCtx);

    const updated = matter(await fs.readFile(filePath, "utf-8"));
    // Slug must be updated to prevent repeated rename detection on next status check
    expect(updated.data.slug).toBe("new-slug");
    // Other frontmatter fields (id, title, body) must be preserved unchanged
    expect(updated.data.id).toBe(130);
    expect(updated.data.title).toBe("Renamed Article");
    expect(updated.content.trim()).toBe("# Article body");
  });

  it("does not modify frontmatter when slug is already correct for non-default remote", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "leadcms-slug-fix2-"));
    const filePath = path.join(tempDir, "correct-slug.mdx");
    await fs.writeFile(
      filePath,
      matter.stringify("# Body", { id: 5, slug: "correct-slug", type: "post" }),
      "utf-8"
    );

    jest.unstable_mockModule("../src/lib/remote-context.js", () => ({
      readMetadataMap: jest.fn().mockResolvedValue({
        content: {},
        emailTemplates: {},
        comments: {},
        segments: {},
        sequences: {},
      }),
      setRemoteId: jest.fn(),
      setMetadataForContent: jest.fn(),
      writeMetadataMap: jest.fn().mockResolvedValue(undefined),
    }));

    const { updateLocalMetadata } = await import("../src/scripts/push-leadcms-content.js");

    const localContent = {
      filePath,
      slug: "correct-slug",
      locale: "en",
      type: "post",
      metadata: { id: 5, type: "post", slug: "correct-slug" },
      body: "# Body",
      isLocal: true,
    };

    const remoteResponse = {
      id: 5,
      slug: "correct-slug",
      type: "post",
      title: "Test",
      body: "# Body",
      author: "Test",
      language: "en",
      updatedAt: "2024-06-15T00:00:00Z",
    };

    const remoteCtx = {
      name: "develop",
      url: "https://dev.leadcms.com",
      isDefault: false,
      stateDir: tempDir,
    };

    const statBefore = await fs.stat(filePath);
    await updateLocalMetadata(localContent as never, remoteResponse as never, remoteCtx);
    const statAfter = await fs.stat(filePath);

    // File should not be rewritten when slug is already correct
    expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
  });
});
