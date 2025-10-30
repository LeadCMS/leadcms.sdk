/**
 * Content API formatting utilities for LeadCMS
 */

import matter from 'gray-matter';
import { replaceLocalMediaPaths } from './content-transformation.js';

// Standard API fields that should be sent as top-level properties
// Based on the actual LeadCMS API schema
const STANDARD_API_FIELDS = new Set([
  'id', 'slug', 'type', 'title', 'body', 'language',
  'createdAt', 'updatedAt', 'publishedAt',
  'description', 'coverImageUrl', 'coverImageAlt',
  'author', 'category', 'tags', 'allowComments',
  'source', 'translationKey', 'translations'
]);

/**
 * Formats local content for API submission
 *
 * Separates standard API fields (sent as top-level properties) from custom fields
 * For MDX files: custom fields are preserved in frontmatter within the body field
 * For JSON files: custom fields are sent as top-level properties, body contains pure JSON
 */
export function formatContentForAPI(localContent: any) {
  // Start with only standard fields from metadata
  const standardFields: any = {};
  const customFields: any = {};

  // Separate standard fields from custom fields
  for (const [key, value] of Object.entries(localContent.metadata)) {
    if (STANDARD_API_FIELDS.has(key)) {
      standardFields[key] = value;
    } else {
      customFields[key] = value;
    }
  }

  // Build the content data with standard fields only
  const contentData: any = {
    slug: localContent.slug,
    type: localContent.type,
    language: localContent.locale,
    ...standardFields
  };

  // Preserve the file-based slug over metadata slug
  if (localContent.slug !== localContent.metadata?.slug) {
    contentData.slug = localContent.slug;
  }

  // Determine if this is a JSON file based on file extension
  const isJsonFile = localContent.filePath && localContent.filePath.endsWith('.json');

  if (isJsonFile) {
    // For JSON files: custom fields should be serialized in the body as JSON string
    // Root level contains only standard API fields
    if (Object.keys(customFields).length > 0) {
      // Serialize custom fields as JSON string in body
      contentData.body = JSON.stringify(customFields, null, 2);
    } else {
      // No custom fields, use original body
      contentData.body = localContent.body || '';
    }
  } else {
    // For MDX files: handle body with custom fields preserved in frontmatter
    let bodyContent = localContent.body || '';

    if (Object.keys(customFields).length > 0) {
      // If we have custom fields, preserve ONLY custom fields in frontmatter
      // Standard fields are already sent as top-level properties, no need to duplicate
      const rebuiltBody = matter.stringify(bodyContent, customFields);
      contentData.body = rebuiltBody;
    } else {
      // No custom fields, use body as-is (could be plain markdown or already have frontmatter)
      contentData.body = bodyContent;
    }
  }

  // Remove local-only fields
  delete contentData.filePath;
  delete contentData.isLocal;

  // Remove read-only fields that the API manages
  // These should not be sent in create/update requests
  delete contentData.id;
  delete contentData.createdAt;
  delete contentData.updatedAt;

  // Apply backward URL transformation: convert /media/ paths back to /api/media/ for API
  return replaceLocalMediaPaths(contentData);
}
