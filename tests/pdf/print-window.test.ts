import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PRINT_DPI,
  MAX_PRINT_MEGAPIXELS,
  PRINT_SHELL_HTML,
  PrintTooLongError,
  fillPrintWindow,
  formatInches,
  maxImagePrintPages,
  openPrintWindow,
  pageMegapixels,
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
    const err = new PrintTooLongError(75, 42);
    expect(err.name).toBe('PrintTooLongError');
    expect(err.message).toContain('75 pages');
    expect(err.message).toContain('up to 42 pages this size');
  });

  it('returns null outside a browser instead of throwing', () => {
    expect(typeof window).toBe('undefined');
    expect(openPrintWindow()).toBeNull();
  });
});

describe('image print cap', () => {
  it('prints at 150 DPI with a cap of 60 pages of 1.5 MP', () => {
    expect(DEFAULT_PRINT_DPI).toBe(150);
    expect(MAX_PRINT_MEGAPIXELS).toBe(90);
  });

  it('measures page area in megapixels at the print resolution', () => {
    // Letter at 150 DPI: 1275 × 1650 px.
    expect(pageMegapixels(612, 792)).toBeCloseTo(1275 * 1650 / 1e6, 6);
    expect(pageMegapixels(612, 792, 300)).toBeCloseTo(4 * 1275 * 1650 / 1e6, 6);
  });

  it('caps pages by area, so larger paper prints fewer pages', () => {
    const letter = maxImagePrintPages(612, 792);
    const tabloid = maxImagePrintPages(792, 1224);
    expect(letter).toBe(Math.floor(90 / (1275 * 1650 / 1e6))); // 42
    expect(tabloid).toBeLessThan(letter);
    expect(maxImagePrintPages(612 * 20, 792 * 20)).toBe(1);
    // A small page fits more than 60.
    expect(maxImagePrintPages(216, 360)).toBeGreaterThan(60);
  });

  it('revokes the page URLs at once when the window is already closed', () => {
    const revoked: string[] = [];
    const original = globalThis.URL.revokeObjectURL;
    globalThis.URL.revokeObjectURL = (url: string) => void revoked.push(url);
    try {
      fillPrintWindow({ closed: true } as Window, [{ url: 'blob:a', widthIn: 8.5, heightIn: 11 }]);
      expect(revoked).toEqual(['blob:a']);
    } finally {
      globalThis.URL.revokeObjectURL = original;
    }
  });
});

