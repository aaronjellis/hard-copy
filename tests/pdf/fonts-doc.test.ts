/// <reference types="node" />
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PDFDict, PDFDocument, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream, type PDFFont } from 'pdf-lib';
import { createDocFonts, standardFace } from '../../src/lib/pdf/fonts-doc';
import { subsetSource } from '../../src/lib/pdf/subset-check';
import type { AvailableFaces, FontProvider, FontRef } from '../../src/lib/fonts/types';

// Real subsetSource by default; a test can make one call return null to stand in for a font
// that no copy can subset cleanly.
vi.mock('../../src/lib/pdf/subset-check', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/pdf/subset-check')>();
  return { ...actual, subsetSource: vi.fn(actual.subsetSource) };
});

const fontFile = (name: string) =>
  new Uint8Array(readFileSync(resolve(__dirname, '../../public/fonts/lato', name)));
const latoRegular = fontFile('Lato-Regular.ttf');
const latoBold = fontFile('Lato-Bold.ttf');

const LATO: FontRef = { kind: 'bundled', id: 'lato', family: 'Lato' };
const HELVETICA: FontRef = { kind: 'standard', id: 'helvetica' };
const REGULAR = { bold: false, italic: false };
const BOLD = { bold: true, italic: false };
const ALL_FACES: AvailableFaces = { bold: true, italic: true, boldItalic: true };

function provider(getBytes: FontProvider['getBytes'], faces: AvailableFaces = ALL_FACES): FontProvider {
  return { getBytes: vi.fn(getBytes), availableFaces: async () => faces };
}

const noFonts = provider(async () => {
  throw new Error('standard fonts need no bytes');
});

/** BaseFont names of the saved PDF's font dictionaries, such as `/Helvetica-Bold`. */
async function baseFonts(doc: PDFDocument): Promise<string[]> {
  const saved = await PDFDocument.load(await doc.save());
  return saved.context.enumerateIndirectObjects()
    .map(([, obj]) => obj)
    .filter((o): o is PDFDict => o instanceof PDFDict && o.get(PDFName.of('Type')) === PDFName.of('Font'))
    .filter((d) => d.get(PDFName.of('Subtype')) !== PDFName.of('CIDFontType2'))
    .map((d) => String(d.get(PDFName.of('BaseFont'))));
}

/** The decoded font program of each embedded TrueType font in the saved PDF. */
async function fontPrograms(doc: PDFDocument): Promise<Uint8Array[]> {
  const saved = await PDFDocument.load(await doc.save());
  return saved.context.enumerateIndirectObjects()
    .map(([, obj]) => obj)
    .filter((o): o is PDFDict => o instanceof PDFDict && o.get(PDFName.of('Type')) === PDFName.of('FontDescriptor'))
    .map((d) => decodePDFRawStream(saved.context.lookup(d.get(PDFName.of('FontFile2'))) as PDFRawStream).decode());
}

/** A page that draws `text` in `font`, so the saved PDF keeps the font and its glyphs. */
function draw(doc: PDFDocument, text: string, font: PDFFont) {
  doc.addPage([200, 100]).drawText(text, { x: 10, y: 10, size: 12, font });
}

describe('standardFace', () => {
  it('maps each face of each standard font to its built-in font', () => {
    expect(standardFace('helvetica', REGULAR)).toBe(StandardFonts.Helvetica);
    expect(standardFace('helvetica', { bold: true, italic: true })).toBe(StandardFonts.HelveticaBoldOblique);
    expect(standardFace('times', { bold: false, italic: true })).toBe(StandardFonts.TimesRomanItalic);
    expect(standardFace('times', BOLD)).toBe(StandardFonts.TimesRomanBold);
  });
});

