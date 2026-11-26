import { MEDIA_RENAME_POLICIES, type MediaRenamePolicy } from "../../scripts/push-media.js";

const FLAG = "--on-media-rename";

/**
 * --on-media-rename <rename|skip|fail> (or --on-media-rename=<mode>): what a
 * media push does with files LeadCMS would store under a different name.
 * Defaults to "rename"; exits with an error on any other value.
 */
export function parseMediaRenameFlag(args: string[]): MediaRenamePolicy {
  let value: string | undefined;
  args.forEach((arg, index) => {
    if (arg === FLAG) {
      value = args[index + 1] ?? "";
    } else if (arg.startsWith(`${FLAG}=`)) {
      value = arg.slice(FLAG.length + 1);
    }
  });

  if (value === undefined) return "rename";
  if ((MEDIA_RENAME_POLICIES as readonly string[]).includes(value)) {
    return value as MediaRenamePolicy;
  }
  console.error(
    `❌ ${FLAG} takes one of ${MEDIA_RENAME_POLICIES.join(", ")}${value ? ` (got "${value}")` : ""}`
  );
  process.exit(1);
}
