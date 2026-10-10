import { describe, it, expect } from 'vitest';
import {
  MAX_PRINT_PAGES,
  PRINT_SHELL_HTML,
  PrintTooLongError,
  formatInches,
  openPrintWindow,
  pageSizeCss,
} from '../../src/lib/pdf/print-window';

describe('print window helpers', () => {
  it('sizes the page to Letter landscape from PDF points', () => {
    expect(pageSizeCss(792 / 72, 612 / 72)).toBe('@page { size: 11in 8.5in; margin: 0 }');
  });

  it('rounds inch lengths to 4 decimals', () => {
    expect(formatInches(4.125000000001)).toBe('4.125in');
    expect(formatInches(8.5)).toBe('8.5in');
    expect(formatInches(1 / 3)).toBe('0.3333in');
  });

  it('writes a shell with a wait message and page breaks', () => {
    expect(PRINT_SHELL_HTML.startsWith('<!doctype html>')).toBe(true);
    expect(PRINT_SHELL_HTML).toContain('class="wait"');
    expect(PRINT_SHELL_HTML).toContain('break-after:page');
  });

  it('explains when a PDF is too long to print as images', () => {
    const err = new PrintTooLongError(75, MAX_PRINT_PAGES);
    expect(err.name).toBe('PrintTooLongError');
    expect(err.message).toContain('75 pages');
    expect(err.message).toContain(`up to ${MAX_PRINT_PAGES}`);
  });

  it('returns null outside a browser instead of throwing', () => {
    expect(typeof window).toBe('undefined');
    expect(openPrintWindow()).toBeNull();
  });
});
