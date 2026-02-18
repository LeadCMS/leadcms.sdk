/**
 * Integration test for three-way merge with real-world JSON content
 *
 * Reproduces a real-world scenario where:
 * - Base (from API baseItems) has the original content
 * - Local file has user edits (acceptLabel, declineLabel changed)
 * - Remote has server edits (policyLinkHref, author changed)
 *
 * Expected: auto-merge without conflicts (changes are on different fields)
 * Previously bugged due to:
 *   1. Timestamp precision mismatch between API base and local file (7 vs 6 decimal places)
 *   2. Adjacent line changes being coalesced into a single conflict region by line-based diff
 *
 * Fixed by using structural (field-level) JSON merge instead of line-based diff3.
 */

import { threeWayMerge, threeWayMergeJson, isLocallyModified } from '../src/lib/content-merge';
import { transformRemoteToLocalFormat, ContentTypeMap } from '../src/lib/content-transformation';

// ── Real-world data from the sync API ──────────────────────────────────

const baseDtoFromApi = {
  id: 105,
  createdAt: '2026-02-10T13:34:55.710288Z',
  updatedAt: '2026-02-13T10:32:20.2939836Z', // Note: 7 decimal places
  comments: null,
  translations: null,
  title: 'Cookie Banner Configuration',
  description: 'Configuration for the cookie consent banner and analytics tracking settings.',
  body: '{\n  "cookieBanner": {\n    "message": "We use cookies to improve your experience and measure site usage. Learn more in our",\n    "policyLinkLabel": "Privacy Policy",\n    "policyLinkHref": "/legal/privacy",\n    "acceptLabel": "Accept",\n    "declineLabel": "Decline",\n    "gtagid": "G-P32PYST5B6"\n  }\n}',
  coverImageUrl: null,
  coverImageAlt: null,
  slug: 'cookie-banner',
  type: 'component',
  author: 'LeadCMS Team',
  language: 'en',
  translationKey: null,
  category: 'Component',
  tags: [] as string[],
  allowComments: false,
  source: null,
  publishedAt: '2026-02-10T00:00:00Z',
};

const remoteDtoFromApi = {
  id: 105,
  createdAt: '2026-02-10T13:34:55.710288Z',
  updatedAt: '2026-02-18T06:13:00.565218Z',
  comments: null,
  translations: null,
  title: 'Cookie Banner Configuration',
  description: 'Configuration for the cookie consent banner and analytics tracking settings.',
  body: '{\n  "cookieBanner": {\n    "message": "We use cookies to improve your experience and measure site usage. Learn more in our",\n    "policyLinkLabel": "Privacy Policy",\n    "policyLinkHref": "/legal/privacy1",\n    "acceptLabel": "Accept",\n    "declineLabel": "Decline",\n    "gtagid": "G-P32PYST5B6"\n  }\n}',
  coverImageUrl: null,
  coverImageAlt: null,
  slug: 'cookie-banner',
  type: 'component',
  author: 'Peter Liapin',
  language: 'en',
  translationKey: null,
  category: 'Component',
  tags: [] as string[],
  allowComments: false,
  source: null,
  publishedAt: '2026-02-10T00:00:00Z',
};

// The actual local file content (user edited acceptLabel and declineLabel)
const localFileContent = JSON.stringify({
  cookieBanner: {
    message: 'We use cookies to improve your experience and measure site usage. Learn more in our',
    policyLinkLabel: 'Privacy Policy',
    policyLinkHref: '/legal/privacy',
    acceptLabel: 'Accept1',
    declineLabel: 'Decline1',
    gtagid: 'G-P32PYST5B6',
  },
  id: 105,
  createdAt: '2026-02-10T13:34:55.710288Z',
  updatedAt: '2026-02-13T10:32:20.293983Z', // Note: 6 decimal places (different from API)
  title: 'Cookie Banner Configuration',
  description: 'Configuration for the cookie consent banner and analytics tracking settings.',
  slug: 'cookie-banner',
  type: 'component',
  author: 'LeadCMS Team',
  language: 'en',
  category: 'Component',
  tags: [] as string[],
  allowComments: false,
  publishedAt: '2026-02-10T00:00:00Z',
}, null, 2);

const typeMap: ContentTypeMap = { component: 'JSON' };

describe('three-way merge - real world JSON scenario', () => {
  it('should auto-merge when local changes acceptLabel/declineLabel and remote changes policyLinkHref/author', async () => {
    // Transform the DTOs to local file format (same as the pull flow does)
    const baseTransformed = await transformRemoteToLocalFormat(baseDtoFromApi, typeMap);
    const remoteTransformed = await transformRemoteToLocalFormat(remoteDtoFromApi, typeMap);

    // The local file should be detected as modified
    expect(isLocallyModified(baseTransformed, localFileContent)).toBe(true);

    // Perform the three-way merge (using structural JSON merge, same as pull flow)
    const result = threeWayMergeJson(baseTransformed, localFileContent, remoteTransformed);

    // This should be a clean merge — changes are on different lines/fields
    expect(result.success).toBe(true);
    expect(result.hasConflicts).toBe(false);
    expect(result.conflictCount).toBe(0);

    // Verify the merged content contains both local and remote changes
    const merged = JSON.parse(result.merged);
    expect(merged.cookieBanner.acceptLabel).toBe('Accept1');      // local change preserved
    expect(merged.cookieBanner.declineLabel).toBe('Decline1');     // local change preserved
    expect(merged.cookieBanner.policyLinkHref).toBe('/legal/privacy1'); // remote change applied
    expect(merged.author).toBe('Peter Liapin');                    // remote change applied

    // updatedAt should take the remote value (always accept remote timestamps)
    expect(merged.updatedAt).toBe('2026-02-18T06:13:00.565218Z');
  });

  it('should not produce false updatedAt conflict from timestamp precision mismatch', async () => {
    const baseTransformed = await transformRemoteToLocalFormat(baseDtoFromApi, typeMap);
    const remoteTransformed = await transformRemoteToLocalFormat(remoteDtoFromApi, typeMap);

    const result = threeWayMergeJson(baseTransformed, localFileContent, remoteTransformed);

    // The merged content should NOT contain conflict markers
    expect(result.merged).not.toContain('<<<<<<< local');
    expect(result.merged).not.toContain('=======');
    expect(result.merged).not.toContain('>>>>>>> remote');
  });

  it('should auto-merge when only remote changes author and updatedAt (local has no changes)', async () => {
    // Use a local file that is identical to the base (no local modifications)
    const baseTransformed = await transformRemoteToLocalFormat(baseDtoFromApi, typeMap);
    const remoteTransformed = await transformRemoteToLocalFormat(remoteDtoFromApi, typeMap);

    // When local file matches base exactly, it should just take remote
    const result = threeWayMergeJson(baseTransformed, baseTransformed, remoteTransformed);

    expect(result.success).toBe(true);
    expect(result.hasConflicts).toBe(false);

    const merged = JSON.parse(result.merged);
    expect(merged.author).toBe('Peter Liapin');
    expect(merged.updatedAt).toBe('2026-02-18T06:13:00.565218Z');
    expect(merged.cookieBanner.policyLinkHref).toBe('/legal/privacy1');
  });
});
