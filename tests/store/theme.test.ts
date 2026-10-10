import { describe, it, expect } from 'vitest';
import { resolveTheme, nextThemePreference, themeLabel } from '../../src/lib/store/theme';

describe('theme', () => {
  it('system follows the OS preference', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('explicit choices ignore the OS', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('cycles system -> light -> dark -> system', () => {
    expect(nextThemePreference('system')).toBe('light');
    expect(nextThemePreference('light')).toBe('dark');
    expect(nextThemePreference('dark')).toBe('system');
  });

  it('labels each preference for the toggle button', () => {
    expect(themeLabel('system')).toBe('Theme: System');
    expect(themeLabel('light')).toBe('Theme: Light');
    expect(themeLabel('dark')).toBe('Theme: Dark');
  });
});
