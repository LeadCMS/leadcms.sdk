/**
 * LeadCMS Comment Types
 * Types for working with comments from LeadCMS API
 */

/**
 * Comment entity from LeadCMS API
 * Based on CommentDetailsDto from swagger.json
 */
export interface Comment {
  id: number;
  parentId?: number | null;
  authorName: string;
  authorEmail?: string;
  body: string;
  createdAt: string;
  updatedAt?: string | null;
  commentableId: number;
  commentableType: string;
  avatarUrl?: string;
  language: string;
  translationKey?: string | null;
  contactId?: number | null;
  source?: string | null;
  tags?: string[] | null;
  // These are usually included in API responses but we may not need them in local storage
  content?: any;
  parent?: Comment | null;
  contact?: any;
}

/**
 * Simplified comment for local storage
 * Excludes nested objects to keep files clean
 */
export interface StoredComment {
  id: number;
  parentId?: number | null;
  authorName: string;
  authorEmail?: string;
  body: string;
  createdAt: string;
  updatedAt?: string | null;
  commentableId: number;
  commentableType: string;
  avatarUrl?: string;
  language: string;
  translationKey?: string | null;
  contactId?: number | null;
  source?: string | null;
  tags?: string[] | null;
}

/**
 * Response from /api/comments/sync endpoint
 */
export interface CommentSyncResponse {
  items?: Comment[];
  deleted?: number[];
  nextSyncToken?: string;
}

/**
 * Result from fetching comments sync
 */
export interface CommentSyncResult {
  items: Comment[];
  deleted: number[];
  nextSyncToken: string;
}

/**
 * Grouped comments by commentable entity
 * Key format: "{commentableType}/{commentableId}"
 */
export interface CommentsByEntity {
  [key: string]: StoredComment[];
}
