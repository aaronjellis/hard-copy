import { describe, it, expect } from 'vitest';
import { mergeRuns, runStyle, sameStyle } from '../src/lib/text-runs';

describe('style helpers', () => {
  it('runStyle fills both flags', () => {
    expect(runStyle({ text: 'a' })).toEqual({ bold: false, italic: false });
    expect(runStyle({ text: 'a', bold: true })).toEqual({ bold: true, italic: false });
  });

  it('sameStyle ignores false versus missing', () => {
    expect(sameStyle({ text: 'a', bold: false }, { text: 'b' })).toBe(true);
    expect(sameStyle({ text: 'a', italic: true }, { text: 'b' })).toBe(false);
  });
});

describe('mergeRuns', () => {
  it('concatenates parts, merging neighbors with equal style and dropping empty runs', () => {
    expect(
      mergeRuns(
        [{ text: 'a', bold: true }, { text: '' }],
        [{ text: 'b', bold: true, italic: false }, { text: 'c', italic: true }],
        [],
        [{ text: 'd', italic: true }],
      ),
    ).toEqual([{ text: 'ab', bold: true }, { text: 'cd', italic: true }]);
  });

  it('returns fresh runs without false flags and does not mutate its input', () => {
    const input = [{ text: 'a', bold: false }, { text: 'b' }];
    const copy = structuredClone(input);
    const out = mergeRuns(input);
    expect(out).toEqual([{ text: 'ab' }]);
    expect(input).toEqual(copy);
    expect(mergeRuns([{ text: 'x' }])[0]).not.toBe(input[0]);
  });

  it('returns an empty list for no input', () => {
    expect(mergeRuns()).toEqual([]);
  });
});

