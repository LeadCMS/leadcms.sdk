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
  value?: any;
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
  position?: number | null;
  type?: "Email";
  timing: SequenceStepTiming;
}

export interface SequenceStepDetailsDto {
  id: number;
  sequenceId: number;
  emailTemplateId: number;
  position: number;
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
  sequenceId?: number;
  emailTemplateName: string;
  position: number;
  name: string;
  type?: "Email";
  timing: SequenceStepTiming;
  createdAt?: string;
  updatedAt?: string | null;
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
  description?: string | null;
  language: string;
  stopOnReply?: boolean;
  useContactTimeZone?: boolean;
  timeZone?: number;
  enrollment?: LocalSequenceEnrollmentConfig;
  utmParameters?: Utms;
  steps?: LocalSequenceStepDto[];
  status?: "Draft" | "Active" | "Paused" | "Archived";
  createdAt?: string;
  updatedAt?: string | null;
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

/**
 * Convert a remote SequenceDetailsDto to its local representation.
 * Replaces segment IDs with names and emailTemplateId with emailTemplateName.
 */
export function toLocalSequence(
  remote: SequenceDetailsDto,
  segmentMap: SegmentIdNameMap,
  templateMap: EmailTemplateIdNameMap,
): LocalSequenceDto {
  const local: LocalSequenceDto = {
    id: remote.id,
    name: remote.name,
    description: remote.description,
    language: remote.language,
    stopOnReply: remote.stopOnReply,
    useContactTimeZone: remote.useContactTimeZone,
    timeZone: remote.timeZone,
    status: remote.status,
    createdAt: remote.createdAt,
    updatedAt: remote.updatedAt,
  };

  if (remote.enrollment) {
    local.enrollment = {
      modes: remote.enrollment.modes,
      reentryPolicy: remote.enrollment.reentryPolicy,
      includeSegmentNames: (remote.enrollment.includeSegmentIds ?? []).map(
        (id) => segmentMap.get(id) ?? `unknown-segment-${id}`,
      ),
      excludeSegmentNames: (remote.enrollment.excludeSegmentIds ?? []).map(
        (id) => segmentMap.get(id) ?? `unknown-segment-${id}`,
      ),
    };
  }

  if (remote.utmParameters) {
    local.utmParameters = remote.utmParameters;
  }

  if (remote.steps) {
    local.steps = remote.steps.map((step) => ({
      id: step.id,
      sequenceId: step.sequenceId,
      emailTemplateName:
        templateMap.get(step.emailTemplateId) ??
        `unknown-template-${step.emailTemplateId}`,
      position: step.position,
      name: step.name,
      type: step.type,
      timing: step.timing,
      createdAt: step.createdAt,
      updatedAt: step.updatedAt,
    }));
  }

  return local;
}

/**
 * Convert a local sequence back to a SequenceCreateDto / SequenceUpdateDto
 * shape for pushing to the remote API.
 * Replaces segment names with IDs and emailTemplateName with emailTemplateId.
 */
export function toRemoteSequencePayload(
  local: LocalSequenceDto,
  segmentMap: SegmentNameIdMap,
  templateMap: EmailTemplateNameIdMap,
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
      includeSegmentIds: (local.enrollment.includeSegmentNames ?? []).map(
        (name) => {
          const id = segmentMap.get(name);
          if (id === undefined)
            throw new Error(`Unknown segment name: "${name}"`);
          return id;
        },
      ),
      excludeSegmentIds: (local.enrollment.excludeSegmentNames ?? []).map(
        (name) => {
          const id = segmentMap.get(name);
          if (id === undefined)
            throw new Error(`Unknown segment name: "${name}"`);
          return id;
        },
      ),
    };
  }

  if (local.utmParameters) {
    payload.utmParameters = local.utmParameters;
  }

  if (local.steps) {
    payload.steps = local.steps.map((step) => {
      const templateId = templateMap.get(step.emailTemplateName);
      if (templateId === undefined)
        throw new Error(
          `Unknown email template name: "${step.emailTemplateName}"`,
        );
      return {
        id: step.id,
        emailTemplateId: templateId,
        name: step.name,
        position: step.position,
        type: step.type,
        timing: step.timing,
      };
    });
  }

  return payload;
}
