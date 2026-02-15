/**
 * Tests for generate-env-js.ts pure functions
 * Covers: filterEnvVars, generateEnvJsContent
 */

import { filterEnvVars, generateEnvJsContent } from '../src/scripts/generate-env-js';

describe('generate-env-js', () => {
    describe('filterEnvVars', () => {
        it('should filter variables by NEXT_PUBLIC_ prefix', () => {
            const env = {
                NEXT_PUBLIC_API_URL: 'https://api.example.com',
                NEXT_PUBLIC_SITE_NAME: 'My Site',
                SECRET_KEY: 'supersecret',
                DATABASE_URL: 'postgres://...',
            };

            const result = filterEnvVars(env);
            expect(Object.keys(result)).toHaveLength(2);
            expect(result.NEXT_PUBLIC_API_URL).toBe('https://api.example.com');
            expect(result.NEXT_PUBLIC_SITE_NAME).toBe('My Site');
            expect(result).not.toHaveProperty('SECRET_KEY');
            expect(result).not.toHaveProperty('DATABASE_URL');
        });

        it('should return empty object when no matching vars exist', () => {
            const env = {
                SECRET_KEY: 'value',
                DATABASE_URL: 'value',
            };

            const result = filterEnvVars(env);
            expect(Object.keys(result)).toHaveLength(0);
        });

        it('should handle empty env object', () => {
            const result = filterEnvVars({});
            expect(Object.keys(result)).toHaveLength(0);
        });

        it('should use custom prefix', () => {
            const env = {
                VITE_API_URL: 'https://api.example.com',
                VITE_APP_NAME: 'My App',
                NEXT_PUBLIC_URL: 'should-not-match',
            };

            const result = filterEnvVars(env, 'VITE_');
            expect(Object.keys(result)).toHaveLength(2);
            expect(result.VITE_API_URL).toBe('https://api.example.com');
            expect(result.VITE_APP_NAME).toBe('My App');
        });

        it('should preserve undefined values', () => {
            const env: Record<string, string | undefined> = {
                NEXT_PUBLIC_DEFINED: 'value',
                NEXT_PUBLIC_UNDEFINED: undefined,
            };

            const result = filterEnvVars(env);
            expect(Object.keys(result)).toHaveLength(2);
            expect(result.NEXT_PUBLIC_DEFINED).toBe('value');
            expect(result.NEXT_PUBLIC_UNDEFINED).toBeUndefined();
        });
    });

    describe('generateEnvJsContent', () => {
        it('should generate valid window.__env assignment', () => {
            const vars = {
                NEXT_PUBLIC_API_URL: 'https://api.example.com',
                NEXT_PUBLIC_SITE_NAME: 'My Site',
            };

            const content = generateEnvJsContent(vars);
            expect(content).toContain('window.__env =');
            expect(content).toContain('"NEXT_PUBLIC_API_URL"');
            expect(content).toContain('"https://api.example.com"');
            expect(content.endsWith(';\n')).toBe(true);
        });

        it('should generate valid JSON in the output', () => {
            const vars = {
                NEXT_PUBLIC_KEY: 'value',
            };

            const content = generateEnvJsContent(vars);
            // Extract the JSON part
            const jsonStr = content.replace('window.__env = ', '').replace(';\n', '');
            const parsed = JSON.parse(jsonStr);
            expect(parsed.NEXT_PUBLIC_KEY).toBe('value');
        });

        it('should handle empty vars object', () => {
            const content = generateEnvJsContent({});
            expect(content).toBe('window.__env = {};\n');
        });

        it('should handle special characters in values', () => {
            const vars = {
                NEXT_PUBLIC_URL: 'https://example.com/path?key=val&other=123',
            };

            const content = generateEnvJsContent(vars);
            const jsonStr = content.replace('window.__env = ', '').replace(';\n', '');
            const parsed = JSON.parse(jsonStr);
            expect(parsed.NEXT_PUBLIC_URL).toBe('https://example.com/path?key=val&other=123');
        });

        it('should produce pretty-printed JSON with 2-space indent', () => {
            const vars = {
                NEXT_PUBLIC_A: 'a',
                NEXT_PUBLIC_B: 'b',
            };

            const content = generateEnvJsContent(vars);
            // Should contain newlines and indentation (pretty-printed)
            expect(content).toContain('\n');
            expect(content).toContain('  "NEXT_PUBLIC_A"');
        });
    });
});
