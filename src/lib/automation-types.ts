/**
 * Type definitions for automation entities: Segments and Sequences.
 *
 * These entities are synced as self-contained JSON files.
 * Segment "name" and Sequence "name" are slugified for filenames,
 * but ID is the primary identifier for mapping local ↔ remote.
 *
 * Static segments (type: "Static") are excluded from sync because
 * they reference remote-specific contact IDs.
 */

// ── Shared ─────────────────────────────────────────────────────────────

export interface Utms {
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  content?: string | null;
  term?: string | null;
  id?: string | null;
}

// ── Segments ───────────────────────────────────────────────────────────

export interface SegmentRule {
  id: string;
  fieldId: string;
  operator: string;
  value?: unknown;
}

export interface RuleGroup {
  id: string;
  connector: "And" | "Or";
  rules?: SegmentRule[];
  groups?: RuleGroup[];
}

export interface SegmentDefinition {
  includeRules: RuleGroup;
  excludeRules?: RuleGroup;
}

export interface SegmentDetailsDto {
  id?: number;
  name: string;
  description?: string | null;
  type: "Dynamic" | "Static";
  contactCount?: number;
  definition?: SegmentDefinition;
  contactIds?: number[] | null;
  createdAt?: string;
  updatedAt?: string | null;
  createdById?: string | null;
  updatedById?: string | null;
  createdByIp?: string | null;
  createdByUserAgent?: string | null;
  updatedByIp?: string | null;
  updatedByUserAgent?: string | null;
}

export interface SegmentCreateDto {
  name: string;
  description?: string | null;
  type: "Dynamic" | "Static";
  definition?: SegmentDefinition;
  contactIds?: number[] | null;
}

export interface SegmentUpdateDto {
  name?: string | null;
  description?: string | null;
  definition?: SegmentDefinition;
  contactIds?: number[] | null;
}

export interface SegmentSyncResponse {
  items?: SegmentDetailsDto[];
  deleted?: number[];
  baseItems?: Record<string, SegmentDetailsDto>;
}

// ── Sequences ──────────────────────────────────────────────────────────

export interface SequenceStepDelay {
  value: number;
  unit: string;
}

export interface SequenceStepTiming {
  delay?: SequenceStepDelay;
  sendAt?: string | null;
  allowedWeekDays?: string[] | null;
}

export interface SequenceStepCreateDto {
  id?: number | null;
  emailTemplateId: number;
  name: string;
  type?: "Email";
  timing: SequenceStepTiming;
}

export interface SequenceStepDetailsDto {
  id: number;
  sequenceId: number;
  emailTemplateId: number;
  name: string;
  type: "Email";
  timing: SequenceStepTiming;
  scheduledCount?: number;
  sentCount?: number;
  failedCount?: number;
  skippedCount?: number;
  createdAt?: string;
  updatedAt?: string | null;
}

export interface SequenceEnrollmentConfig {
  modes?: string[];
  includeSegmentIds?: number[] | null;
  excludeSegmentIds?: number[] | null;
  reentryPolicy?: "OnceEver" | "AllowAfterCompletion" | "Always";
}

export interface SequenceDetailsDto {
  id?: number;
  name: string;
  description?: string | null;
  language: string;
  stopOnReply?: boolean;
  useContactTimeZone?: boolean;
  timeZone?: number;
  enrollment?: SequenceEnrollmentConfig;
  utmParameters?: Utms;
  steps?: SequenceStepDetailsDto[];
  status?: "Draft" | "Active" | "Paused" | "Archived";
  lastActivatedAt?: string | null;
  lastPausedAt?: string | null;
  archivedAt?: string | null;
  activeEnrollmentCount?: number;
  completedEnrollmentCount?: number;
  exitedEnrollmentCount?: number;
  sentCount?: number;
  failedCount?: number;
  createdAt?: string;
  updatedAt?: string | null;
}

export interface SequenceCreateDto {
  name: string;
  description?: string | null;
  language: string;
  stopOnReply?: boolean;
  useContactTimeZone?: boolean;
  timeZone?: number;
  enrollment?: SequenceEnrollmentConfig;
  utmParameters?: Utms;
  steps?: SequenceStepCreateDto[];
}

