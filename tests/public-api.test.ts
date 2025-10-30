import { isValidLocaleCode } from '../src/index';

describe('Public API - isValidLocaleCode export', () => {
  it('should be importable from the main package', () => {
    expect(typeof isValidLocaleCode).toBe('function');
  });

  it('should work as expected when imported', () => {
    expect(isValidLocaleCode('en')).toBe(true);
    expect(isValidLocaleCode('en-US')).toBe(true);
    expect(isValidLocaleCode('zh-Hans')).toBe(true);
    expect(isValidLocaleCode('invalid')).toBe(false);
    expect(isValidLocaleCode('blog')).toBe(false);
  });
});
