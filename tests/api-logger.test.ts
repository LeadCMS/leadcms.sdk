/**
 * Tests for src/lib/api-logger.ts — verbose axios request/response logging.
 */

import { summarise, maskHeaders, formatPayload } from '../src/lib/api-logger.js';

// ────────────────────────────────────────────────────────────────────────
// summarise()
// ────────────────────────────────────────────────────────────────────────

describe('summarise', () => {
  it('handles null and undefined', () => {
    expect(summarise(null)).toBe('null');
    expect(summarise(undefined)).toBe('undefined');
  });

  it('handles short strings', () => {
    expect(summarise('hello')).toBe('"hello"');
  });

  it('truncates long strings with char count', () => {
    const long = 'a'.repeat(200);
    const result = summarise(long);
    expect(result).toContain('…');
    expect(result).toContain('200 chars');
  });

  it('handles numbers and booleans', () => {
    expect(summarise(42)).toBe('42');
    expect(summarise(true)).toBe('true');
    expect(summarise(false)).toBe('false');
  });

  it('handles empty arrays', () => {
    expect(summarise([])).toBe('[]');
  });

  it('summarises arrays with length', () => {
    const result = summarise([1, 2, 3]);
    expect(result).toContain('(3)');
    expect(result).toContain('1');
    expect(result).toContain('2');
    expect(result).toContain('3');
  });

  it('truncates long arrays with +N more', () => {
    const result = summarise([1, 2, 3, 4, 5, 6]);
    expect(result).toContain('+3 more');
    expect(result).toContain('(6)');
  });

  it('handles empty objects', () => {
    expect(summarise({})).toBe('{}');
  });

  it('summarises objects with key-value pairs', () => {
    const result = summarise({ id: 1, title: 'test' });
    expect(result).toContain('id');
    expect(result).toContain('title');
    expect(result).toContain('"test"');
  });

  it('truncates content-like fields specially', () => {
    const result = summarise({ body: 'x'.repeat(500) });
    expect(result).toContain('chars');
    expect(result.length).toBeLessThan(200);
  });

  it('respects max depth', () => {
    const deep = { a: { b: { c: { d: 'too deep' } } } };
    const result = summarise(deep);
    // At depth 2 it should stop recursing
    expect(result).toContain('keys');
  });
});

// ────────────────────────────────────────────────────────────────────────
// maskHeaders()
// ────────────────────────────────────────────────────────────────────────