export interface SequenceUpdateDto {
  name?: string | null;
  description?: string | null;
  language?: string | null;
  stopOnReply?: boolean | null;
  useContactTimeZone?: boolean | null;
  timeZone?: number | null;
  enrollment?: SequenceEnrollmentConfig;
  utmParameters?: Utms;
  steps?: SequenceStepCreateDto[] | null;
}

export interface SequenceSyncResponse {
  items?: SequenceDetailsDto[];
  deleted?: number[];
  baseItems?: Record<string, SequenceDetailsDto>;
}

// ── Local file representation ──────────────────────────────────────────

/**
 * When saved locally, automation entities are stored as JSON with
 * an `_entityType` discriminator so we can read them back unambiguously.
 */
export type AutomationEntityType = "segment" | "sequence";

export interface LocalAutomationFile<T> {
  _entityType: AutomationEntityType;
  data: T;
}

// ── Local sequence shapes ──────────────────────────────────────────────

/**
 * Local enrollment config replaces segment IDs with segment names
 * so that files are human-readable and portable across environments.
 */
export interface LocalSequenceEnrollmentConfig {
  modes?: string[];
  includeSegmentNames?: string[];
  excludeSegmentNames?: string[];
  reentryPolicy?: "OnceEver" | "AllowAfterCompletion" | "Always";
}

/**
 * Local step replaces emailTemplateId with emailTemplateName
 * and strips runtime statistics (scheduledCount, sentCount, etc.).
 */
