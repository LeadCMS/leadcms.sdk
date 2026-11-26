/**
 * Predict the name LeadCMS stores an uploaded media file under.
 *
 * The server normalises every uploaded file name (MediaController.Post:
 * `rawFileName.ToTranslit().Slugify()`, see FileNameHelper in leadcms.core):
 *
 *   1. transliterate to ASCII (Unidecode)
 *   2. whitespace runs → "-"
 *   3. drop every character except letters, digits, "-", "." and "_"
 *   4. "_" → "-"
 *   5. lowercase
 *
 * so `fire_extinguisher.svg` becomes `fire-extinguisher.svg` and
 * `chart@2x.png` becomes `chart2x.png`.
 *
 * For ASCII names the prediction is exact. For other scripts the SDK's
 * transliteration table can differ from the server's, so the predicted name
 * may not match character for character; that the name changes is still
 * certain (the stored name is always ASCII), and the predicted name is one
 * the server keeps as is, so renaming a file to it avoids the rename.
 *
 * Optimisation can also change the extension (e.g. `.png` → `.webp`); that
 * depends on server settings and is not predicted here.
 */

import { transliterate } from "transliteration";

export function predictServerMediaName(fileName: string): string {
  return transliterate(fileName)
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9\-._]/g, "")
    .replace(/_/g, "-")
    .toLowerCase();
}
