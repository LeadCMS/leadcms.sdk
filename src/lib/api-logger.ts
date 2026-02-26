/**
 * Axios interceptors for verbose API request/response logging.
 *
 * Registers global axios interceptors that log:
 * - Request: method, URL, masked auth header, body preview
 * - Response: status, URL, timing, body preview
 *
 * Only produces output when verbose mode is active (--verbose / -V).
 * Large payloads are intelligently truncated so the console stays readable.
 */

import axios, { type InternalAxiosRequestConfig, type AxiosResponse, type AxiosError } from 'axios';
import { isVerbose } from './logger.js';

// ── Payload summarisation ────────────────────────────────────────────────

const MAX_STRING_PREVIEW = 120;   // max chars for a single string value
const MAX_ARRAY_ITEMS = 3;     // how many array items to preview inline
const MAX_DEPTH = 2;     // how deep to recurse into objects
const MAX_BODY_LINES = 12;    // max lines for the formatted body block

/**
 * Redact sensitive header values for safe console output.
 */
function maskHeaders(headers: Record<string, any>): Record<string, string> {
    const safe: Record<string, string> = {};
    for (const [key, val] of Object.entries(headers)) {
        if (!val) continue;
        const strVal = String(val);
        if (key.toLowerCase() === 'authorization') {
            const parts = strVal.split(' ');
            safe[key] = parts.length === 2
                ? `${parts[0]} ${parts[1].substring(0, 8)}…`
                : '***';
        } else if (key.toLowerCase() === 'content-type') {
            safe[key] = strVal;
        }
        // skip other headers to keep output short
    }
    return safe;
}

/**
 * Produce a compact, human-readable summary of a JSON-ish value.
 * Strings are truncated, arrays show length + first N items, objects show keys.
 */
function summarise(value: unknown, depth = 0): string {
    if (value === null || value === undefined) return String(value);

    if (typeof value === 'string') {
        if (value.length <= MAX_STRING_PREVIEW) return JSON.stringify(value);
        return JSON.stringify(value.slice(0, MAX_STRING_PREVIEW)) + `… (${value.length} chars)`;
    }

    if (typeof value === 'number' || typeof value === 'boolean') return String(value);

    if (Array.isArray(value)) {
        if (value.length === 0) return '[]';
        if (depth >= MAX_DEPTH) return `[…${value.length} items]`;
        const preview = value
            .slice(0, MAX_ARRAY_ITEMS)
            .map(v => summarise(v, depth + 1))
            .join(', ');
        const more = value.length > MAX_ARRAY_ITEMS ? `, …+${value.length - MAX_ARRAY_ITEMS} more` : '';
        return `[${preview}${more}] (${value.length})`;
    }

    if (typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        const keys = Object.keys(obj);
        if (keys.length === 0) return '{}';
        if (depth >= MAX_DEPTH) return `{${keys.length} keys}`;

        const parts: string[] = [];
        for (const key of keys) {
            const v = obj[key];
            // Long body-like fields get extra truncation
            if (typeof v === 'string' && v.length > MAX_STRING_PREVIEW && isContentField(key)) {
                parts.push(`${key}: "${v.slice(0, 80)}…" (${v.length} chars)`);
            } else {
                parts.push(`${key}: ${summarise(v, depth + 1)}`);
            }
        }
        return `{ ${parts.join(', ')} }`;
    }

    return String(value);
}

/** Fields that typically hold large content */
function isContentField(key: string): boolean {
    return /^(body|bodyTemplate|content|description|data|html|markdown|text)$/i.test(key);
}

/**
 * Format payload for multi-line verbose output, capped to MAX_BODY_LINES.
 */
function formatPayload(data: unknown): string {
    if (data === undefined || data === null) return '  (empty)';

    // Binary / buffer — just show size
    if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
        const size = Buffer.isBuffer(data) ? data.length : (data as ArrayBuffer).byteLength;
        return `  <binary ${(size / 1024).toFixed(1)} KB>`;
    }

    // FormData — not JSON-serialisable
    if (typeof data === 'object' && typeof (data as any).getHeaders === 'function') {
        return '  <multipart/form-data>';
    }

    const summary = summarise(data);
    const lines = summary.split('\n');
    if (lines.length > MAX_BODY_LINES) {
        return lines.slice(0, MAX_BODY_LINES).map(l => `  ${l}`).join('\n') + `\n  … (${lines.length - MAX_BODY_LINES} more lines)`;
    }
    return lines.map(l => `  ${l}`).join('\n');
}