export interface LocalSequenceStepDto {
  id?: number;
  emailTemplateName: string;
  name: string;
  type?: "Email";
  timing: SequenceStepTiming;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * The local file shape for a sequence.
 * - Replaces emailTemplateId with emailTemplateName in steps
 * - Replaces includeSegmentIds/excludeSegmentIds with names in enrollment
 * - Strips runtime statistics and activation/pause/archive dates
 */
export interface LocalSequenceDto {
  id?: number;
  name: string;
  description?: string;
  language: string;
  stopOnReply?: boolean;
  useContactTimeZone?: boolean;
  timeZone?: number;
  enrollment?: LocalSequenceEnrollmentConfig;
  utmParameters?: Utms;
  steps?: LocalSequenceStepDto[];
  createdAt?: string;
  updatedAt?: string;
}

export function orderLocalSequenceFields(sequence: LocalSequenceDto): LocalSequenceDto {
  return {
    ...(sequence.id != null ? { id: sequence.id } : {}),
    ...(sequence.createdAt != null ? { createdAt: sequence.createdAt } : {}),
    ...(sequence.updatedAt != null ? { updatedAt: sequence.updatedAt } : {}),
    name: sequence.name,
    language: sequence.language,
    ...(sequence.stopOnReply !== undefined ? { stopOnReply: sequence.stopOnReply } : {}),
    ...(sequence.useContactTimeZone !== undefined
      ? { useContactTimeZone: sequence.useContactTimeZone }
      : {}),
    ...(sequence.timeZone !== undefined ? { timeZone: sequence.timeZone } : {}),
    ...(sequence.description != null ? { description: sequence.description } : {}),
    ...(sequence.enrollment != null ? { enrollment: sequence.enrollment } : {}),
    ...(sequence.utmParameters != null ? { utmParameters: sequence.utmParameters } : {}),
    ...(sequence.steps != null ? { steps: sequence.steps } : {}),
  };
}

// ── Transformation helpers ─────────────────────────────────────────────

/** Map of segment ID → name, used for pull transformations. */
export type SegmentIdNameMap = Map<number, string>;
/** Map of segment name → ID, used for push transformations. */
export type SegmentNameIdMap = Map<string, number>;
/** Map of email template ID → name, used for pull transformations. */
export type EmailTemplateIdNameMap = Map<number, string>;
/** Map of email template name → ID, used for push transformations. */
export type EmailTemplateNameIdMap = Map<string, number>;

// ── Redirects ──────────────────────────────────────────────────────────

export type RedirectSourceType = "InternalPath" | "ContentSlug" | "ContentId";
export type RedirectTargetType = "ExternalUrl" | "InternalPath" | "ContentSlug" | "ContentId";
export type RedirectKind = "Permanent" | "Temporary";

export interface RedirectDetailsDto {
  id: number;
  sourceType: RedirectSourceType;
  targetType: RedirectTargetType;
  kind: RedirectKind;
  fromPath: string | null;
  fromLanguage: string | null;
  fromSlug: string | null;
  fromContentId: number | null;
  toUrl: string | null;
  toPath: string | null;
  toLanguage: string | null;
  toSlug: string | null;
  toContentId: number | null;
  isAutoDiscovered: boolean;
  isAutoDiscoverySuppressed: boolean;
  createdAt: string;
  updatedAt: string | null;
}

export interface RedirectCreateDto {
  sourceType: RedirectSourceType;
  targetType: RedirectTargetType;
  kind: RedirectKind;
  fromPath?: string | null;
  fromLanguage?: string | null;
  fromSlug?: string | null;
  fromContentId?: number | null;
  toUrl?: string | null;
  toPath?: string | null;
  toLanguage?: string | null;
  toSlug?: string | null;
  toContentId?: number | null;
}

export interface RedirectUpdateDto {
  kind?: RedirectKind;
  fromPath?: string | null;
  fromLanguage?: string | null;
  fromSlug?: string | null;
  fromContentId?: number | null;
  toUrl?: string | null;
  toPath?: string | null;
  toLanguage?: string | null;
  toSlug?: string | null;
  toContentId?: number | null;
}

/** Compute a stable surrogate key from the "from" fields (which must be unique per redirect). */
export function redirectSurrogateKey(
  r: Pick<
    LocalRedirect | RedirectDetailsDto,
    "fromPath" | "fromLanguage" | "fromSlug" | "fromContentId"
  >
): string {
  if (r.fromPath != null) return `path:${r.fromPath}`;
  if (r.fromSlug != null) return `slug:${r.fromLanguage ?? ""}/${r.fromSlug}`;
  if (r.fromContentId != null) return `content:${r.fromContentId}`;
  return "unknown";
}

/**
 * Local YAML representation — id, createdAt, updatedAt, sourceType and targetType
 * are omitted; sourceType/targetType are auto-detected on push from the populated fields.
 */
export interface LocalRedirect {
  kind: RedirectKind;
  fromPath?: string | null;
  fromLanguage?: string | null;
  fromSlug?: string | null;
  fromContentId?: number | null;
  toUrl?: string | null;
  toPath?: string | null;
  toLanguage?: string | null;
  toSlug?: string | null;
  toContentId?: number | null;
}

/** A redirect item as stored on disk — `kind` is implied by the YAML section. */
export type LocalRedirectItem = Omit<LocalRedirect, "kind">;

/**
 * On-disk format for redirects.yaml.
 * Redirects are split by kind so the `kind` field is not repeated per item.
 */
export interface LocalRedirectsFile {
  permanent?: LocalRedirectItem[];
  temporary?: LocalRedirectItem[];
}

/** Flatten a LocalRedirectsFile into LocalRedirect[] with `kind` injected. */
export function flattenRedirectsFile(file: LocalRedirectsFile): LocalRedirect[] {
  const permanents = (file.permanent ?? []).map((r) => ({
    ...r,
    kind: "Permanent" as RedirectKind,
  }));
  const temporaries = (file.temporary ?? []).map((r) => ({
    ...r,
    kind: "Temporary" as RedirectKind,
  }));
  return [...permanents, ...temporaries];
}

/** Build a LocalRedirectsFile from a flat LocalRedirect[] by splitting on kind. */
export function buildRedirectsFile(redirects: LocalRedirect[]): LocalRedirectsFile {
  const permanent = redirects
    .filter((r) => r.kind === "Permanent")
    .map(({ kind: _k, ...rest }): LocalRedirectItem => rest);
  const temporary = redirects
    .filter((r) => r.kind === "Temporary")
    .map(({ kind: _k, ...rest }): LocalRedirectItem => rest);
  const file: LocalRedirectsFile = {};
  if (permanent.length) file.permanent = permanent;
  if (temporary.length) file.temporary = temporary;
  return file;
}

/**
 * Strip `fromLanguage` / `toLanguage` from redirects where they match
 * `language`. Used when writing YAML in single-language mode so those fields
 * are not repeated on every item.
 */
export function stripDefaultLanguage(
  redirects: LocalRedirect[],
  language: string
): LocalRedirect[] {
  return redirects.map((r) => {
    const result = { ...r };
    if (result.fromLanguage === language) {
      delete result.fromLanguage;
    }
    if (result.toLanguage === language) {
      delete result.toLanguage;
    }
    return result;
  });
}

/**
 * Inject `fromLanguage` / `toLanguage` into ContentSlug redirects that are
 * missing them. Used when reading YAML in single-language mode to restore the
 * fields before sending to the API.
 */
export function injectDefaultLanguage(
  redirects: LocalRedirect[],
  language: string
): LocalRedirect[] {
  return redirects.map((r) => {
    const result = { ...r };
    if (r.fromSlug != null && r.fromLanguage == null) {
      result.fromLanguage = language;
    }
    if (r.toSlug != null && r.toLanguage == null) {
      result.toLanguage = language;
    }
    return result;
  });
}

/** Derive sourceType from which fields are populated. */
export function detectSourceType(r: LocalRedirect): RedirectSourceType {
  if (r.fromPath != null) return "InternalPath";
  if (r.fromContentId != null) return "ContentId";
  return "ContentSlug";
}

/** Derive targetType from which fields are populated. */
export function detectTargetType(r: LocalRedirect): RedirectTargetType {
  if (r.toUrl != null) return "ExternalUrl";
  if (r.toPath != null) return "InternalPath";
  if (r.toContentId != null) return "ContentId";
  return "ContentSlug";
}

/** Convert a RedirectDetailsDto to local YAML format — strips server-managed fields (id, dates). */
export function toLocalRedirect(dto: RedirectDetailsDto): LocalRedirect {
  const r: LocalRedirect = {
    kind: dto.kind,
  };
  if (dto.fromPath != null) r.fromPath = dto.fromPath;
  if (dto.fromLanguage != null) r.fromLanguage = dto.fromLanguage;
  if (dto.fromSlug != null) r.fromSlug = dto.fromSlug;
  if (dto.fromContentId != null) r.fromContentId = dto.fromContentId;
  if (dto.toUrl != null) r.toUrl = dto.toUrl;
  if (dto.toPath != null) r.toPath = dto.toPath;
  if (dto.toLanguage != null) r.toLanguage = dto.toLanguage;
  if (dto.toSlug != null) r.toSlug = dto.toSlug;
  if (dto.toContentId != null) r.toContentId = dto.toContentId;
  return r;
}

/** Convert a LocalRedirect to a RedirectCreateDto. */
export function toRedirectCreateDto(r: LocalRedirect): RedirectCreateDto {
  return {
    sourceType: detectSourceType(r),
    targetType: detectTargetType(r),
    kind: r.kind,
    fromPath: r.fromPath ?? null,
    fromLanguage: r.fromLanguage ?? null,
    fromSlug: r.fromSlug ?? null,
    fromContentId: r.fromContentId ?? null,
    toUrl: r.toUrl ?? null,
    toPath: r.toPath ?? null,
    toLanguage: r.toLanguage ?? null,
    toSlug: r.toSlug ?? null,
    toContentId: r.toContentId ?? null,
  };
}

/** Convert a LocalRedirect to a RedirectUpdateDto (writable fields only). */
export function toRedirectUpdateDto(r: LocalRedirect): RedirectUpdateDto {
  return {
    kind: r.kind,
    fromPath: r.fromPath ?? null,
    fromLanguage: r.fromLanguage ?? null,
    fromSlug: r.fromSlug ?? null,
    fromContentId: r.fromContentId ?? null,
    toUrl: r.toUrl ?? null,
    toPath: r.toPath ?? null,
    toLanguage: r.toLanguage ?? null,
    toSlug: r.toSlug ?? null,
    toContentId: r.toContentId ?? null,
  };
}

/**
 * Recursively strip null values and empty arrays from an object
 * to keep local files clean and compact.
 */
export function stripNullsAndEmptyArrays<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) =>
      typeof item === "object" && item !== null ? stripNullsAndEmptyArrays(item) : item
    ) as unknown as T;
  }
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (value === null || value === undefined) continue;
      if (Array.isArray(value) && value.length === 0) continue;
      result[key] = typeof value === "object" ? stripNullsAndEmptyArrays(value) : value;
    }
    return result as T;
  }
  return obj;
}

