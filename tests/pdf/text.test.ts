/// <reference types="node" />
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { sanitizeForFont, wrapLine, wrapRuns } from '../../src/lib/pdf/text';
import type { TextRun } from '../../src/lib/text-runs';

let font: PDFFont;
let lato: PDFFont;
beforeAll(async () => {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  font = await doc.embedFont(StandardFonts.Helvetica);
  lato = await doc.embedFont(readFileSync(resolve(__dirname, '../../public/fonts/lato/Lato-Regular.ttf')), {
    subset: true,
  });
});

describe('sanitizeForFont', () => {
  it('leaves plain and accented Latin text alone', () => {
    const r = sanitizeForFont('José Núñez, 123 Main St', font);
    expect(r.text).toBe('José Núñez, 123 Main St');
    expect(r.replaced).toEqual([]);
  });

  it('replaces characters the font cannot encode with ? and reports them', () => {
    const r = sanitizeForFont('Zoë ❤ Łukasz', font);
    expect(r.text).toBe('Zoë ? ?ukasz');
    expect(r.replaced).toEqual(['❤', 'Ł']);
  });

  it('replaces characters an embedded font lacks', () => {
    const r = sanitizeForFont('Zoë 😀 Rd', lato);
    expect(r.text).toBe('Zoë ? Rd');
    expect(r.replaced).toEqual(['😀']);
  });

  it('normalizes decomposed characters to NFC before encoding', () => {
    const r = sanitizeForFont('e\u0301', font);
    expect(r.text).toBe('\u00e9');
    expect(r.replaced).toEqual([]);
  });
});

describe('wrapLine', () => {
  const at12 = (s: string) => font.widthOfTextAtSize(s, 12);

  it('returns the line unchanged when it fits', () => {
    expect(wrapLine('123 Main St', at12, 500)).toEqual(['123 Main St']);
  });

  it('wraps at spaces when too wide', () => {
    const width = font.widthOfTextAtSize('1234 Very Long Street Name', 12);
    const out = wrapLine('1234 Very Long Street Name Apartment 5B', at12, width);
    expect(out.length).toBeGreaterThan(1);
    for (const piece of out) expect(font.widthOfTextAtSize(piece, 12)).toBeLessThanOrEqual(width);
    expect(out.join(' ')).toBe('1234 Very Long Street Name Apartment 5B');
  });

  it('breaks a single word that is too wide by characters', () => {
    const out = wrapLine('Supercalifragilistic', at12, 40);
    expect(out.length).toBeGreaterThan(1);
    expect(out.join('')).toBe('Supercalifragilistic');
    for (const piece of out) {
      if ([...piece].length > 1) expect(font.widthOfTextAtSize(piece, 12)).toBeLessThanOrEqual(40);
    }
  });

  it('never emits empty strings when a single character is wider than maxWidth', () => {
    expect(wrapLine('WW', at12, 1)).toEqual(['W', 'W']);
  });

  it('returns a single empty string for empty input', () => {
    expect(wrapLine('', at12, 100)).toEqual(['']);
  });
});

describe('wrapRuns', () => {
  const plainAt12 = (r: TextRun) => font.widthOfTextAtSize(r.text, 12);
  const text = (lines: TextRun[][]) => lines.map((l) => l.map((r) => r.text).join(''));
  // Plain characters are 10 pt wide, bold ones 12 pt.
  const fake = (r: TextRun) => [...r.text].length * (r.bold ? 12 : 10);

  it('returns the runs unchanged when they fit', () => {
    expect(wrapRuns([{ text: '123 ' }, { text: 'Main', bold: true }, { text: ' St' }], plainAt12, 500)).toEqual([
      [{ text: '123 ' }, { text: 'Main', bold: true }, { text: ' St' }],
    ]);
  });

  it('wraps at spaces when too wide', () => {
    const width = font.widthOfTextAtSize('1234 Very Long Street Name', 12);
    const out = wrapRuns([{ text: '1234 Very Long Street Name Apartment 5B' }], plainAt12, width);
    expect(out.length).toBeGreaterThan(1);
    for (const line of text(out)) expect(font.widthOfTextAtSize(line, 12)).toBeLessThanOrEqual(width);
    expect(text(out).join(' ')).toBe('1234 Very Long Street Name Apartment 5B');
  });

  it('matches wrapLine for a single plain run', () => {
    const line = '1234 Very Long Street Name Apartment 5B Supercalifragilistic';
    for (const width of [40, 90, 150, 300, 1000]) {
      expect(text(wrapRuns([{ text: line }], plainAt12, width))).toEqual(wrapLine(line, (s) => font.widthOfTextAtSize(s, 12), width));
    }
  });

  it('breaks a single word that is too wide by characters', () => {
    const out = wrapRuns([{ text: 'Supercalifragilistic' }], plainAt12, 40);
    expect(out.length).toBeGreaterThan(1);
    expect(text(out).join('')).toBe('Supercalifragilistic');
  });

  it('never emits empty lines when a single character is wider than maxWidth', () => {
    expect(wrapRuns([{ text: 'WW' }], plainAt12, 1)).toEqual([[{ text: 'W' }], [{ text: 'W' }]]);
  });

  it('returns one empty line for empty input', () => {
    expect(wrapRuns([], plainAt12, 100)).toEqual([[]]);
    expect(wrapRuns([{ text: '' }, { text: '', bold: true }], plainAt12, 100)).toEqual([[]]);
  });

  it('keeps each word in its run style across a wrap', () => {
    // "Jane Doe" = 5 * 10 + 3 * 12 = 86; adding " Smith" (bold space) would make 158.
    expect(wrapRuns([{ text: 'Jane ' }, { text: 'Doe Smith', bold: true }, { text: ' Jr' }], fake, 90)).toEqual([
      [{ text: 'Jane ' }, { text: 'Doe', bold: true }],
      [{ text: 'Smith', bold: true }, { text: ' Jr' }],
    ]);
  });

  it('measures each run with its own style', () => {
    // Plain "AAA BBB" is 70 wide and fits in 75; with BBB bold it is 76 and must wrap.
    expect(text(wrapRuns([{ text: 'AAA BBB' }], fake, 75))).toEqual(['AAA BBB']);
    expect(wrapRuns([{ text: 'AAA ' }, { text: 'BBB', bold: true }], fake, 75)).toEqual([
      [{ text: 'AAA' }],
      [{ text: 'BBB', bold: true }],
    ]);
  });

  it('breaks a word that spans runs by characters, keeping each character style', () => {
    expect(wrapRuns([{ text: 'Jo' }, { text: 'hn', italic: true }], fake, 25)).toEqual([
      [{ text: 'Jo' }],
      [{ text: 'hn', italic: true }],
    ]);
  });

  it('merges adjacent runs of the same style in its output', () => {
    expect(wrapRuns([{ text: 'a', bold: true }, { text: 'b', bold: true, italic: false }], fake, 100)).toEqual([
      [{ text: 'ab', bold: true }],
    ]);
  });
});
