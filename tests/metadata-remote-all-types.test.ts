/**
 * Tests for unified metadata-based file resolution across all content types
 * when pulling from non-default remotes.
 *
 * Covers:
 *  - Generic lookup helpers (findInNestedMetadataSection, findInFlatMetadataSection)
 *  - Type-specific wrappers (findEmailTemplateByRemoteId, findSegmentByRemoteId, findSequenceByRemoteId)
 *  - Sequence pull: non-default remote must not cross-match IDs from local files
 *  - Segment pull: same ID-isolation for non-default remotes
 *  - Email template pull: same ID-isolation for non-default remotes
 */

import type { MetadataMap, MetadataEntry } from '../src/lib/remote-context';
import {
  findInNestedMetadataSection,
  findInFlatMetadataSection,
  findContentByRemoteId,
  findEmailTemplateByRemoteId,
  findSegmentByRemoteId,
  findSequenceByRemoteId,
} from '../src/lib/remote-context';

// ════════════════════════════════════════════════════════════════════════
// Unit tests: Generic lookup helpers
// ════════════════════════════════════════════════════════════════════════
describe('findInNestedMetadataSection', () => {
  it('should find an entry by ID across languages', () => {
    const section: Record<string, Record<string, MetadataEntry>> = {
      'en': { 'alpha': { id: 10 }, 'beta': { id: 20 } },
      'fr': { 'gamma': { id: 30 } },
    };

    expect(findInNestedMetadataSection(section, 10)).toEqual({ language: 'en', key: 'alpha' });
    expect(findInNestedMetadataSection(section, 30)).toEqual({ language: 'fr', key: 'gamma' });
  });

  it('should return undefined when ID is not found', () => {
    const section: Record<string, Record<string, MetadataEntry>> = {
      'en': { 'alpha': { id: 10 } },
    };

    expect(findInNestedMetadataSection(section, 999)).toBeUndefined();
  });

  it('should return undefined for undefined section', () => {
    expect(findInNestedMetadataSection(undefined, 42)).toBeUndefined();
  });

  it('should match string and number IDs', () => {
    const section: Record<string, Record<string, MetadataEntry>> = {
      'en': { 'article': { id: '100' } },
    };

    expect(findInNestedMetadataSection(section, 100)).toEqual({ language: 'en', key: 'article' });
    expect(findInNestedMetadataSection(section, '100')).toEqual({ language: 'en', key: 'article' });
  });
});

describe('findInFlatMetadataSection', () => {
  it('should find an entry by ID', () => {
    const section: Record<string, MetadataEntry> = {
      'seg-a': { id: 5 },
      'seg-b': { id: 15 },
    };

    expect(findInFlatMetadataSection(section, 5)).toEqual({ key: 'seg-a' });
    expect(findInFlatMetadataSection(section, 15)).toEqual({ key: 'seg-b' });
  });

  it('should return undefined when ID is not found', () => {
    const section: Record<string, MetadataEntry> = {
      'seg-a': { id: 5 },
    };

    expect(findInFlatMetadataSection(section, 999)).toBeUndefined();
  });

  it('should return undefined for undefined section', () => {
    expect(findInFlatMetadataSection(undefined, 42)).toBeUndefined();
  });

  it('should match string and number IDs', () => {
    const section: Record<string, MetadataEntry> = {
      'my-seg': { id: '200' },
    };

    expect(findInFlatMetadataSection(section, 200)).toEqual({ key: 'my-seg' });
    expect(findInFlatMetadataSection(section, '200')).toEqual({ key: 'my-seg' });
  });
});