/**
 * Strip null/undefined fields from timing to keep local files clean.
 */
function stripNullTimingFields(timing: SequenceStepTiming): SequenceStepTiming {
  const result: SequenceStepTiming = {};
  if (timing.delay != null) result.delay = timing.delay;
  if (timing.sendAt != null) result.sendAt = timing.sendAt;
  if (timing.allowedWeekDays != null) result.allowedWeekDays = timing.allowedWeekDays;
  return result;
}

/**
 * Convert a remote SequenceDetailsDto to its local representation.
 * Replaces segment IDs with names and emailTemplateId with emailTemplateName.
 */
export function toLocalSequence(
  remote: SequenceDetailsDto,
  segmentMap: SegmentIdNameMap,
  templateMap: EmailTemplateIdNameMap
): LocalSequenceDto {
  const local: LocalSequenceDto = {
    id: remote.id,
    name: remote.name,
    language: remote.language,
    stopOnReply: remote.stopOnReply,
    useContactTimeZone: remote.useContactTimeZone,
    timeZone: remote.timeZone,
    createdAt: remote.createdAt,
  };

  if (remote.description != null) {
    local.description = remote.description;
  }
  if (remote.updatedAt != null) {
    local.updatedAt = remote.updatedAt;
  }

  if (remote.enrollment) {
    local.enrollment = {
      modes: remote.enrollment.modes,
      reentryPolicy: remote.enrollment.reentryPolicy,
      includeSegmentNames: (remote.enrollment.includeSegmentIds ?? []).map(
        (id) => segmentMap.get(id) ?? `unknown-segment-${id}`
      ),
      excludeSegmentNames: (remote.enrollment.excludeSegmentIds ?? []).map(
        (id) => segmentMap.get(id) ?? `unknown-segment-${id}`
      ),
    };
  }

  if (remote.utmParameters) {
    local.utmParameters = remote.utmParameters;
  }

  if (remote.steps) {
    local.steps = remote.steps.map((step) => {
      const localStep: LocalSequenceStepDto = {
        emailTemplateName:
          templateMap.get(step.emailTemplateId) ?? `unknown-template-${step.emailTemplateId}`,
        name: step.name,
        type: step.type,
        timing: stripNullTimingFields(step.timing),
      };
      return localStep;
    });
  }

  return orderLocalSequenceFields(local);
}

