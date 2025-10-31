/**
 * Tests for Comments Feature
 * Following TDD principles with comprehensive coverage
 */

import fs from "fs";
import path from "path";
import {
  getComments,
  getCommentsForContent,
  getCommentsStrict,
  getCommentsForContentStrict,
} from "../src/lib/cms.js";
import type {
  Comment,
  StoredComment,
  CommentsByEntity,
} from "../src/lib/comment-types.js";

const TEST_COMMENTS_DIR = path.resolve(".leadcms-test/comments");

// Helper functions for testing (mirroring the script functions)
function toStoredComment(comment: Comment): StoredComment {
  const { content, parent, contact, ...stored } = comment;
  return stored;
}

function groupCommentsByEntity(comments: Comment[]): Map<string, Comment[]> {
  const grouped = new Map<string, Comment[]>();

  for (const comment of comments) {
    const key = `${comment.commentableType}/${comment.commentableId}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push(comment);
  }

  return grouped;
}

async function loadCommentsForEntity(
  commentableType: string,
  commentableId: number,
  language: string = "en"
): Promise<StoredComment[]> {
  // Default language at root, others in language subdirs
  const typeLower = commentableType.toLowerCase();
  const filePath = language === "en"
    ? path.join(TEST_COMMENTS_DIR, typeLower, `${commentableId}.json`)
    : path.join(TEST_COMMENTS_DIR, language, typeLower, `${commentableId}.json`);

  try {
    const content = await fs.promises.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch {
    return [];
  }
}

async function saveCommentsForEntity(
  commentableType: string,
  commentableId: number,
  comments: StoredComment[],
  language: string = "en"
): Promise<void> {
  // Default language at root, others in language subdirs
  const typeLower = commentableType.toLowerCase();
  const dirPath = language === "en"
    ? path.join(TEST_COMMENTS_DIR, typeLower)
    : path.join(TEST_COMMENTS_DIR, language, typeLower);

  await fs.promises.mkdir(dirPath, { recursive: true });

  const filePath = path.join(dirPath, `${commentableId}.json`);

  if (comments.length === 0) {
    try {
      await fs.promises.unlink(filePath);
    } catch {}
  } else {
    const sortedComments = [...comments].sort((a, b) => {
      const dateCompare = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      if (dateCompare !== 0) return dateCompare;
      return a.id - b.id;
    });

    await fs.promises.writeFile(filePath, JSON.stringify(sortedComments, null, 2), "utf8");
  }
}

async function deleteComment(commentId: number): Promise<void> {
  try {
    const topLevelItems = await fs.promises.readdir(TEST_COMMENTS_DIR);

    for (const item of topLevelItems) {
      const itemPath = path.join(TEST_COMMENTS_DIR, item);
      const stat = await fs.promises.stat(itemPath);

      if (!stat.isDirectory()) continue;

      // Check if this is a language subdirectory or commentable type
      // Simple check: if lowercase and 2-5 chars, likely a language code
      const isLangDir = /^[a-z]{2,5}(-[a-z]{2,5})?$/i.test(item);

      if (isLangDir) {
        // This is a language subdirectory, look for commentable types inside
        const commentableTypes = await fs.promises.readdir(itemPath);

        for (const commentableType of commentableTypes) {
          const typePath = path.join(itemPath, commentableType);
          const typeStat = await fs.promises.stat(typePath);

          if (!typeStat.isDirectory()) continue;

          await searchAndDeleteInTypeDirectory(typePath, commentableType, item, commentId);
        }
      } else {
        // This is a commentable type at root level (default language)
        await searchAndDeleteInTypeDirectory(itemPath, item, "en", commentId);
      }
    }
  } catch (error: any) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

async function searchAndDeleteInTypeDirectory(
  typePath: string,
  commentableType: string,
  language: string,
  commentId: number
): Promise<void> {
  const files = await fs.promises.readdir(typePath);

  for (const file of files) {
    if (!file.endsWith(".json")) continue;

    const commentableId = parseInt(file.replace(".json", ""), 10);
    if (isNaN(commentableId)) continue;

    const comments = await loadCommentsForEntity(commentableType, commentableId, language);
    const originalLength = comments.length;
    const filtered = comments.filter((c) => c.id !== commentId);

    if (filtered.length < originalLength) {
      await saveCommentsForEntity(commentableType, commentableId, filtered, language);
      return;
    }
  }
}

// Mock configuration for tests
jest.mock("../src/lib/config.js", () => ({
  getConfig: jest.fn(() => ({
    url: "https://test.leadcms.com",
    apiKey: "test-api-key",
    defaultLanguage: "en",
    contentDir: ".leadcms-test/content",
    mediaDir: ".leadcms-test/media",
    commentsDir: ".leadcms-test/comments",
    enableDrafts: false,
  })),
}));

describe("Comments Feature", () => {
  beforeEach(async () => {
    // Clean up test directory before each test
    if (fs.existsSync(TEST_COMMENTS_DIR)) {
      fs.rmSync(TEST_COMMENTS_DIR, { recursive: true, force: true });
    }
  });

  afterEach(async () => {
    // Clean up test directory after each test
    if (fs.existsSync(TEST_COMMENTS_DIR)) {
      fs.rmSync(TEST_COMMENTS_DIR, { recursive: true, force: true });
    }
  });

  describe("Comment Type Conversion", () => {
    it("should convert Comment to StoredComment by removing nested objects", () => {
      const comment: Comment = {
        id: 1,
        parentId: null,
        authorName: "John Doe",
        authorEmail: "john@example.com",
        body: "Test comment",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-02T00:00:00Z",
        commentableId: 20,
        commentableType: "Content",
        avatarUrl: "https://example.com/avatar.jpg",
        language: "en-US",
        translationKey: null,
        contactId: 5,
        source: "web",
        tags: ["test"],
        content: { id: 20, slug: "test-content" }, // Should be removed
        parent: null, // Should be removed
        contact: { id: 5, name: "John" }, // Should be removed
      };

      const stored = toStoredComment(comment);

      expect(stored).toEqual({
        id: 1,
        parentId: null,
        authorName: "John Doe",
        authorEmail: "john@example.com",
        body: "Test comment",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-02T00:00:00Z",
        commentableId: 20,
        commentableType: "Content",
        avatarUrl: "https://example.com/avatar.jpg",
        language: "en-US",
        translationKey: null,
        contactId: 5,
        source: "web",
        tags: ["test"],
      });

      expect(stored).not.toHaveProperty("content");
      expect(stored).not.toHaveProperty("parent");
      expect(stored).not.toHaveProperty("contact");
    });
  });

  describe("Comment Grouping", () => {
    it("should group comments by commentableType and commentableId", () => {
      const comments: Comment[] = [
        {
          id: 1,
          parentId: null,
          authorName: "User 1",
          body: "Comment 1",
          createdAt: "2024-01-01T00:00:00Z",
          commentableId: 10,
          commentableType: "Content",
          language: "en-US",
        },
        {
          id: 2,
          parentId: null,
          authorName: "User 2",
          body: "Comment 2",
          createdAt: "2024-01-02T00:00:00Z",
          commentableId: 10,
          commentableType: "Content",
          language: "en-US",
        },
        {
          id: 3,
          parentId: null,
          authorName: "User 3",
          body: "Comment 3",
          createdAt: "2024-01-03T00:00:00Z",
          commentableId: 20,
          commentableType: "Content",
          language: "en-US",
        },
        {
          id: 4,
          parentId: null,
          authorName: "User 4",
          body: "Comment 4",
          createdAt: "2024-01-04T00:00:00Z",
          commentableId: 5,
          commentableType: "Contact",
          language: "en-US",
        },
      ];

      const grouped = groupCommentsByEntity(comments);

      expect(grouped.size).toBe(3);
      expect(grouped.get("Content/10")).toHaveLength(2);
      expect(grouped.get("Content/20")).toHaveLength(1);
      expect(grouped.get("Contact/5")).toHaveLength(1);
    });

    it("should handle empty comment array", () => {
      const grouped = groupCommentsByEntity([]);
      expect(grouped.size).toBe(0);
    });
  });

  describe("Comment Storage", () => {
    it("should save comments to correct directory structure", async () => {
      const comments: StoredComment[] = [
        {
          id: 1,
          parentId: null,
          authorName: "Test User",
          body: "Test comment",
          createdAt: "2024-01-01T00:00:00Z",
          commentableId: 10,
          commentableType: "Content",
          language: "en-US",
        },
      ];

      await saveCommentsForEntity("Content", 10, comments);

      const filePath = path.join(TEST_COMMENTS_DIR, "Content", "10.json");
      expect(fs.existsSync(filePath)).toBe(true);

      const saved = JSON.parse(fs.readFileSync(filePath, "utf8"));
      expect(saved).toHaveLength(1);
      expect(saved[0].id).toBe(1);
    });

    it("should sort comments by createdAt and id", async () => {
      const comments: StoredComment[] = [
        {
          id: 3,
          parentId: null,
          authorName: "User 3",
          body: "Comment 3",
          createdAt: "2024-01-03T00:00:00Z",
          commentableId: 10,
          commentableType: "Content",
          language: "en-US",
        },
        {
          id: 1,
          parentId: null,
          authorName: "User 1",
          body: "Comment 1",
          createdAt: "2024-01-01T00:00:00Z",
          commentableId: 10,
          commentableType: "Content",
          language: "en-US",
        },
        {
          id: 2,
          parentId: null,
          authorName: "User 2",
          body: "Comment 2",
          createdAt: "2024-01-02T00:00:00Z",
          commentableId: 10,
          commentableType: "Content",
          language: "en-US",
        },
      ];

      await saveCommentsForEntity("Content", 10, comments);

      const filePath = path.join(TEST_COMMENTS_DIR, "Content", "10.json");
      const saved = JSON.parse(fs.readFileSync(filePath, "utf8"));

      expect(saved[0].id).toBe(1);
      expect(saved[1].id).toBe(2);
      expect(saved[2].id).toBe(3);
    });

    it("should remove file when saving empty comments array", async () => {
      // First, create a file
      await saveCommentsForEntity("Content", 10, [
        {
          id: 1,
          parentId: null,
          authorName: "Test",
          body: "Test",
          createdAt: "2024-01-01T00:00:00Z",
          commentableId: 10,
          commentableType: "Content",
          language: "en-US",
        },
      ]);

      const filePath = path.join(TEST_COMMENTS_DIR, "Content", "10.json");
      expect(fs.existsSync(filePath)).toBe(true);

      // Now save empty array
      await saveCommentsForEntity("Content", 10, []);
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it("should load existing comments from file", async () => {
      const comments: StoredComment[] = [
        {
          id: 1,
          parentId: null,
          authorName: "Test",
          body: "Test",
          createdAt: "2024-01-01T00:00:00Z",
          commentableId: 10,
          commentableType: "Content",
          language: "en-US",
        },
      ];

      await saveCommentsForEntity("Content", 10, comments);
      const loaded = await loadCommentsForEntity("Content", 10);

      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe(1);
      expect(loaded[0].authorName).toBe("Test");
    });

    it("should return empty array for non-existent file", async () => {
      const loaded = await loadCommentsForEntity("Content", 999);
      expect(loaded).toEqual([]);
    });
  });

  describe("Comment Deletion", () => {
    it("should delete comment by ID", async () => {
      const comments: StoredComment[] = [
        {
          id: 1,
          parentId: null,
          authorName: "User 1",
          body: "Comment 1",
          createdAt: "2024-01-01T00:00:00Z",
          commentableId: 10,
          commentableType: "Content",
          language: "en-US",
        },
        {
          id: 2,
          parentId: null,
          authorName: "User 2",
          body: "Comment 2",
          createdAt: "2024-01-02T00:00:00Z",
          commentableId: 10,
          commentableType: "Content",
          language: "en-US",
        },
      ];

      await saveCommentsForEntity("Content", 10, comments);
      await deleteComment(1);

      const remaining = await loadCommentsForEntity("Content", 10);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(2);
    });

    it("should handle deletion of non-existent comment", async () => {
      // Should not throw
      await expect(deleteComment(999)).resolves.not.toThrow();
    });

    it("should remove file if last comment is deleted", async () => {
      const comments: StoredComment[] = [
        {
          id: 1,
          parentId: null,
          authorName: "Test",
          body: "Test",
          createdAt: "2024-01-01T00:00:00Z",
          commentableId: 10,
          commentableType: "Content",
          language: "en-US",
        },
      ];

      await saveCommentsForEntity("Content", 10, comments);
      await deleteComment(1);

      const filePath = path.join(TEST_COMMENTS_DIR, "Content", "10.json");
      expect(fs.existsSync(filePath)).toBe(false);
    });
  });

  describe("Public API - getComments", () => {
    beforeEach(async () => {
      // Create test data
      const comments: StoredComment[] = [
        {
          id: 1,
          parentId: null,
          authorName: "Test User",
          body: "Test comment",
          createdAt: "2024-01-01T00:00:00Z",
          commentableId: 10,
          commentableType: "Content",
          language: "en-US",
        },
      ];

      await saveCommentsForEntity("Content", 10, comments);
    });

    it("should retrieve comments for entity", () => {
      const comments = getComments("Content", 10);
      expect(comments).toHaveLength(1);
      expect(comments[0].id).toBe(1);
    });

    it("should return empty array for non-existent entity", () => {
      const comments = getComments("Content", 999);
      expect(comments).toEqual([]);
    });

    it("should return empty array for invalid data", () => {
      // Create invalid JSON file
      const dirPath = path.join(TEST_COMMENTS_DIR, "Content");
      fs.mkdirSync(dirPath, { recursive: true });
      fs.writeFileSync(path.join(dirPath, "20.json"), "invalid json");

      const comments = getComments("Content", 20);
      expect(comments).toEqual([]);
    });
  });

  describe("Public API - getCommentsForContent", () => {
    beforeEach(async () => {
      const comments: StoredComment[] = [
        {
          id: 1,
          parentId: null,
          authorName: "Test User",
          body: "Content comment",
          createdAt: "2024-01-01T00:00:00Z",
          commentableId: 15,
          commentableType: "Content",
          language: "en-US",
        },
      ];

      await saveCommentsForEntity("Content", 15, comments);
    });

    it("should retrieve comments for content", () => {
      const comments = getCommentsForContent(15);
      expect(comments).toHaveLength(1);
      expect(comments[0].body).toBe("Content comment");
    });

    it("should return empty array for content without comments", () => {
      const comments = getCommentsForContent(999);
      expect(comments).toEqual([]);
    });
  });

  describe("Public API - getCommentsStrict", () => {
    beforeEach(async () => {
      const comments: StoredComment[] = [
        {
          id: 1,
          parentId: null,
          authorName: "Test User",
          body: "Test comment",
          createdAt: "2024-01-01T00:00:00Z",
          commentableId: 10,
          commentableType: "Content",
          language: "en-US",
        },
      ];

      await saveCommentsForEntity("Content", 10, comments);
    });

    it("should retrieve comments for entity", () => {
      const comments = getCommentsStrict("Content", 10);
      expect(comments).toHaveLength(1);
      expect(comments[0].id).toBe(1);
    });

    it("should throw error for non-existent entity", () => {
      expect(() => getCommentsStrict("Content", 999)).toThrow(
        /Comments file not found/
      );
    });

    it("should throw error for invalid JSON", () => {
      // Create invalid JSON file
      const dirPath = path.join(TEST_COMMENTS_DIR, "Content");
      fs.mkdirSync(dirPath, { recursive: true });
      fs.writeFileSync(path.join(dirPath, "20.json"), "invalid json");

      expect(() => getCommentsStrict("Content", 20)).toThrow(
        /Failed to read or parse/
      );
    });
  });

  describe("Public API - getCommentsForContentStrict", () => {
    beforeEach(async () => {
      const comments: StoredComment[] = [
        {
          id: 1,
          parentId: null,
          authorName: "Test User",
          body: "Content comment",
          createdAt: "2024-01-01T00:00:00Z",
          commentableId: 15,
          commentableType: "Content",
          language: "en-US",
        },
      ];

      await saveCommentsForEntity("Content", 15, comments);
    });

    it("should retrieve comments for content", () => {
      const comments = getCommentsForContentStrict(15);
      expect(comments).toHaveLength(1);
    });

    it("should throw error for content without comments", () => {
      expect(() => getCommentsForContentStrict(999)).toThrow(
        /Comments file not found/
      );
    });
  });

  describe("Edge Cases", () => {
    it("should handle comments with special characters in body", async () => {
      const comments: StoredComment[] = [
        {
          id: 1,
          parentId: null,
          authorName: 'User "Special"',
          body: 'Comment with "quotes" and \\backslashes\\ and\nnewlines',
          createdAt: "2024-01-01T00:00:00Z",
          commentableId: 10,
          commentableType: "Content",
          language: "en-US",
        },
      ];

      await saveCommentsForEntity("Content", 10, comments);
      const loaded = await loadCommentsForEntity("Content", 10);

      expect(loaded[0].body).toBe(comments[0].body);
      expect(loaded[0].authorName).toBe(comments[0].authorName);
    });

    it("should handle nested comments (parent-child relationships)", async () => {
      const comments: StoredComment[] = [
        {
          id: 1,
          parentId: null,
          authorName: "Parent User",
          body: "Parent comment",
          createdAt: "2024-01-01T00:00:00Z",
          commentableId: 10,
          commentableType: "Content",
          language: "en-US",
        },
        {
          id: 2,
          parentId: 1,
          authorName: "Child User",
          body: "Child comment",
          createdAt: "2024-01-02T00:00:00Z",
          commentableId: 10,
          commentableType: "Content",
          language: "en-US",
        },
      ];

      await saveCommentsForEntity("Content", 10, comments);
      const loaded = await loadCommentsForEntity("Content", 10);

      expect(loaded).toHaveLength(2);
      expect(loaded[0].parentId).toBeNull();
      expect(loaded[1].parentId).toBe(1);
    });

    it("should handle multiple commentable types", async () => {
      const contentComments: StoredComment[] = [
        {
          id: 1,
          parentId: null,
          authorName: "User 1",
          body: "Content comment",
          createdAt: "2024-01-01T00:00:00Z",
          commentableId: 10,
          commentableType: "Content",
          language: "en-US",
        },
      ];

      const contactComments: StoredComment[] = [
        {
          id: 2,
          parentId: null,
          authorName: "User 2",
          body: "Contact comment",
          createdAt: "2024-01-01T00:00:00Z",
          commentableId: 5,
          commentableType: "Contact",
          language: "en-US",
        },
      ];

      await saveCommentsForEntity("Content", 10, contentComments);
      await saveCommentsForEntity("Contact", 5, contactComments);

      const contentPath = path.join(TEST_COMMENTS_DIR, "Content", "10.json");
      const contactPath = path.join(TEST_COMMENTS_DIR, "Contact", "5.json");

      expect(fs.existsSync(contentPath)).toBe(true);
      expect(fs.existsSync(contactPath)).toBe(true);

      const loadedContent = getComments("Content", 10);
      const loadedContact = getComments("Contact", 5);

      expect(loadedContent[0].body).toBe("Content comment");
      expect(loadedContact[0].body).toBe("Contact comment");
    });

    it("should handle updates to existing comments", async () => {
      // Save initial comment
      const initial: StoredComment[] = [
        {
          id: 1,
          parentId: null,
          authorName: "User",
          body: "Initial comment",
          createdAt: "2024-01-01T00:00:00Z",
          commentableId: 10,
          commentableType: "Content",
          language: "en-US",
        },
      ];

      await saveCommentsForEntity("Content", 10, initial);

      // Update comment
      const updated: StoredComment[] = [
        {
          id: 1,
          parentId: null,
          authorName: "User",
          body: "Updated comment",
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-02T00:00:00Z",
          commentableId: 10,
          commentableType: "Content",
          language: "en-US",
        },
      ];

      await saveCommentsForEntity("Content", 10, updated);

      const loaded = await loadCommentsForEntity("Content", 10);
      expect(loaded[0].body).toBe("Updated comment");
      expect(loaded[0].updatedAt).toBe("2024-01-02T00:00:00Z");
    });
  });
});