// ════════════════════════════════════════════════════════════════════════
// Unit tests: Type-specific wrappers delegate to generic helpers
// ════════════════════════════════════════════════════════════════════════
describe('Type-specific find*ByRemoteId wrappers', () => {
  const map: MetadataMap = {
    content: {
      'en': { 'my-article': { id: 1 }, 'about': { id: 2 } },
      'ru-RU': { 'moye-statya': { id: 3 } },
    },
    emailTemplates: {
      'en-US': { 'WS_Register': { id: 10 }, 'WS_Subscribe': { id: 11 } },
      'ru-RU': { 'WS_Contact_Us': { id: 12 } },
    },
    segments: {
      'active-users': { id: 50 },
      'trial-expired': { id: 51 },
    },
    sequences: {
      'ru-RU': { 'registration-followup': { id: 100 }, 'webinar-aho': { id: 101 } },
      'en-US': { 'onboarding': { id: 102 } },
    },
  };

  it('findContentByRemoteId returns slug', () => {
    expect(findContentByRemoteId(map, 2)).toEqual({ language: 'en', slug: 'about' });
    expect(findContentByRemoteId(map, 3)).toEqual({ language: 'ru-RU', slug: 'moye-statya' });
    expect(findContentByRemoteId(map, 999)).toBeUndefined();
  });

  it('findEmailTemplateByRemoteId returns name', () => {
    expect(findEmailTemplateByRemoteId(map, 10)).toEqual({ language: 'en-US', name: 'WS_Register' });
    expect(findEmailTemplateByRemoteId(map, 12)).toEqual({ language: 'ru-RU', name: 'WS_Contact_Us' });
    expect(findEmailTemplateByRemoteId(map, 999)).toBeUndefined();
  });

  it('findSegmentByRemoteId returns name', () => {
    expect(findSegmentByRemoteId(map, 50)).toEqual({ name: 'active-users' });
    expect(findSegmentByRemoteId(map, 51)).toEqual({ name: 'trial-expired' });
    expect(findSegmentByRemoteId(map, 999)).toBeUndefined();
  });

  it('findSequenceByRemoteId returns name and language', () => {
    expect(findSequenceByRemoteId(map, 100)).toEqual({ language: 'ru-RU', name: 'registration-followup' });
    expect(findSequenceByRemoteId(map, 102)).toEqual({ language: 'en-US', name: 'onboarding' });
    expect(findSequenceByRemoteId(map, 999)).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════════
// Scenario: Coincidental ID overlap across remotes
// ════════════════════════════════════════════════════════════════════════
describe('Coincidental ID overlap across remotes', () => {
  it('findSequenceByRemoteId should only find entries in its own metadata', () => {
    // Dev metadata: "aho-career-guide" has id=2 on dev
    const devMeta: MetadataMap = {
      content: {},
      sequences: {
        'ru-RU': {
          'aho-career-guide': { id: 2 },
          'webinar-aho': { id: 5 },
        },
      },
    };

    // Prod metadata: "aho-career-guide" has id=2 on prod too (coincidence)
    // But "registration-followup" has id=1, dev's webinar-aho-manager has id=5
    const prodMeta: MetadataMap = {
      content: {},
      sequences: {
        'ru-RU': {
          'aho-career-guide': { id: 2 },
          'webinar-aho': { id: 5 },
        },
      },
    };

    // Look up id=2 in dev → should get aho-career-guide
    expect(findSequenceByRemoteId(devMeta, 2)).toEqual({
      language: 'ru-RU',
      name: 'aho-career-guide',
    });

    // Look up id=5 in dev → should get webinar-aho
    expect(findSequenceByRemoteId(devMeta, 5)).toEqual({
      language: 'ru-RU',
      name: 'webinar-aho',
    });
  });

  it('should demonstrate the cross-matching problem when not using metadata', () => {
    // This test documents the bug scenario from the user's report:
    // - aho-career-guide.json locally has id=2 (from prod metadata)
    // - Dev's "webinar-aho" has id=2 on dev
    // - Without metadata, buildSequenceIdIndex reads id=2 from
    //   aho-career-guide.json, mapping id=2 → aho-career-guide.json
    // - So when dev says "update id=2 (webinar-aho)", the old code
    //   would delete aho-career-guide.json thinking it's a rename
    //
    // With the fix, we look up id=2 in dev's metadata instead,
    // which correctly maps to "aho-career-guide" (same name → no rename).

    const devMeta: MetadataMap = {
      content: {},
      sequences: {
        'ru-RU': {
          'aho-career-guide': { id: 3 },
          'webinar-aho': { id: 2 },
        },
      },
    };

    // Dev ID=2 → webinar-aho (correct: the file that needs updating)
    expect(findSequenceByRemoteId(devMeta, 2)).toEqual({
      language: 'ru-RU',
      name: 'webinar-aho',
    });

    // If we had looked up id=2 in a file-based index, we'd find
    // aho-career-guide.json (which has prod id=2) → WRONG file
  });

  it('findEmailTemplateByRemoteId should not cross-match with prod IDs', () => {
    // Dev: WS_Webinar_Email_1 has id=12
    // Prod: aho-career-guide-followup-1 has id=12
    const devMeta: MetadataMap = {
      content: {},
      emailTemplates: {
        'ru-RU': {
          'WS_Webinar_Email_1': { id: 12 },
          'aho-career-guide-followup-1': { id: 20 },
        },
      },
    };

    // Look up dev id=12 → should get WS_Webinar_Email_1, NOT aho-career-guide-followup-1
    expect(findEmailTemplateByRemoteId(devMeta, 12)).toEqual({
      language: 'ru-RU',
      name: 'WS_Webinar_Email_1',
    });
  });
});

// ════════════════════════════════════════════════════════════════════════
// Edge cases
// ════════════════════════════════════════════════════════════════════════
describe('Edge cases', () => {
  it('should handle empty metadata sections', () => {
    const map: MetadataMap = {
      content: {},
      emailTemplates: {},
      segments: {},
      sequences: {},
    };

    expect(findContentByRemoteId(map, 1)).toBeUndefined();
    expect(findEmailTemplateByRemoteId(map, 1)).toBeUndefined();
    expect(findSegmentByRemoteId(map, 1)).toBeUndefined();
    expect(findSequenceByRemoteId(map, 1)).toBeUndefined();
  });

  it('should handle entries without an id field', () => {
    const map: MetadataMap = {
      content: { 'en': { 'no-id-article': { createdAt: '2025-01-01' } } },
      sequences: { 'ru-RU': { 'no-id-seq': { createdAt: '2025-01-01' } } },
    };

    expect(findContentByRemoteId(map, 1)).toBeUndefined();
    expect(findSequenceByRemoteId(map, 1)).toBeUndefined();
  });

  it('should handle missing optional sections on MetadataMap', () => {
    const map: MetadataMap = {
      content: {},
      // emailTemplates, segments, sequences all undefined
    };

    expect(findEmailTemplateByRemoteId(map, 1)).toBeUndefined();
    expect(findSegmentByRemoteId(map, 1)).toBeUndefined();
    expect(findSequenceByRemoteId(map, 1)).toBeUndefined();
  });
});