// ── Timing tracker ───────────────────────────────────────────────────────

const pendingRequests = new Map<string, number>();

function requestKey(config: InternalAxiosRequestConfig): string {
    return `${config.method?.toUpperCase()} ${config.url} ${Date.now()}`;
}

// ── Interceptor registration ─────────────────────────────────────────────

let registered = false;

/**
 * Register global axios interceptors for verbose API logging.
 * Safe to call multiple times — interceptors are only registered once.
 */
export function registerApiLogger(): void {
    if (registered) return;
    registered = true;

    // ── Request interceptor ──
    axios.interceptors.request.use(
        (config: InternalAxiosRequestConfig) => {
            if (!isVerbose()) return config;

            const method = (config.method || 'GET').toUpperCase();
            const url = config.url || '?';
            const key = requestKey(config);
            (config as any).__logKey = key;
            pendingRequests.set(key, Date.now());

            const parts: string[] = [];
            parts.push(`┌─ ${method} ${url}`);

            // Headers (masked)
            const headers = maskHeaders(config.headers || {});
            if (Object.keys(headers).length) {
                parts.push(`│  headers: ${JSON.stringify(headers)}`);
            }

            // Query params
            if (config.params && Object.keys(config.params).length) {
                parts.push(`│  params:  ${JSON.stringify(config.params)}`);
            }

            // Body preview (POST/PUT/PATCH)
            if (config.data !== undefined && config.data !== null) {
                parts.push(`│  body:`);
                parts.push(formatPayload(config.data).split('\n').map(l => `│  ${l.trimStart()}`).join('\n'));
            }

            console.log(parts.join('\n'));
            return config;
        },
        (error: AxiosError) => {
            if (isVerbose()) {
                console.error(`┌─ REQUEST ERROR: ${error.message}`);
            }
            return Promise.reject(error);
        },
    );

    // ── Response interceptor ──
    axios.interceptors.response.use(
        (response: AxiosResponse) => {
            if (!isVerbose()) return response;

            const key = (response.config as any).__logKey as string | undefined;
            let duration = '';
            if (key && pendingRequests.has(key)) {
                const ms = Date.now() - pendingRequests.get(key)!;
                pendingRequests.delete(key);
                duration = ` (${ms}ms)`;
            }

            const method = (response.config.method || 'GET').toUpperCase();
            const url = response.config.url || '?';
            const status = response.status;

            const parts: string[] = [];
            parts.push(`└─ ${status} ${method} ${url}${duration}`);

            // Body preview
            if (response.data !== undefined && response.data !== null) {
                // For 204 No Content there is nothing useful
                if (status !== 204) {
                    parts.push(`   body:`);
                    parts.push(formatPayload(response.data).split('\n').map(l => `   ${l.trimStart()}`).join('\n'));
                }
            }

            console.log(parts.join('\n'));
            return response;
        },
        (error: AxiosError) => {
            if (isVerbose()) {
                const key = (error.config as any)?.__logKey as string | undefined;
                let duration = '';
                if (key && pendingRequests.has(key)) {
                    const ms = Date.now() - pendingRequests.get(key)!;
                    pendingRequests.delete(key);
                    duration = ` (${ms}ms)`;
                }

                const method = (error.config?.method || '?').toUpperCase();
                const url = error.config?.url || '?';
                const status = error.response?.status || 'NETWORK_ERROR';

                const parts: string[] = [];
                parts.push(`└─ ${status} ${method} ${url}${duration}`);

                if (error.response?.data) {
                    parts.push(`   body:`);
                    parts.push(formatPayload(error.response.data).split('\n').map(l => `   ${l.trimStart()}`).join('\n'));
                } else {
                    parts.push(`   error: ${error.message}`);
                }

                console.error(parts.join('\n'));
            }
            return Promise.reject(error);
        },
    );
}

// Export for testing
export { summarise, maskHeaders, formatPayload };