/**
 * Convert a local sequence back to a SequenceCreateDto / SequenceUpdateDto
 * shape for pushing to the remote API.
 * Replaces segment names with IDs and emailTemplateName with emailTemplateId.
 */
export function toRemoteSequencePayload(
  local: LocalSequenceDto,
  segmentMap: SegmentNameIdMap,
  templateMap: EmailTemplateNameIdMap
): SequenceCreateDto {
  const payload: SequenceCreateDto = {
    name: local.name,
    description: local.description,
    language: local.language,
    stopOnReply: local.stopOnReply,
    useContactTimeZone: local.useContactTimeZone,
    timeZone: local.timeZone,
  };

  if (local.enrollment) {
    payload.enrollment = {
      modes: local.enrollment.modes,
      reentryPolicy: local.enrollment.reentryPolicy,
      includeSegmentIds: (local.enrollment.includeSegmentNames ?? []).map((name) => {
        const id = segmentMap.get(name);
        if (id === undefined) throw new Error(`Unknown segment name: "${name}"`);
        return id;
      }),
      excludeSegmentIds: (local.enrollment.excludeSegmentNames ?? []).map((name) => {
        const id = segmentMap.get(name);
        if (id === undefined) throw new Error(`Unknown segment name: "${name}"`);
        return id;
      }),
    };
  }

  if (local.utmParameters) {
    payload.utmParameters = local.utmParameters;
  }

  if (local.steps) {
    payload.steps = local.steps.map((step, _index) => {
      const templateId = templateMap.get(step.emailTemplateName);
      if (templateId === undefined)
        throw new Error(`Unknown email template name: "${step.emailTemplateName}"`);
      return {
        emailTemplateId: templateId,
        name: step.name,
        type: step.type,
        timing: step.timing,
      };
    });
  }

  return payload;
}
