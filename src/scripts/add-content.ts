/**
 * LeadCMS Add Content - Create new content files locally via interactive wizard
 *
 * Flow:
 * 1. Resolve slug from CLI arg or prompt
 * 2. Validate slug (path traversal, invalid chars, existing file check)
 * 3. Fetch content types from remote
 * 4. Select content type
 * 5. Prompt for required frontmatter fields (conditional on type config)
 * 6. Fetch existing categories/tags from remote, allow selection or custom entry
 * 7. Generate MDX or JSON file
 * 8. Write to disk
 */

import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import readline from "readline";
import matter from "gray-matter";
import {
  defaultLanguage,
  CONTENT_DIR,
  resolveIdentity,
} from "./leadcms-helpers.js";
import { leadCMSDataService, type ContentType } from "../lib/data-service.js";
import { colorConsole } from "../lib/console-colors.js";
import { logger } from "../lib/logger.js";

// ── Types ───────────────────────────────────────────────────────────────

export interface ContentTypeInfo {
  uid: string;
  format: string;
  name: string;
  supportsCoverImage?: boolean;
  supportsComments?: boolean;
  supportsSEO?: boolean;
  slugPrefix?: string | null;
  slugPostfix?: string | null;
}

export interface AddContentOptions {
  slug: string;
  title: string;
  description: string;
  author: string;
  language: string;
  category: string;
  tags: string[];
  type: string;
  coverImageUrl?: string;
  coverImageAlt?: string;
  allowComments?: boolean;
}

// ── Slug helpers ────────────────────────────────────────────────────────

/**
 * Convert a slug to a human-readable title.
 * Uses the last path segment for nested slugs.
 */
export function slugToTitle(slug: string): string {
  const segment = slug.includes("/") ? slug.split("/").pop()! : slug;
  return segment
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Validate a slug for safety and correctness.
 */
export function validateSlug(slug: string): { valid: true } | { valid: false; error: string } {
  if (!slug || slug.trim().length === 0) {
    return { valid: false, error: "Slug cannot be empty" };
  }

  if (slug.includes("..")) {
    return { valid: false, error: "Slug cannot contain path traversal (..)" };
  }

  if (slug.includes("\\")) {
    return { valid: false, error: "Slug cannot contain backslashes" };
  }

  if (slug.startsWith(".")) {
    return { valid: false, error: "Slug cannot start with a dot" };
  }

  // Only allow alphanumeric, hyphens, underscores, and forward slashes
  if (!/^[a-zA-Z0-9][a-zA-Z0-9\-_/]*$/.test(slug)) {
    return { valid: false, error: "Slug contains invalid characters. Use letters, numbers, hyphens, and forward slashes." };
  }

  return { valid: true };
}

/**
 * Apply slug prefix/postfix from the content type configuration.
 * Returns the (possibly transformed) slug and whether it was changed.
 */
export function applySlugPrefixPostfix(
  slug: string,
  contentType: ContentTypeInfo
): { slug: string; changed: boolean } {
  let result = slug;
  let changed = false;

  const prefix = contentType.slugPrefix?.trim();
  if (prefix && !result.startsWith(prefix)) {
    result = prefix + result;
    changed = true;
  }

  const postfix = contentType.slugPostfix?.trim();
  if (postfix && !result.endsWith(postfix)) {
    result = result + postfix;
    changed = true;
  }

  return { slug: result, changed };
}


// ── Frontmatter / content generation ────────────────────────────────────

/**
 * Build a frontmatter object from options, respecting content type capabilities.
 */
export function buildFrontmatter(
  options: AddContentOptions,
  contentType: ContentTypeInfo
): Record<string, any> {
  const fm: Record<string, any> = {
    title: options.title,
    description: options.description,
    slug: options.slug,
    type: options.type,
    author: options.author,
    language: options.language,
    category: options.category,
    tags: options.tags,
    draft: true,
  };

  if (contentType.supportsCoverImage) {
    fm.coverImageUrl = options.coverImageUrl ?? "";
    fm.coverImageAlt = options.coverImageAlt ?? "";
  }

  if (contentType.supportsComments) {
    fm.allowComments = options.allowComments ?? true;
  }

  return fm;
}

/**
 * Generate MDX file content with YAML frontmatter.
 */
export function generateMDXContent(
  options: AddContentOptions,
  contentType: ContentTypeInfo
): string {
  const fm = buildFrontmatter(options, contentType);
  return matter.stringify("", fm);
}

/**
 * Generate JSON file content.
 */
export function generateJSONContent(
  options: AddContentOptions,
  contentType: ContentTypeInfo
): string {
  const fm = buildFrontmatter(options, contentType);
  fm.body = "";
  return JSON.stringify(fm, null, 2) + "\n";
}

// ── Readline helpers ────────────────────────────────────────────────────

let rl: readline.Interface | null = null;

function getReadlineInterface(): readline.Interface {
  if (!rl) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }
  return rl;
}

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    getReadlineInterface().question(prompt, resolve);
  });
}

