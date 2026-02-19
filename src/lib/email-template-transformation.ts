import matter from 'gray-matter';
import { replaceApiMediaPaths, replaceLocalMediaPaths } from './content-transformation.js';

export interface EmailTemplateRemoteData {
  id?: number | string;
  name?: string;
  subject?: string;
  bodyTemplate?: string;
  fromEmail?: string;
  fromName?: string;
  language?: string;
  translationKey?: string | null;
  emailGroupId?: number | null;
  createdAt?: string;
  updatedAt?: string | null;
  emailGroup?: Record<string, any> | null;
  [key: string]: any;
}

export interface EmailTemplateLocalData {
  metadata: Record<string, any>;
  body: string;
}

const HTML_FRONTMATTER_REGEX = /^\s*<!--\s*---\n([\s\S]*?)\n---\s*-->\s*/;
const SYSTEM_FIELDS = new Set(['bodyTemplate', 'isLocal', 'emailGroup', 'emailGroupId']);

/**
 * Extract YAML frontmatter from an HTML comment block at the start of the file.
 */
export function parseEmailTemplateFileContent(fileContent: string): EmailTemplateLocalData {
  const match = fileContent.match(HTML_FRONTMATTER_REGEX);
  if (!match) {
    return { metadata: {}, body: fileContent };
  }

  let metadata: Record<string, any> = {};
  try {
    const yamlWithDelimiters = `---\n${match[1]}\n---\n`;
    metadata = matter(yamlWithDelimiters).data || {};
  } catch (error: any) {
    console.warn('Failed to parse email template frontmatter:', error.message);
  }

  const body = fileContent.slice(match[0].length);
  return { metadata, body };
}

/**
 * Build HTML file content with YAML frontmatter embedded in a leading comment.
 */
export function buildEmailTemplateFileContent(metadata: Record<string, any>, body: string): string {
  const filteredMetadata = filterNullValues(metadata);
  const yamlBlock = matter.stringify('', filteredMetadata).trim();
  const commentBlock = `<!--\n${yamlBlock}\n-->`;

  if (!body) {
    return `${commentBlock}\n`;
  }

  return `${commentBlock}\n${body}`;
}

/**
 * Transform a remote email template into a local HTML file with frontmatter.
 */
export function transformEmailTemplateRemoteToLocalFormat(remote: EmailTemplateRemoteData): string {
  if (!remote || typeof remote !== 'object') {
    throw new Error('Invalid remote email template');
  }

  const metadata: Record<string, any> = {};
  for (const [key, value] of Object.entries(remote)) {
    if (!SYSTEM_FIELDS.has(key)) {
      metadata[key] = replaceApiMediaPaths(value);
    }
  }

  // Store the human-readable group name instead of the numeric ID
  if (remote.emailGroup?.name) {
    metadata.groupName = remote.emailGroup.name;
  }

  const body = replaceApiMediaPaths(remote.bodyTemplate || '');
  return buildEmailTemplateFileContent(metadata, body);
}

/**
 * Transform local email template data into the API payload.
 */
export function formatEmailTemplateForApi(local: EmailTemplateLocalData): Record<string, any> {
  const metadata = local.metadata || {};

  const payload: Record<string, any> = {
    name: metadata.name,
    subject: metadata.subject,
    bodyTemplate: local.body || '',
    fromEmail: metadata.fromEmail,
    fromName: metadata.fromName,
    language: metadata.language,
    translationKey: metadata.translationKey,
    emailGroupId: metadata.emailGroupId,
    // groupName is resolved externally to emailGroupId before this point
    // but we don't send groupName to the API
  };

  // Remove read-only fields if present in metadata
  delete payload.createdAt;
  delete payload.updatedAt;
  delete payload.id;

  return replaceLocalMediaPaths(payload);
}

function filterNullValues(obj: Record<string, any>): Record<string, any> {
  const filtered: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && value !== undefined) {
      filtered[key] = value;
    }
  }
  return filtered;
}
