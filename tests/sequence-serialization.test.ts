/**
 * Tests for sequence serialization: toLocalSequence strips redundant fields
 * (null values, sequenceId, position) and toRemoteSequencePayload derives
 * position from array index.
 */

import {
  toLocalSequence,
  toRemoteSequencePayload,
  type SequenceDetailsDto,
  type SequenceStepDetailsDto,
  type LocalSequenceDto,
  type SegmentIdNameMap,
  type SegmentNameIdMap,
  type EmailTemplateIdNameMap,
  type EmailTemplateNameIdMap,
} from '../src/lib/automation-types';

// ── Helpers ─────────────────────────────────────────────────────────────

function makeRemoteStep(overrides: Partial<SequenceStepDetailsDto> = {}): SequenceStepDetailsDto {
  return {
    id: 5,
    sequenceId: 2,
    emailTemplateId: 10,
    name: 'Step 1',
    type: 'Email',
    timing: {
      delay: { value: 0, unit: 'days' },
      sendAt: null,
      allowedWeekDays: null,
    },
    createdAt: '2026-03-21T18:41:02Z',
    updatedAt: null,
    ...overrides,
  };
}

function makeRemoteSequence(overrides: Partial<SequenceDetailsDto> = {}): SequenceDetailsDto {
  return {
    id: 2,
    name: 'Test Sequence',
    description: null,
    language: 'en',
    stopOnReply: true,
    useContactTimeZone: true,
    timeZone: 0,
    status: 'Draft',
    createdAt: '2026-03-21T18:00:00Z',
    updatedAt: null,
    steps: [makeRemoteStep()],
    ...overrides,
  };
}

const emptySegmentMap: SegmentIdNameMap = new Map();
const emptyTemplateMap: EmailTemplateIdNameMap = new Map();

function makeTemplateMaps(): { idToName: EmailTemplateIdNameMap; nameToId: EmailTemplateNameIdMap } {
  const idToName: EmailTemplateIdNameMap = new Map([[10, 'WS_Email_1'], [20, 'WS_Email_2'], [30, 'WS_Email_3']]);
  const nameToId: EmailTemplateNameIdMap = new Map([['WS_Email_1', 10], ['WS_Email_2', 20], ['WS_Email_3', 30]]);
  return { idToName, nameToId };
}

function makeSegmentMaps(): { idToName: SegmentIdNameMap; nameToId: SegmentNameIdMap } {
  const idToName: SegmentIdNameMap = new Map([[1, 'Corporate Domains']]);
  const nameToId: SegmentNameIdMap = new Map([['Corporate Domains', 1]]);
  return { idToName, nameToId };
}

// ── toLocalSequence ─────────────────────────────────────────────────────

