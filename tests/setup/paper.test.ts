import { describe, it, expect } from 'vitest';
import {
  PAPER_SIZES, PAPER_IDS, MARGIN_PRESETS, CUSTOM_PAPER_MIN_IN, CUSTOM_PAPER_MAX_IN,
  resolvePaper, marginsForPreset, marginPresetOf,
} from '../../src/lib/setup/paper';

const portrait = { customWidthIn: 8.5, customHeightIn: 11, landscape: false };

describe('paper sizes', () => {
  it('lists the standard sizes in inches', () => {
    expect(PAPER_SIZES.letter).toMatchObject({ widthIn: 8.5, heightIn: 11 });
    expect(PAPER_SIZES.legal).toMatchObject({ widthIn: 8.5, heightIn: 14 });
    expect(PAPER_SIZES.tabloid).toMatchObject({ widthIn: 11, heightIn: 17 });
    expect(PAPER_SIZES.a4).toMatchObject({ widthIn: 8.27, heightIn: 11.69 });
    expect(PAPER_SIZES.a3).toMatchObject({ widthIn: 11.69, heightIn: 16.54 });
    expect(PAPER_IDS).toEqual(['letter', 'legal', 'tabloid', 'a4', 'a3', 'custom']);
  });

  it('gives every size a label', () => {
    for (const size of Object.values(PAPER_SIZES)) expect(size.label).toMatch(/\S/);
  });

  it('resolves a standard size to points', () => {
    expect(resolvePaper({ ...portrait, paper: 'letter' })).toEqual({ widthPt: 612, heightPt: 792 });
    expect(resolvePaper({ ...portrait, paper: 'a4' })).toEqual({ widthPt: 8.27 * 72, heightPt: 11.69 * 72 });
  });

  it('swaps width and height in landscape', () => {
    expect(resolvePaper({ ...portrait, paper: 'letter', landscape: true })).toEqual({ widthPt: 792, heightPt: 612 });
    expect(resolvePaper({ ...portrait, paper: 'tabloid', landscape: true })).toEqual({ widthPt: 17 * 72, heightPt: 11 * 72 });
  });

  it('uses the custom dimensions for custom paper', () => {
    expect(resolvePaper({ paper: 'custom', customWidthIn: 5, customHeightIn: 7, landscape: false })).toEqual({ widthPt: 360, heightPt: 504 });
    expect(resolvePaper({ paper: 'custom', customWidthIn: 5, customHeightIn: 7, landscape: true })).toEqual({ widthPt: 504, heightPt: 360 });
  });

  it('clamps custom dimensions to 3–48 in', () => {
    expect(CUSTOM_PAPER_MIN_IN).toBe(3);
    expect(CUSTOM_PAPER_MAX_IN).toBe(48);
    expect(resolvePaper({ paper: 'custom', customWidthIn: 1, customHeightIn: 100, landscape: false })).toEqual({ widthPt: 3 * 72, heightPt: 48 * 72 });
    expect(resolvePaper({ paper: 'custom', customWidthIn: NaN, customHeightIn: 7, landscape: false }).widthPt).toBe(3 * 72);
  });
});

describe('margin presets', () => {
  it('defines normal, narrow, and wide in inches', () => {
    expect(MARGIN_PRESETS).toEqual({ normal: 0.75, narrow: 0.5, wide: 1 });
  });

  it('expands a preset to four equal margins', () => {
    expect(marginsForPreset('narrow')).toEqual({ top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 });
  });

  it('recognizes a preset, or reports custom', () => {
    expect(marginPresetOf(marginsForPreset('wide'))).toBe('wide');
    expect(marginPresetOf({ top: 0.75, right: 0.75, bottom: 0.75, left: 0.75 })).toBe('normal');
    expect(marginPresetOf({ top: 0.75, right: 0.5, bottom: 0.75, left: 0.75 })).toBe('custom');
  });
});
