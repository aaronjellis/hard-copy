/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { canSubsetSafely, padGlyphs, subsetSource } from '../../src/lib/pdf/subset-check';

const read = (path: string) => new Uint8Array(readFileSync(resolve(__dirname, '../..', path)));
const LOBSTER = 'tests/fixtures/Lobster-Regular.ttf';
const LATO = 'public/fonts/lato/Lato-Regular.ttf';

describe('canSubsetSafely', () => {
  it('rejects Lobster, whose subset glyphs come out corrupt', async () => {
    expect(await canSubsetSafely(read('tests/fixtures/Lobster-Regular.ttf'), 'Testing line 1')).toBe(false);
  });

  it('accepts Lato, which subsets cleanly', async () => {
    expect(await canSubsetSafely(read('public/fonts/lato/Lato-Regular.ttf'), 'Testing line 1')).toBe(true);
  });

  it('returns false for bytes that are not a font, without throwing', async () => {
    expect(await canSubsetSafely(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 'abc')).toBe(false);
  });

  it('caches the verdict per bytes, so later text does not change it', async () => {
    const lato = read('public/fonts/lato/Lato-Regular.ttf');
    expect(await canSubsetSafely(lato, 'A')).toBe(true);
    expect(await canSubsetSafely(lato, 'something else entirely')).toBe(true);
  });

  it('accepts empty text, checking the probe glyphs alone', async () => {
    expect(await canSubsetSafely(read('public/fonts/lato/Lato-Regular.ttf'), '')).toBe(true);
    expect(await canSubsetSafely(read('tests/fixtures/Lobster-Regular.ttf'), '')).toBe(false);
  });
});

describe('padGlyphs', () => {
  it('pads a font with odd-length glyphs so its subset decodes', async () => {
    const padded = padGlyphs(read(LOBSTER));
    expect(padded).not.toBeNull();
    expect(await canSubsetSafely(padded!, 'Testing line 1')).toBe(true);
  });

  it('keeps every glyph outline, metric, and the character map', () => {
    const original = fontkit.create(read(LOBSTER));
    const padded = fontkit.create(padGlyphs(read(LOBSTER))!);
    expect(padded.numGlyphs).toBe(original.numGlyphs);
    expect(padded.characterSet).toEqual(original.characterSet);
    for (let id = 0; id < original.numGlyphs; id++) {
      const a = original.getGlyph(id), b = padded.getGlyph(id);
      expect(b.path.toSVG()).toBe(a.path.toSVG());
      expect(b.advanceWidth).toBe(a.advanceWidth);
    }
  });

  it('returns null for a font whose glyphs are already even-length', () => {
    expect(padGlyphs(read(LATO))).toBeNull();
  });

  it('returns null for bytes that are not a TrueType font', () => {
    expect(padGlyphs(new Uint8Array([0, 1, 0, 0, 0, 9, 0, 0]))).toBeNull();
    expect(padGlyphs(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe('subsetSource', () => {
  it('returns the font itself when it subsets cleanly', async () => {
    const lato = read(LATO);
    expect(await subsetSource(lato, 'Jane Doe')).toBe(lato);
  });

  it('returns the same padded copy, every time, when padding repairs the subset', async () => {
    const lobster = read(LOBSTER);
    const first = await subsetSource(lobster, 'Jane Doe');
    expect(first).not.toBeNull();
    expect(first).not.toBe(lobster);
    expect(await subsetSource(lobster, 'Something else')).toBe(first);
  });

  it('returns null for bytes that are not a font', async () => {
    expect(await subsetSource(new Uint8Array([1, 2, 3, 4]), 'abc')).toBeNull();
  });
});
