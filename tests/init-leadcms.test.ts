/**
 * Tests for init-leadcms.ts - isValidUrl and initLeadCMS export
 */

import { isValidUrl, initLeadCMS } from '../src/scripts/init-leadcms';

describe('init-leadcms - initLeadCMS export', () => {
    it('should export initLeadCMS as a function', () => {
        expect(typeof initLeadCMS).toBe('function');
    });
});

describe('init-leadcms - isValidUrl', () => {
    it('should accept valid https URL', () => {
        expect(isValidUrl('https://leadcms.example.com')).toBe(true);
    });

    it('should accept valid http URL', () => {
        expect(isValidUrl('http://localhost:3000')).toBe(true);
    });

    it('should accept https URL with path', () => {
        expect(isValidUrl('https://example.com/cms')).toBe(true);
    });

    it('should accept https URL with port', () => {
        expect(isValidUrl('https://example.com:8443')).toBe(true);
    });

    it('should reject ftp protocol', () => {
        expect(isValidUrl('ftp://example.com')).toBe(false);
    });

    it('should reject empty string', () => {
        expect(isValidUrl('')).toBe(false);
    });

    it('should reject plain text', () => {
        expect(isValidUrl('not-a-url')).toBe(false);
    });

    it('should reject URL without protocol', () => {
        expect(isValidUrl('example.com')).toBe(false);
    });

    it('should reject javascript: protocol', () => {
        expect(isValidUrl('javascript:alert(1)')).toBe(false);
    });

    it('should reject data: URLs', () => {
        expect(isValidUrl('data:text/html,<h1>Hello</h1>')).toBe(false);
    });

    it('should reject file: protocol', () => {
        expect(isValidUrl('file:///etc/passwd')).toBe(false);
    });

    it('should accept URL with subdomain', () => {
        expect(isValidUrl('https://cms.app.example.com')).toBe(true);
    });
});
