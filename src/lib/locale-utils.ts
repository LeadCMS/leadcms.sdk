/**
 * Locale validation utilities for LeadCMS SDK
 */

/**
 * Check if a directory name is a valid locale code
 * Supports formats like: en, es, de, en-US, fr-CA, zh-CN, zh-Hans, zh-Hant, etc.
 *
 * @param dirName - The directory name to validate
 * @returns true if the directory name matches a valid locale pattern
 *
 * @example
 * ```typescript
 * isValidLocaleCode('en') // true
 * isValidLocaleCode('en-US') // true
 * isValidLocaleCode('zh-Hans') // true
 * isValidLocaleCode('invalid') // false
 * ```
 */
export function isValidLocaleCode(dirName: string): boolean {
  // Match locale patterns:
  // - 2 lowercase letters (e.g., en, es, de, ru, zh)
  // - 2 lowercase letters + dash + 2+ letters/numbers starting with uppercase (e.g., en-US, fr-CA, zh-CN, zh-Hans, zh-Hant)
  const localePattern = /^[a-z]{2}(-[A-Z][a-zA-Z0-9]*)?$/;
  return localePattern.test(dirName);
}
