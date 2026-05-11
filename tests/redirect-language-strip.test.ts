/**
 * Tests for single-language optimisation helpers in automation-types.ts
 *
 * When a LeadCMS instance is configured for a single language, `fromLanguage`
 * and `toLanguage` are omitted from `redirects.yaml` (written via
 * `stripDefaultLanguage`) and re-injected when reading back
 * (`injectDefaultLanguage`). This keeps the YAML tidy for the common case.
 */

import {
    stripDefaultLanguage,
    injectDefaultLanguage,
    type LocalRedirect,
} from '../src/lib/automation-types';

const LANG = 'en';

// ── Helpers ────────────────────────────────────────────────────────────

function slug(overrides: Partial<LocalRedirect> = {}): LocalRedirect {
    return {
        kind: 'Permanent',
        fromSlug: 'my-article',
        fromLanguage: LANG,
        toSlug: 'new-article',
        toLanguage: LANG,
        ...overrides,
    };
}

function path(overrides: Partial<LocalRedirect> = {}): LocalRedirect {
    return {
        kind: 'Permanent',
        fromPath: '/old',
        toPath: '/new',
        ...overrides,
    };
}

// ── stripDefaultLanguage ───────────────────────────────────────────────

describe('stripDefaultLanguage', () => {
    it('removes fromLanguage and toLanguage when they equal the default', () => {
        const result = stripDefaultLanguage([slug()], LANG);
        expect(result[0].fromLanguage).toBeUndefined();
        expect(result[0].toLanguage).toBeUndefined();
    });

    it('preserves fromLanguage when it differs from default', () => {
        const r = slug({ fromLanguage: 'de' });
        const result = stripDefaultLanguage([r], LANG);
        expect(result[0].fromLanguage).toBe('de');
    });

    it('preserves toLanguage when it differs from default', () => {
        const r = slug({ toLanguage: 'fr' });
        const result = stripDefaultLanguage([r], LANG);
        expect(result[0].toLanguage).toBe('fr');
    });

    it('leaves path redirects (no language fields) untouched', () => {
        const r = path();
        const result = stripDefaultLanguage([r], LANG);
        expect(result[0].fromLanguage).toBeUndefined();
        expect(result[0].toLanguage).toBeUndefined();
        expect(result[0].fromPath).toBe('/old');
        expect(result[0].toPath).toBe('/new');
    });

    it('does not mutate the original array or objects', () => {
        const original = slug();
        stripDefaultLanguage([original], LANG);
        expect(original.fromLanguage).toBe(LANG);
        expect(original.toLanguage).toBe(LANG);
    });

    it('handles mixed redirects correctly', () => {
        const r1 = slug(); // should be stripped
        const r2 = slug({ fromLanguage: 'de', toLanguage: 'de' }); // kept
        const r3 = path(); // no language
        const result = stripDefaultLanguage([r1, r2, r3], LANG);
        expect(result[0].fromLanguage).toBeUndefined();
        expect(result[0].toLanguage).toBeUndefined();
        expect(result[1].fromLanguage).toBe('de');
        expect(result[1].toLanguage).toBe('de');
        expect(result[2].fromLanguage).toBeUndefined();
    });
});

// ── injectDefaultLanguage ──────────────────────────────────────────────

describe('injectDefaultLanguage', () => {
    it('injects fromLanguage for ContentSlug redirect missing it', () => {
        const r = slug({ fromLanguage: undefined });
        const result = injectDefaultLanguage([r], LANG);
        expect(result[0].fromLanguage).toBe(LANG);
    });

    it('injects toLanguage for ContentSlug redirect missing it', () => {
        const r = slug({ toLanguage: undefined });
        const result = injectDefaultLanguage([r], LANG);
        expect(result[0].toLanguage).toBe(LANG);
    });

    it('does not overwrite an explicit fromLanguage', () => {
        const r = slug({ fromLanguage: 'de' });
        const result = injectDefaultLanguage([r], LANG);
        expect(result[0].fromLanguage).toBe('de');
    });

    it('does not inject fromLanguage for path redirects (no fromSlug)', () => {
        const r = path();
        const result = injectDefaultLanguage([r], LANG);
        expect(result[0].fromLanguage).toBeUndefined();
    });

    it('does not inject toLanguage for path-target redirects (no toSlug)', () => {
        const r: LocalRedirect = {
            kind: 'Permanent',
            fromSlug: 'article',
            fromLanguage: LANG,
            toPath: '/new',
        };
        const result = injectDefaultLanguage([r], LANG);
        expect(result[0].toLanguage).toBeUndefined();
    });

    it('does not mutate the original objects', () => {
        const original = slug({ fromLanguage: undefined });
        injectDefaultLanguage([original], LANG);
        expect(original.fromLanguage).toBeUndefined();
    });
});

// ── Round-trip ─────────────────────────────────────────────────────────

describe('round-trip: strip → inject', () => {
    it('restores ContentSlug language fields after strip → inject', () => {
        const original = slug(); // both fromLanguage and toLanguage = 'en'
        const stripped = stripDefaultLanguage([original], LANG);
        expect(stripped[0].fromLanguage).toBeUndefined();
        expect(stripped[0].toLanguage).toBeUndefined();
        const restored = injectDefaultLanguage(stripped, LANG);
        expect(restored[0].fromLanguage).toBe(LANG);
        expect(restored[0].toLanguage).toBe(LANG);
    });

    it('preserves non-default language through strip → inject', () => {
        const original = slug({ fromLanguage: 'de', toLanguage: 'de' });
        const stripped = stripDefaultLanguage([original], LANG);
        expect(stripped[0].fromLanguage).toBe('de');
        const restored = injectDefaultLanguage(stripped, LANG);
        // de ≠ en, so it was not stripped and inject doesn't overwrite
        expect(restored[0].fromLanguage).toBe('de');
    });
});