describe('createDocFonts', () => {
  it('embeds Helvetica Bold for standard helvetica bold', async () => {
    const doc = await PDFDocument.create();
    const fonts = await createDocFonts(doc, noFonts);
    draw(doc, 'Total', await fonts.get(HELVETICA, BOLD));
    expect(await baseFonts(doc)).toEqual(['/Helvetica-Bold']);
    expect(noFonts.getBytes).not.toHaveBeenCalled();
  });

  it('embeds a bundled face once when it is requested twice, as a subset', async () => {
    const doc = await PDFDocument.create();
    const lato = provider(async () => latoRegular);
    const fonts = await createDocFonts(doc, lato);
    const [a, b] = await Promise.all([fonts.get(LATO, REGULAR), fonts.get(LATO, REGULAR)]);
    expect(b).toBe(a);
    expect(await fonts.get(LATO, { bold: false, italic: false })).toBe(a);
    expect(lato.getBytes).toHaveBeenCalledTimes(1);
    draw(doc, 'Jane Doe', a);
    const programs = await fontPrograms(doc);
    expect(programs).toHaveLength(1);
    expect(programs[0].length).toBeLessThan(latoRegular.length);
    expect(fonts.subsetFallbacks).toEqual([]);
  });

  it('embeds one font when the provider returns the same bytes for bold and regular', async () => {
    const doc = await PDFDocument.create();
    const lato = provider(async () => latoRegular);
    const fonts = await createDocFonts(doc, lato);
    const regular = await fonts.get(LATO, REGULAR);
    const bold = await fonts.get(LATO, BOLD);
    expect(bold).toBe(regular);
    expect(lato.getBytes).toHaveBeenCalledTimes(2);
    draw(doc, 'Jane Doe', bold);
    expect(await fontPrograms(doc)).toHaveLength(1);
  });

  it('embeds distinct faces separately', async () => {
    const doc = await PDFDocument.create();
    const fonts = await createDocFonts(doc, provider(async (_ref, style) => (style.bold ? latoBold : latoRegular)));
    const regular = await fonts.get(LATO, REGULAR);
    const bold = await fonts.get(LATO, BOLD);
    expect(bold).not.toBe(regular);
  });

  it('uses the nearest face the provider has', async () => {
    const doc = await PDFDocument.create();
    const lato = provider(async () => latoRegular, { bold: false, italic: false, boldItalic: false });
    const fonts = await createDocFonts(doc, lato);
    const boldItalic = await fonts.get(LATO, { bold: true, italic: true });
    expect(boldItalic).toBe(await fonts.get(LATO, REGULAR));
    expect(lato.getBytes).toHaveBeenCalledTimes(1);
    expect(lato.getBytes).toHaveBeenCalledWith(LATO, REGULAR);
  });

  it('names the font and face when the provider has no data', async () => {
    const doc = await PDFDocument.create();
    const fonts = await createDocFonts(doc, provider(async () => null));
    await expect(fonts.get(LATO, BOLD)).rejects.toThrow('No font data for Lato Bold.');
    await expect(fonts.get(LATO, REGULAR)).rejects.toThrow('No font data for Lato.');
  });

  it('names the font and face when the bytes cannot be embedded', async () => {
    const doc = await PDFDocument.create();
    const fonts = await createDocFonts(doc, provider(async () => new Uint8Array([1, 2, 3, 4])));
    await expect(fonts.get(LATO, BOLD)).rejects.toThrow(/^The font Lato Bold could not be used: /);
  });

  it('sanitizes text for a font, replacing characters it cannot encode', async () => {
    const doc = await PDFDocument.create();
    const fonts = await createDocFonts(doc, provider(async () => latoRegular));
    const lato = await fonts.get(LATO, REGULAR);
    expect(fonts.sanitize('Zoë ❤ 東京', lato)).toEqual({ text: 'Zoë ? ??', replaced: ['❤', '東', '京'] });
    const helvetica = await fonts.get(HELVETICA, REGULAR);
    expect(fonts.sanitize('Łukasz', helvetica)).toEqual({ text: '?ukasz', replaced: ['Ł'] });
  });

  it('passes the text drawn in a font to the subset check', async () => {
    const doc = await PDFDocument.create();
    const fonts = await createDocFonts(doc, provider(async () => latoRegular), new Map([['bundled:lato', 'Jane Doe']]));
    await fonts.get(LATO, REGULAR);
    expect(subsetSource).toHaveBeenLastCalledWith(latoRegular, 'Jane Doe');
  });

  it('embeds a face whole and lists it in subsetFallbacks when it cannot be subset', async () => {
    vi.mocked(subsetSource).mockResolvedValueOnce(null);
    const doc = await PDFDocument.create();
    const fonts = await createDocFonts(doc, provider(async () => latoBold));
    draw(doc, 'Jane Doe', await fonts.get(LATO, BOLD));
    expect(fonts.subsetFallbacks).toEqual(['Lato Bold']);
    expect((await fontPrograms(doc)).map((p) => p.length)).toEqual([latoBold.length]);
  });
});
