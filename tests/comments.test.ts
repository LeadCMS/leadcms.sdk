/**
 * Tests for Comments Feature
 * Tests real SDK comment functions - no local reimplementations
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
} from "../src/lib/comment-types.js";
import { createTestConfig } from "./test-helpers";

const TEST_COMMENTS_DIR = path.resolve(".leadcms-test/comments");

// Mock configuration for tests - must be before imports that use getConfig at module load
jest.mock("../src/lib/config.js", () => ({
  getConfig: jest.fn(() => createTestConfig({
    apiKey: "test-api-key",
    contentDir: ".leadcms-test/content",
    mediaDir: ".leadcms-test/media",
    commentsDir: ".leadcms-test/comments",
    enableDrafts: false,
  })),
}));

// Import real SDK functions after mocks are set up
import {
  toStoredComment,
  groupCommentsByEntityAndLanguage,
  loadCommentsForEntity,
  saveCommentsForEntity,
  deleteComment,
} from "../src/scripts/fetch-leadcms-comments.js";

describe("Comments Feature", () => {
  beforeEach(async () => {
    if (fs.existsSync(TEST_COMMENTS_DIR)) {
      fs.rmSync(TEST_COMMENTS_DIR, { recursive: true, force: true });
    }
  });

  afterEach(async () => {
    if (fs.existsSync(TEST_COMMENTS_DIR)) {
      fs.rmSync(TEST_COMMENTS_DIR, { recursive: true, force: true });
    }
  });

  describe("Comment Type Conversion (real toStoredComment)", () => {
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
        content: { id: 20, slug: "test-content" },
        parent: null,
        contact: { id: 5, name: "John" },
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

  describe("Comment Grouping (real groupCommentsByEntityAndLanguage)", () => {
    it("should group comments by commentableType, commentableId and language", () => {
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

      const grouped = groupCommentsByEntityAndLanguage(comments);

      expect(grouped.size).toBe(3);
      expect(grouped.get("Content/10/en-US")).toHaveLength(2);
      expect(grouped.get("Content/20/en-US")).toHaveLength(1);
      expect(grouped.get("Contact/5/en-US")).toHaveLength(1);
    });

    it("should separate same entity by language", () => {
      const comments: Comment[] = [
        {
          id: 1, parentId: null, authorName: "User 1",
          body: "English comment", createdAt: "2024-01-01T00:00:00Z",
          commentableId: 10, commentableType: "Content", language: "en",
        },
        {
          id: 2, parentId: null, authorName: "User 2",
          body: "Spanish comment", createdAt: "2024-01-02T00:00:00Z",
          commentableId: 10, commentableType: "Content", language: "es",
        },
      ];

      const grouped = groupCommentsByEntityAndLanguage(comments);

      expect(grouped.size).toBe(2);
      expect(grouped.get("Content/10/en")).toHaveLength(1);
      expect(grouped.get("Content/10/es")).toHaveLength(1);
    });

    it("should handle empty comment array", () => {
      const grouped = groupCommentsByEntityAndLanguage([]);
      expect(grouped.size).toBe(0);
    });
  });

  describe("Comment Storage (real saveCommentsForEntity / loadCommentsForEntity)", () => {
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

      await saveCommentsForEntity("Content", 10, "en", comments);

      const filePath = path.join(TEST_COMMENTS_DIR, "content", "10.json");
      expect(fs.existsSync(filePath)).toBe(true);

      const saved = JSON.parse(fs.readFileSync(filePath, "utf8"));
      expect(saved).toHaveLength(1);
      expect(saved[0].id).toBe(1);
    });

    it("should sort comments by createdAt and id", async () => {
      const comments: StoredComment[] = [
        {
          id: 3, parentId: null, authorName: "User 3", body: "Comment 3",
          createdAt: "2024-01-03T00:00:00Z", commentableId: 10,
          commentableType: "Content", language: "en-US",
        },
        {
          id: 1, parentId: null, authorName: "User 1", body: "Comment 1",
          createdAt: "2024-01-01T00:00:00Z", commentableId: 10,
          commentableType: "Content", language: "en-US",
        },
        {
          id: 2, parentId: null, authorName: "User 2", body: "Comment 2",
          createdAt: "2024-01-02T00:00:00Z", commentableId: 10,
          commentableType: "Content", language: "en-US",
        },
      ];

      await saveCommentsForEntity("Content", 10, "en", comments);

      const filePath = path.join(TEST_COMMENTS_DIR, "content", "10.json");
      const saved = JSON.parse(fs.readFileSync(filePath, "utf8"));

      expect(saved[0].id).toBe(1);
      expect(saved[1].id).toBe(2);
      expect(saved[2].id).toBe(3);
    });

    it("should remove file when saving empty comments array", async () => {
      await saveCommentsForEntity("Content", 10, "en", [
        {
          id: 1, parentId: null, authorName: "Test", body: "Test",
          createdAt: "2024-01-01T00:00:00Z", commentableId: 10,
          commentableType: "Content", language: "en-US",
        },
      ]);

      const filePath = path.join(TEST_COMMENTS_DIR, "content", "10.json");
      expect(fs.existsSync(filePath)).toBe(true);

      await saveCommentsForEntity("Content", 10, "en", []);
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it("should load existing comments from file", async () => {
      const comments: StoredComment[] = [
        {
          id: 1, parentId: null, authorName: "Test", body: "Test",
          createdAt: "2024-01-01T00:00:00Z", commentableId: 10,
          commentableType: "Content", language: "en-US",
        },
      ];

      await saveCommentsForEntity("Content", 10, "en", comments);
      const loaded = await loadCommentsForEntity("Content", 10, "en");

      expect(loaded).toHaveLength(1);
      expect(loaded[0].id).toBe(1);
      expect(loaded[0].authorName).toBe("Test");
    });

    it("should return empty array for non-existent file", async () => {
      const loaded = await loadCommentsForEntity("Content", 999, "en");
      expect(loaded).toEqual([]);
    });

    it("should save non-default language comments in language subdirectory", async () => {
      const comments: StoredComment[] = [
        {
          id: 1, parentId: null, authorName: "Usuario", body: "Comentario",
          createdAt: "2024-01-01T00:00:00Z", commentableId: 10,
          commentableType: "Content", language: "es",
        },
      ];

      await saveCommentsForEntity("Content", 10, "es", comments);

      const filePath = path.join(TEST_COMMENTS_DIR, "es", "content", "10.json");
      expect(fs.existsSync(filePath)).toBe(true);

      const loaded = await loadCommentsForEntity("Content", 10, "es");
      expect(loaded).toHaveLength(1);
      expect(loaded[0].authorName).toBe("Usuario");
    });
  });

  describe("Comment Deletion (real deleteComment)", () => {
    it("should delete comment by ID", async () => {
      const comments: StoredComment[] = [
        {
          id: 1, parentId: null, authorName: "User 1", body: "Comment 1",
          createdAt: "2024-01-01T00:00:00Z", commentableId: 10,
          commentableType: "Content", language: "en-US",
        },
        {
          id: 2, parentId: null, authorName: "User 2", body: "Comment 2",
          createdAt: "2024-01-02T00:00:00Z", commentableId: 10,
          commentableType: "Content", language: "en-US",
        },
      ];

      await saveCommentsForEntity("Content", 10, "en", comments);
      await deleteComment(1);

      const remaining = await loadCommentsForEntity("Content", 10, "en");
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(2);
    });

    it("should handle deletion of non-existent comment", async () => {
      await expect(deleteComment(999)).resolves.not.toThrow();
    });

    it("should remove file if last comment is deleted", async () => {
      const comments: StoredComment[] = [
        {
          id: 1, parentId: null, authorName: "Test", body: "Test",
          createdAt: "2024-01-01T00:00:00Z", commentableId: 10,
          commentableType: "Content", language: "en-US",
        },
      ];

      await saveCommentsForEntity("Content", 10, "en", comments);
      await deleteComment(1);

      const filePath = path.join(TEST_COMMENTS_DIR, "content", "10.json");
      expect(fs.existsSync(filePath)).toBe(false);
    });
  });

  describe("Public API - getComments", () => {
    beforeEach(async () => {
      const comments: StoredComment[] = [
        {
          id: 1, parentId: null, authorName: "Test User", body: "Test comment",
          createdAt: "2024-01-01T00:00:00Z", commentableId: 10,
          commentableType: "Content", language: "en-US",
        },
      ];

      await saveCommentsForEntity("Content", 10, "en", comments);
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
      const dirPath = path.join(TEST_COMMENTS_DIR, "content");
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
          id: 1, parentId: null, authorName: "Test User", body: "Content comment",
          createdAt: "2024-01-01T00:00:00Z", commentableId: 15,
          commentableType: "Content", language: "en-US",
        },
      ];

      await saveCommentsForEntity("Content", 15, "en", comments);
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
          id: 1, parentId: null, authorName: "Test User", body: "Test comment",
          createdAt: "2024-01-01T00:00:00Z", commentableId: 10,
          commentableType: "Content", language: "en-US",
        },
      ];

      await saveCommentsForEntity("Content", 10, "en", comments);
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
      const dirPath = path.join(TEST_COMMENTS_DIR, "content");
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
          id: 1, parentId: null, authorName: "Test User", body: "Content comment",
          createdAt: "2024-01-01T00:00:00Z", commentableId: 15,
          commentableType: "Content", language: "en-US",
        },
      ];

      await saveCommentsForEntity("Content", 15, "en", comments);
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
          id: 1, parentId: null,
          authorName: 'User "Special"',
          body: 'Comment with "quotes" and \\backslashes\\ and\nnewlines',
          createdAt: "2024-01-01T00:00:00Z", commentableId: 10,
          commentableType: "Content", language: "en-US",
        },
      ];

      await saveCommentsForEntity("Content", 10, "en", comments);
      const loaded = await loadCommentsForEntity("Content", 10, "en");

      expect(loaded[0].body).toBe(comments[0].body);
      expect(loaded[0].authorName).toBe(comments[0].authorName);
    });

    it("should handle nested comments (parent-child relationships)", async () => {
      const comments: StoredComment[] = [
        {
          id: 1, parentId: null, authorName: "Parent User",
          body: "Parent comment", createdAt: "2024-01-01T00:00:00Z",
          commentableId: 10, commentableType: "Content", language: "en-US",
        },
        {
          id: 2, parentId: 1, authorName: "Child User",
          body: "Child comment", createdAt: "2024-01-02T00:00:00Z",
          commentableId: 10, commentableType: "Content", language: "en-US",
        },
      ];

      await saveCommentsForEntity("Content", 10, "en", comments);
      const loaded = await loadCommentsForEntity("Content", 10, "en");

      expect(loaded).toHaveLength(2);
      expect(loaded[0].parentId).toBeNull();
      expect(loaded[1].parentId).toBe(1);
    });

    it("should handle multiple commentable types", async () => {
      const contentComments: StoredComment[] = [
        {
          id: 1, parentId: null, authorName: "User 1", body: "Content comment",
          createdAt: "2024-01-01T00:00:00Z", commentableId: 10,
          commentableType: "Content", language: "en-US",
        },
      ];

      const contactComments: StoredComment[] = [
        {
          id: 2, parentId: null, authorName: "User 2", body: "Contact comment",
          createdAt: "2024-01-01T00:00:00Z", commentableId: 5,
          commentableType: "Contact", language: "en-US",
        },
      ];

      await saveCommentsForEntity("Content", 10, "en", contentComments);
      await saveCommentsForEntity("Contact", 5, "en", contactComments);

      const contentPath = path.join(TEST_COMMENTS_DIR, "content", "10.json");
      const contactPath = path.join(TEST_COMMENTS_DIR, "contact", "5.json");

      expect(fs.existsSync(contentPath)).toBe(true);
      expect(fs.existsSync(contactPath)).toBe(true);

      const loadedContent = getComments("Content", 10);
      const loadedContact = getComments("Contact", 5);

      expect(loadedContent[0].body).toBe("Content comment");
      expect(loadedContact[0].body).toBe("Contact comment");
    });

    it("should handle updates to existing comments", async () => {
      const initial: StoredComment[] = [
        {
          id: 1, parentId: null, authorName: "User", body: "Initial comment",
          createdAt: "2024-01-01T00:00:00Z", commentableId: 10,
          commentableType: "Content", language: "en-US",
        },
      ];

      await saveCommentsForEntity("Content", 10, "en", initial);

      const updated: StoredComment[] = [
        {
          id: 1, parentId: null, authorName: "User", body: "Updated comment",
          createdAt: "2024-01-01T00:00:00Z", updatedAt: "2024-01-02T00:00:00Z",
          commentableId: 10, commentableType: "Content", language: "en-US",
        },
      ];

      await saveCommentsForEntity("Content", 10, "en", updated);

      const loaded = await loadCommentsForEntity("Content", 10, "en");
      expect(loaded[0].body).toBe("Updated comment");
      expect(loaded[0].updatedAt).toBe("2024-01-02T00:00:00Z");
    });
  });
});