function closeReadline(): void {
  if (rl) {
    rl.close();
    rl = null;
  }
}

// ── Interactive prompts ─────────────────────────────────────────────────

/**
 * Display a numbered list of options and let the user pick one or enter a custom value.
 * Returns the selected string.
 */
async function promptWithOptions(
  label: string,
  existing: string[],
  opts?: { required?: boolean; defaultValue?: string }
): Promise<string> {
  const { required = false, defaultValue } = opts ?? {};

  if (existing.length > 0) {
    colorConsole.info(`\n  Existing ${label}:`);
    existing.forEach((item, i) => {
      console.log(`    ${i + 1}) ${item}`);
    });
    console.log(`    ${existing.length + 1}) Enter a new ${label.toLowerCase().replace(/s$/, "")}`);
  }

  const defaultHint = defaultValue ? ` [${defaultValue}]` : "";
  const requiredHint = required ? " (required)" : "";

  while (true) {
    const input = await question(
      `  ${label}${requiredHint}${defaultHint}: `
    );
    const trimmed = input.trim();

    if (trimmed === "" && defaultValue) {
      return defaultValue;
    }

    // If there are existing options, check if the user entered a number
    if (existing.length > 0) {
      const num = parseInt(trimmed, 10);
      if (!isNaN(num) && num >= 1 && num <= existing.length) {
        return existing[num - 1];
      }
      // User chose "enter new" option or typed text directly
      if (num === existing.length + 1) {
        const custom = await question(`  Enter new ${label.toLowerCase().replace(/s$/, "")}: `);
        if (custom.trim()) return custom.trim();
        if (!required) return defaultValue ?? "";
        colorConsole.warn("  Value is required.");
        continue;
      }
    }

    // Direct text input
    if (trimmed) return trimmed;
    if (!required) return defaultValue ?? "";
    colorConsole.warn("  Value is required.");
  }
}

/**
 * Display a numbered list and let the user pick multiple or enter custom values (comma-separated).
 * Returns an array of strings.
 */
async function promptMultipleWithOptions(
  label: string,
  existing: string[]
): Promise<string[]> {
  if (existing.length > 0) {
    colorConsole.info(`\n  Existing ${label}:`);
    existing.forEach((item, i) => {
      console.log(`    ${i + 1}) ${item}`);
    });
  }

  const input = await question(
    `  ${label} (comma-separated numbers or new values, leave empty to skip): `
  );
  const trimmed = input.trim();

  if (!trimmed) return [];

  const parts = trimmed.split(",").map((s) => s.trim()).filter(Boolean);
  const result: string[] = [];

  for (const part of parts) {
    const num = parseInt(part, 10);
    if (!isNaN(num) && num >= 1 && num <= existing.length) {
      result.push(existing[num - 1]);
    } else {
      // Treat as a new custom value
      result.push(part);
    }
  }

  return [...new Set(result)]; // deduplicate
}

// ── Main wizard ─────────────────────────────────────────────────────────

export interface AddContentRunOptions {
  slugArg?: string;
}