describe('toLocalSequence', () => {
  const { idToName } = makeTemplateMaps();

  it('should omit description when null', () => {
    const remote = makeRemoteSequence({ description: null });
    const local = toLocalSequence(remote, emptySegmentMap, idToName);
    expect(local).not.toHaveProperty('description');
  });

  it('should include description when present', () => {
    const remote = makeRemoteSequence({ description: 'A real description' });
    const local = toLocalSequence(remote, emptySegmentMap, idToName);
    expect(local.description).toBe('A real description');
  });

  it('should omit updatedAt when null', () => {
    const remote = makeRemoteSequence({ updatedAt: null });
    const local = toLocalSequence(remote, emptySegmentMap, idToName);
    expect(local).not.toHaveProperty('updatedAt');
  });

  it('should include updatedAt when present', () => {
    const remote = makeRemoteSequence({ updatedAt: '2026-03-22T10:00:00Z' });
    const local = toLocalSequence(remote, emptySegmentMap, idToName);
    expect(local.updatedAt).toBe('2026-03-22T10:00:00Z');
  });

  it('should keep id, createdAt, updatedAt at the top-level in stable order', () => {
    const remote = makeRemoteSequence({
      description: 'A real description',
      updatedAt: '2026-03-22T10:00:00Z',
    });

    const local = toLocalSequence(remote, emptySegmentMap, idToName);

    expect(Object.keys(local)).toEqual([
      'id',
      'createdAt',
      'updatedAt',
      'name',
      'language',
      'stopOnReply',
      'useContactTimeZone',
      'timeZone',
      'description',
      'steps',
    ]);
  });

  it('should not include sequenceId in steps', () => {
    const remote = makeRemoteSequence();
    const local = toLocalSequence(remote, emptySegmentMap, idToName);
    expect(local.steps![0]).not.toHaveProperty('sequenceId');
  });

  it('should strip sendAt from timing when null', () => {
    const remote = makeRemoteSequence({
      steps: [makeRemoteStep({ timing: { delay: { value: 1, unit: 'days' }, sendAt: null, allowedWeekDays: null } })],
    });
    const local = toLocalSequence(remote, emptySegmentMap, idToName);
    expect(local.steps![0].timing).not.toHaveProperty('sendAt');
    expect(local.steps![0].timing).not.toHaveProperty('allowedWeekDays');
  });

  it('should preserve sendAt in timing when non-null', () => {
    const remote = makeRemoteSequence({
      steps: [makeRemoteStep({ timing: { delay: { value: 0, unit: 'days' }, sendAt: '09:00' } })],
    });
    const local = toLocalSequence(remote, emptySegmentMap, idToName);
    expect(local.steps![0].timing.sendAt).toBe('09:00');
  });

  it('should preserve allowedWeekDays when non-null', () => {
    const remote = makeRemoteSequence({
      steps: [makeRemoteStep({ timing: { delay: { value: 0, unit: 'days' }, allowedWeekDays: ['Monday', 'Tuesday'] } })],
    });
    const local = toLocalSequence(remote, emptySegmentMap, idToName);
    expect(local.steps![0].timing.allowedWeekDays).toEqual(['Monday', 'Tuesday']);
  });

  it('should omit updatedAt from steps when null', () => {
    const remote = makeRemoteSequence({
      steps: [makeRemoteStep({ updatedAt: null })],
    });
    const local = toLocalSequence(remote, emptySegmentMap, idToName);
    expect(local.steps![0]).not.toHaveProperty('updatedAt');
  });

  it('should omit updatedAt from steps (backend metadata is stripped)', () => {
    const remote = makeRemoteSequence({
      steps: [makeRemoteStep({ updatedAt: '2026-03-22T10:00:00Z' })],
    });
    const local = toLocalSequence(remote, emptySegmentMap, idToName);
    expect(local.steps![0]).not.toHaveProperty('updatedAt');
  });

  it('should preserve natural step order from the API response', () => {
    const idToNameLocal: EmailTemplateIdNameMap = new Map([
      [20, 'tpl-1'], [21, 'tpl-2'], [22, 'tpl-3'], [23, 'tpl-4'], [24, 'tpl-5'],
    ]);

    // API returns steps in a specific order — IDs are NOT sequential because
    // steps can be reordered (moved up/down) independently of creation order.
    const remote = makeRemoteSequence({
      steps: [
        makeRemoteStep({ id: 20, emailTemplateId: 24, name: 'Step 5' }),
        makeRemoteStep({ id: 16, emailTemplateId: 21, name: 'Step 2' }),
        makeRemoteStep({ id: 17, emailTemplateId: 22, name: 'Step 3' }),
        makeRemoteStep({ id: 15, emailTemplateId: 20, name: 'Step 1' }),
        makeRemoteStep({ id: 19, emailTemplateId: 23, name: 'Step 4' }),
      ],
    });

    const local = toLocalSequence(remote, emptySegmentMap, idToNameLocal);

    // Must preserve exact API array order — no sorting by id or anything else
    expect(local.steps!.map(s => s.name)).toEqual([
      'Step 5', 'Step 2', 'Step 3', 'Step 1', 'Step 4',
    ]);
  });

  it('should produce the expected clean shape for the example input', () => {
    const segmentMap: SegmentIdNameMap = new Map([[1, 'Corporate Domains']]);
    const templateMap: EmailTemplateIdNameMap = new Map([
      [10, 'WS_Webinar_Email_1'],
      [20, 'WS_Webinar_Email_2'],
      [30, 'WS_Webinar_Email_3'],
    ]);

    const remote: SequenceDetailsDto = {
      id: 2,
      name: 'Corporate Domain Sequence',
      description: null,
      language: 'ru-RU',
      stopOnReply: true,
      useContactTimeZone: true,
      timeZone: 180,
      status: 'Draft',
      createdAt: '2026-03-21T18:41:02.938605Z',
      updatedAt: null,
      enrollment: {
        modes: ['manual', 'segment', 'api'],
        reentryPolicy: 'OnceEver',
        includeSegmentIds: [1],
        excludeSegmentIds: [],
      },
      steps: [
        {
          id: 5, sequenceId: 2, emailTemplateId: 10,
          name: 'Step 1', type: 'Email',
          timing: { delay: { value: 0, unit: 'days' }, sendAt: null, allowedWeekDays: null },
          createdAt: '2026-03-21T18:41:02Z', updatedAt: '2026-03-21T18:41:02Z',
        },
        {
          id: 6, sequenceId: 2, emailTemplateId: 20,
          name: 'Step 2', type: 'Email',
          timing: { delay: { value: 1, unit: 'days' }, sendAt: null, allowedWeekDays: null },
          createdAt: '2026-03-21T18:41:02Z', updatedAt: null,
        },
        {
          id: 7, sequenceId: 2, emailTemplateId: 30,
          name: 'Step 3', type: 'Email',
          timing: { delay: { value: 1, unit: 'days' }, sendAt: null, allowedWeekDays: null },
          createdAt: '2026-03-21T18:41:02Z', updatedAt: null,
        },
      ],
    };

    const local = toLocalSequence(remote, segmentMap, templateMap);

    // No description (was null)
    expect(local).not.toHaveProperty('description');
    // No updatedAt at sequence level (was null)
    expect(local).not.toHaveProperty('updatedAt');
    // Status is server-controlled — not saved locally
    expect(local).not.toHaveProperty('status');

    // Steps should not have sequenceId
    for (const step of local.steps!) {
      expect(step).not.toHaveProperty('sequenceId');
    }

    // Steps should not have null timing fields
    for (const step of local.steps!) {
      expect(step.timing).not.toHaveProperty('sendAt');
      expect(step.timing).not.toHaveProperty('allowedWeekDays');
    }

    // Step 1 has non-null updatedAt but step metadata is stripped
    expect(local.steps![0]).not.toHaveProperty('updatedAt');
    // Steps 2 and 3 had null updatedAt — should also be omitted
    expect(local.steps![1]).not.toHaveProperty('updatedAt');
    expect(local.steps![2]).not.toHaveProperty('updatedAt');

    // Step-level id and createdAt should also be stripped (remote-specific)
    for (const step of local.steps!) {
      expect(step).not.toHaveProperty('id');
      expect(step).not.toHaveProperty('createdAt');
    }
  });
});

