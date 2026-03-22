import { slugify as transliterateSlugify } from "transliteration";

/**
 * Transliterates and slugifies a string for use as a filename.
 * Supports Cyrillic, CJK, Arabic, and many other scripts via the
 * `transliteration` library.
 *
 * Example: "Онбординг при регистрации" → "onbording-pri-registracii"
 */
export function slugify(value: string): string {
    return transliterateSlugify(value, { lowercase: true, separator: "-" });
}