export async function addContent(options: AddContentRunOptions = {}): Promise<void> {
  try {
    const { slugArg } = options;

    // Resolve identity (non-blocking — proceeds even in anonymous mode)
    const identity = await resolveIdentity();

    colorConsole.progress("\n📝 LeadCMS — Create new content\n");

    // ── Step 1: Slug ───────────────────────────────────────────────────
    let slug = slugArg?.trim() ?? "";
    if (!slug) {
      slug = (await question("Slug: ")).trim();
    }

    const slugResult = validateSlug(slug);
    if (!slugResult.valid) {
      colorConsole.error(`❌ Invalid slug: ${slugResult.error}`);
      process.exit(1);
    }

    // ── Step 2: Fetch content types ────────────────────────────────────
    let contentTypes: ContentTypeInfo[];
    try {
      contentTypes = await leadCMSDataService.getContentTypes();
    } catch {
      colorConsole.error("❌ Failed to fetch content types from remote. Make sure you are authenticated.");
      process.exit(1);
    }

    if (contentTypes.length === 0) {
      colorConsole.error("❌ No content types found on remote. Create at least one content type first.");
      process.exit(1);
    }

    // ── Step 3: Select content type ────────────────────────────────────
    let selectedType: ContentTypeInfo;

    if (contentTypes.length === 1) {
      selectedType = contentTypes[0];
      colorConsole.info(`  Content type: ${colorConsole.highlight(selectedType.uid)} (${selectedType.format})`);
    } else {
      colorConsole.info("  Select content type:");
      contentTypes.forEach((ct, i) => {
        console.log(`    ${i + 1}) ${ct.uid} (${ct.format})`);
      });

      while (true) {
        const typeInput = await question(`  Content type [1-${contentTypes.length}]: `);
        const num = parseInt(typeInput.trim(), 10);
        if (!isNaN(num) && num >= 1 && num <= contentTypes.length) {
          selectedType = contentTypes[num - 1];
          break;
        }
        colorConsole.warn(`  Please enter a number between 1 and ${contentTypes.length}.`);
      }
    }

    // ── Step 4: Apply slug prefix/postfix from content type ────────────
    const prefixPostfix = applySlugPrefixPostfix(slug, selectedType);
    if (prefixPostfix.changed) {
      slug = prefixPostfix.slug;
      colorConsole.info(`  Slug adjusted to match content type rules: ${colorConsole.highlight(slug)}`);
    }

    // ── Step 5: Determine file path & check for existing ──────────────
    const ext = selectedType.format === "JSON" ? ".json" : ".mdx";
    const language = defaultLanguage;

    // Check if file already exists
    const filePath = path.join(CONTENT_DIR, `${slug}${ext}`);
    try {
      await fs.access(filePath);
      colorConsole.error(`❌ File already exists: ${filePath}`);
      process.exit(1);
    } catch {
      // File does not exist — good
    }

    // ── Step 5: Core fields ────────────────────────────────────────────
    const titleDefault = slugToTitle(slug);
    const authorDefault = identity?.displayName ?? "";

    const title = (await question(`  Title [${titleDefault}]: `)).trim() || titleDefault;
    const description = (await question("  Description: ")).trim();
    const authorHint = authorDefault ? ` [${authorDefault}]` : "";
    const author = (await question(`  Author${authorHint}: `)).trim() || authorDefault;

    // ── Step 6: Category (mandatory) — from backend + custom ──────────
    let categories: string[] = [];
    try {
      categories = await leadCMSDataService.getCategories(language);
    } catch {
      logger.verbose("[add-content] Could not fetch categories from remote");
    }

    const category = await promptWithOptions("Category", categories, { required: true });

    // ── Step 7: Tags — from backend + custom ──────────────────────────
    let tags: string[] = [];
    try {
      tags = await leadCMSDataService.getTags(language);
    } catch {
      logger.verbose("[add-content] Could not fetch tags from remote");
    }

    const selectedTags = await promptMultipleWithOptions("Tags", tags);

    // ── Step 8: Conditional fields ─────────────────────────────────────
    let coverImageUrl: string | undefined;
    let coverImageAlt: string | undefined;
    let allowComments: boolean | undefined;

    if (selectedType.supportsCoverImage) {
      coverImageUrl = (await question("  Cover image URL: ")).trim();
      if (coverImageUrl) {
        coverImageAlt = (await question("  Cover image alt text: ")).trim();
      }
    }

    if (selectedType.supportsComments) {
      const commentsInput = await question("  Allow comments? (y/n) [y]: ");
      allowComments = commentsInput.trim() === "" || commentsInput.trim().toLowerCase().startsWith("y");
    }

    // ── Step 9: Generate file content ──────────────────────────────────
    const contentOptions: AddContentOptions = {
      slug,
      title,
      description,
      author,
      language,
      category,
      tags: selectedTags,
      type: selectedType.uid,
      coverImageUrl,
      coverImageAlt,
      allowComments,
    };

    let fileContent: string;
    if (selectedType.format === "JSON") {
      fileContent = generateJSONContent(contentOptions, selectedType);
    } else {
      fileContent = generateMDXContent(contentOptions, selectedType);
    }

    // ── Step 10: Write to disk ─────────────────────────────────────────
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, fileContent, "utf-8");

    colorConsole.success(`\n✅ Created ${path.relative(process.cwd(), filePath)}`);
  } finally {
    closeReadline();
  }
}