// ── toRemoteSequencePayload ─────────────────────────────────────────────

describe('toRemoteSequencePayload', () => {
  const { nameToId } = makeTemplateMaps();
  const { nameToId: segNameToId } = makeSegmentMaps();

  it('should preserve step order from local array', () => {
    const local: LocalSequenceDto = {
      name: 'Test Sequence',
      language: 'en',
      steps: [
        { emailTemplateName: 'WS_Email_1', name: 'First', type: 'Email', timing: { delay: { value: 0, unit: 'days' } } },
        { emailTemplateName: 'WS_Email_2', name: 'Second', type: 'Email', timing: { delay: { value: 1, unit: 'days' } } },
        { emailTemplateName: 'WS_Email_3', name: 'Third', type: 'Email', timing: { delay: { value: 2, unit: 'days' } } },
      ],
    };

    const payload = toRemoteSequencePayload(local, segNameToId, nameToId);

    expect(payload.steps!.map(s => s.name)).toEqual(['First', 'Second', 'Third']);
    expect(payload.steps![0]).not.toHaveProperty('position');
  });

  it('should pass through timing fields as-is (including null-stripped version)', () => {
    const local: LocalSequenceDto = {
      name: 'Test Sequence',
      language: 'en',
      steps: [
        {
          emailTemplateName: 'WS_Email_1',
          name: 'Step',
          type: 'Email',
          timing: { delay: { value: 0, unit: 'days' } },
        },
      ],
    };

    const payload = toRemoteSequencePayload(local, segNameToId, nameToId);
    expect(payload.steps![0].timing).toEqual({ delay: { value: 0, unit: 'days' } });
  });
});