describe('maskHeaders', () => {
  it('masks Authorization Bearer token', () => {
    const result = maskHeaders({ Authorization: 'Bearer abc123456789longtoken' });
    expect(result.Authorization).toContain('Bearer');
    expect(result.Authorization).toContain('abc12345');
    expect(result.Authorization).toContain('…');
    expect(result.Authorization).not.toContain('longtoken');
  });

  it('preserves Content-Type', () => {
    const result = maskHeaders({ 'content-type': 'application/json' });
    expect(result['content-type']).toBe('application/json');
  });

  it('omits non-essential headers', () => {
    const result = maskHeaders({
      Authorization: 'Bearer abc12345',
      'content-type': 'application/json',
      'x-request-id': '123',
      accept: '*/*',
    });
    expect(Object.keys(result)).toHaveLength(2);
    expect(result['x-request-id']).toBeUndefined();
    expect(result.accept).toBeUndefined();
  });

  it('masks non-Bearer auth with truncation', () => {
    const result = maskHeaders({ Authorization: 'Basic dXNlcjpwYXNz' });
    expect(result.Authorization).toContain('Basic');
    expect(result.Authorization).toContain('…');
    expect(result.Authorization).not.toContain('dXNlcjpwYXNz');
  });

  it('masks auth with no scheme as ***', () => {
    const result = maskHeaders({ Authorization: 'single-token-no-space' });
    expect(result.Authorization).toBe('***');
  });

  it('skips falsy values', () => {
    const result = maskHeaders({ Authorization: '', 'content-type': null });
    expect(Object.keys(result)).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// formatPayload()
// ────────────────────────────────────────────────────────────────────────

describe('formatPayload', () => {
  it('returns (empty) for null/undefined', () => {
    expect(formatPayload(null)).toContain('(empty)');
    expect(formatPayload(undefined)).toContain('(empty)');
  });

  it('handles Buffer as binary', () => {
    const buf = Buffer.alloc(2048);
    const result = formatPayload(buf);
    expect(result).toContain('binary');
    expect(result).toContain('KB');
  });

  it('handles FormData-like objects', () => {
    const fakeFD = { getHeaders: () => ({}) };
    const result = formatPayload(fakeFD);
    expect(result).toContain('multipart/form-data');
  });

  it('summarises JSON objects compactly', () => {
    const data = { id: 1, title: 'Test Post', body: 'x'.repeat(500) };
    const result = formatPayload(data);
    expect(result).toContain('id');
    expect(result).toContain('title');
    expect(result).toContain('chars');
  });

  it('summarises arrays with count', () => {
    const data = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
    const result = formatPayload(data);
    expect(result).toContain('(5)');
  });
});

// ────────────────────────────────────────────────────────────────────────
// registerApiLogger() — interceptor registration
// ────────────────────────────────────────────────────────────────────────

describe('registerApiLogger', () => {
  let mockUseRequest: jest.Mock;
  let mockUseResponse: jest.Mock;

  beforeEach(() => {
    jest.resetModules();
    mockUseRequest = jest.fn();
    mockUseResponse = jest.fn();
  });

  it('registers request and response interceptors once', async () => {
    jest.doMock('axios', () => {
      const m: any = jest.fn();
      m.interceptors = {
        request: { use: mockUseRequest },
        response: { use: mockUseResponse },
      };
      m.default = m;
      return { __esModule: true, default: m };
    });

    const { registerApiLogger } = await import('../src/lib/api-logger.js');

    registerApiLogger();
    expect(mockUseRequest).toHaveBeenCalledTimes(1);
    expect(mockUseResponse).toHaveBeenCalledTimes(1);

    // Second call is a no-op
    registerApiLogger();
    expect(mockUseRequest).toHaveBeenCalledTimes(1);
    expect(mockUseResponse).toHaveBeenCalledTimes(1);
  });

  it('request interceptor logs method and URL when verbose', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => { });

    // Capture the interceptor callback
    let requestInterceptor: Function = () => { };
    jest.doMock('axios', () => {
      const m: any = jest.fn();
      m.interceptors = {
        request: {
          use: jest.fn((cb: Function) => { requestInterceptor = cb; }),
        },
        response: { use: jest.fn() },
      };
      m.default = m;
      return { __esModule: true, default: m };
    });

    // Enable verbose
    const loggerMod = await import('../src/lib/logger.js');
    loggerMod.setVerbose(true);

    const { registerApiLogger: reg } = await import('../src/lib/api-logger.js');
    reg();

    // Simulate a request
    const config = {
      method: 'post',
      url: 'https://api.test.com/content',
      headers: { Authorization: 'Bearer abc123456789', 'content-type': 'application/json' },
      data: { title: 'Test', body: 'Hello world' },
    };
    requestInterceptor(config);

    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('POST');
    expect(output).toContain('https://api.test.com/content');
    expect(output).toContain('body');

    consoleSpy.mockRestore();
    loggerMod.setVerbose(false);
  });

  it('response interceptor logs status and body preview when verbose', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => { });

    let responseInterceptor: Function = () => { };
    jest.doMock('axios', () => {
      const m: any = jest.fn();
      m.interceptors = {
        request: { use: jest.fn() },
        response: {
          use: jest.fn((cb: Function) => { responseInterceptor = cb; }),
        },
      };
      m.default = m;
      return { __esModule: true, default: m };
    });

    const loggerMod = await import('../src/lib/logger.js');
    loggerMod.setVerbose(true);

    const { registerApiLogger: reg } = await import('../src/lib/api-logger.js');
    reg();

    const response = {
      status: 200,
      config: { method: 'get', url: 'https://api.test.com/content' },
      data: [{ id: 1, title: 'Post 1' }, { id: 2, title: 'Post 2' }],
    };
    responseInterceptor(response);

    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('200');
    expect(output).toContain('GET');
    expect(output).toContain('(2)');

    consoleSpy.mockRestore();
    loggerMod.setVerbose(false);
  });

  it('interceptors are silent when verbose is off', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => { });

    let requestInterceptor: Function = () => { };
    let responseInterceptor: Function = () => { };
    jest.doMock('axios', () => {
      const m: any = jest.fn();
      m.interceptors = {
        request: {
          use: jest.fn((cb: Function) => { requestInterceptor = cb; }),
        },
        response: {
          use: jest.fn((cb: Function) => { responseInterceptor = cb; }),
        },
      };
      m.default = m;
      return { __esModule: true, default: m };
    });

    const loggerMod = await import('../src/lib/logger.js');
    loggerMod.setVerbose(false);

    const { registerApiLogger: reg } = await import('../src/lib/api-logger.js');
    reg();

    requestInterceptor({
      method: 'get',
      url: 'https://api.test.com/test',
      headers: {},
    });

    responseInterceptor({
      status: 200,
      config: { method: 'get', url: 'https://api.test.com/test' },
      data: { ok: true },
    });

    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
