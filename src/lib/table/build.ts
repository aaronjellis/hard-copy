import {
  PDFDocument, fill, lineTo, moveTo, popGraphicsState, pushGraphicsState, rectangle, rgb, setFillingColor,
  setLineWidth, setStrokingColor, stroke, type PDFFont, type PDFOperator, type RGB,
} from 'pdf-lib';
import { createDocFonts } from '../pdf/fonts-doc';
import { fontRefKey, type FontProvider } from '../fonts/types';
import { resolveSlot } from '../setup/hf';
import { LINE_HEIGHT, PADDING_PT, layoutTable, type Align, type LayoutInput, type Page, type PlacedRow, type PrintLayout } from './layout';

/** What the builder needs: a layout input without `measure`, which the builder makes from the real font. */
export type BuildInput = Omit<LayoutInput, 'measure'>;

export type TablePdf = {
  bytes: Uint8Array;
  /** Pages in the whole layout; the document holds `drawnPages.length` of them. */
  pageCount: number;
  /** Layout page indexes (from 0) drawn into this document, in document order. */
  drawnPages: number[];
  /** Characters replaced with '?' because the font lacks them, per drawn page (numbered from 1 in the layout), each listed once. */
  warnings: { page: number; replaced: string[] }[];
  /** Faces embedded whole instead of subset (see DocFonts.subsetFallbacks). */
  subsetFallbacks: string[];
  /** The layout needed a scale below MIN_SCALE and was clamped. */
  tooSmall: boolean;
  /** The printable area holds no table (see PrintLayout.noRoom); the one page has bands only. */
  noRoom: boolean;
  /** Column bands the table splits into. */
  bandCount: number;
  /** Per layout page, in print order: its column band and its half-open range of printed-row positions. */
  pages: PageInfo[];
};

const REGULAR = { bold: false, italic: false };
const BOLD = { bold: true, italic: false };
const BLACK = rgb(0, 0, 0);
const BAND_GRAY = '#666666';
const GRID_WIDTH = 0.5;
const HEX = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
/** Text the builder can add beyond the sheet: the truncation ellipsis, the replacement mark, page numbers. */
const EXTRA_GLYPHS = '…?0123456789';

/** A `#rrggbb` color as a pdf-lib RGB color. Throws on anything else. */
export function hexToRgb(hex: string): RGB {
  const m = HEX.exec(hex);
  if (!m) throw new Error(`Not a #rrggbb color: ${hex}`);
  return rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
}

/** Where a page sits in the print order, for the preview caption. */
export type PageInfo = { band: number; rowStart: number; rowEnd: number };

/**
 * A laid-out table, ready to draw: everything `drawPages` needs, without a PDF document. Fonts are
 * re-embedded per output document (cheap: font bytes and subset verdicts are cached by identity).
 */
export type PreparedTable = {
  input: BuildInput;
  fonts: FontProvider;
  layout: PrintLayout;
  /** The id of the lead column (the first column printed on band 0), or null when nothing prints. */
  leadId: string | null;
  /** Width of `text` at size 1 in the regular or bold face, cached; the same metrics `layoutTable` used. */
  widthAt1: (text: string, bold: boolean) => number;
  pageCount: number;
  /** Pages tall: rows of pages per column band (pageCount / bandCount). */
  pagesTall: number;
  bandCount: number;
  tooSmall: boolean;
  noRoom: boolean;
  pages: PageInfo[];
  /** Characters the font lacks, per page (numbered from 1), across every page. */
  warnings: { page: number; replaced: string[] }[];
  subsetFallbacks: string[];
};

/**
 * Measure and lay out a table with the body font's real metrics, without drawing. The layout runs
 * once here; `drawPages` draws any subset of its pages into a new PDF.
 */
export async function prepareTable(input: BuildInput, fonts: FontProvider): Promise<PreparedTable> {
  const { style } = input.setup;
  const doc = await PDFDocument.create();
  const docFonts = await createDocFonts(doc, fonts, new Map([[fontRefKey(style.font), sheetText(input)]]));
  const regular = await docFonts.get(style.font, REGULAR);
  const bold = style.header.bold || style.leadColumn.bold ? await docFonts.get(style.font, BOLD) : regular;

  // Width at size 1 per (text, face), of the sanitized text; reused by the layout and by drawing.
  const missing = new Set<string>();
  const caches = [new Map<string, number>(), new Map<string, number>()];
  const widthAt1 = (text: string, isBold: boolean) => {
    const cache = caches[isBold ? 1 : 0];
    let w = cache.get(text);
    if (w === undefined) {
      const font = isBold ? bold : regular;
      const s = docFonts.sanitize(text, font);
      for (const ch of s.replaced) missing.add(ch);
      w = font.widthOfTextAtSize(s.text, 1);
      cache.set(text, w);
    }
    return w;
  };

  const layout = layoutTable({ ...input, measure: (text, size, { bold: isBold }) => widthAt1(text, isBold) * size });

  // The lead column is the first column printed on band 0. Later bands show it only when it repeats and fits,
  // so every page matches columns against this id instead of assuming position.
  const leadId = layout.pages.find((p) => p.band === 0 && p.columns.length > 0)?.columns[0].id ?? null;

  // Band text is not measured by the layout; check it here so a missing glyph there is reported too.
  const missingIn = (text: string, isBold: boolean) => docFonts.sanitize(text, isBold ? bold : regular).replaced;
  for (const p of layout.pages) {
    for (const t of [...p.bands.headerText, ...p.bands.footerText]) for (const ch of missingIn(t, false)) missing.add(ch);
  }
  // Most sheets have no missing characters; only then is every page scanned to say where they are.
  const warnings = missing.size > 0 ? replacedPerPage(layout, leadId, style, missingIn) : [];

  const pageCount = layout.pages.length;
  return {
    input,
    fonts,
    layout,
    leadId,
    widthAt1,
    pageCount,
    pagesTall: Math.max(1, Math.round(pageCount / layout.bandCount)),
    bandCount: layout.bandCount,
    tooSmall: layout.tooSmall,
    noRoom: layout.noRoom,
    pages: layout.pages.map((p) => ({ band: p.band, rowStart: p.rowStart, rowEnd: p.rowEnd })),
    warnings,
    subsetFallbacks: [...docFonts.subsetFallbacks],
  };
}

/** Characters replaced on each page, scanning only when some text has a character the font lacks. */
function replacedPerPage(
  layout: PrintLayout,
  leadId: string | null,
  style: BuildInput['setup']['style'],
  missingIn: (text: string, bold: boolean) => string[],
): PreparedTable['warnings'] {
  const out: PreparedTable['warnings'] = [];
  for (const p of layout.pages) {
    const replaced: string[] = [];
    const add = (chars: string[]) => {
      for (const ch of chars) if (!replaced.includes(ch)) replaced.push(ch);
    };
    for (const row of p.header ? [p.header, ...p.rows] : p.rows) {
      const isHeader = row.index === -1;
      row.cells.forEach((cell, k) => {
        const isBold = isHeader ? style.header.bold : p.columns[k]?.id === leadId && style.leadColumn.bold;
        for (const line of cell.lines) add(missingIn(line, isBold));
      });
    }
    for (const t of [...p.bands.headerText, ...p.bands.footerText]) add(missingIn(t, false));
    if (replaced.length > 0) out.push({ page: p.index + 1, replaced });
  }
  return out;
}

/**
 * Draw pages of a prepared table into a new PDF: `'all'` for the whole document, or page indexes
 * (from 0, in the order given). Out-of-range indexes are skipped.
 *
 * Lines: `page.gridlines` draws the cell grid (0.5 pt, `style.borderColor`); `style.borders: 'none'`
 * suppresses every line, so the grid draws only when gridlines are on and borders are not none.
 */
export async function drawPages(prepared: PreparedTable, pageIndexes: number[] | 'all'): Promise<TablePdf> {
  const { input, layout, leadId, widthAt1 } = prepared;
  const { setup } = input;
  const { style, hf } = setup;
  const doc = await PDFDocument.create();
  const docFonts = await createDocFonts(doc, prepared.fonts, new Map([[fontRefKey(style.font), sheetText(input)]]));

  const regular = await docFonts.get(style.font, REGULAR);
  // Embed the bold face only when something prints bold.
  const bold = style.header.bold || style.leadColumn.bold ? await docFonts.get(style.font, BOLD) : regular;
  const faceFor = (isBold: boolean) => (isBold ? bold : regular);

  const headerColor = style.header.color ? hexToRgb(style.header.color) : BLACK;
  const bandColor = hexToRgb(BAND_GRAY);
  const borderColor = hexToRgb(style.borderColor);
  const warnings: TablePdf['warnings'] = [];
  const chosen = pageIndexes === 'all'
    ? layout.pages
    : pageIndexes.map((i) => layout.pages[i]).filter((p): p is Page => p !== undefined);

  for (const p of chosen) {
    const page = doc.addPage([p.widthPt, p.heightPt]);
    const replaced: string[] = [];
    /**
     * Draw one line of text. `at` is the left edge, or a function of the text's width for centered and
     * right-aligned text; the width is looked up (cached per text) only then.
     */
    const draw = (text: string, isBold: boolean, size: number, at: number | ((width: number) => number), y: number, color: RGB) => {
      if (text === '') return;
      const font = faceFor(isBold);
      const s = docFonts.sanitize(text, font);
      for (const ch of s.replaced) if (!replaced.includes(ch)) replaced.push(ch);
      const x = typeof at === 'number' ? at : at(widthAt1(text, isBold) * size);
      page.drawText(s.text, { x, y, size, font, color });
    };

    const placed = p.header ? [p.header, ...p.rows] : p.rows;

    page.pushOperators(...fills(p, leadId, style));
    if (setup.page.gridlines && style.borders !== 'none') page.pushOperators(...grid(p, placed, borderColor));

    // Cell text.
    const pad = PADDING_PT[style.padding] * p.scale;
    const lineH = LINE_HEIGHT * p.fontSize;
    for (const row of placed) {
      const isHeader = row.index === -1;
      row.cells.forEach((cell, k) => {
        const isBold = isHeader ? style.header.bold : p.columns[k]?.id === leadId && style.leadColumn.bold;
        const font = faceFor(isBold);
        const color = isHeader ? headerColor : BLACK;
        const blockTop = row.y + (row.height + cell.lines.length * lineH) / 2;
        const at = cell.align === 'left' ? cell.x + pad : (w: number) => alignX(cell.align, cell.x, cell.width, pad, w);
        cell.lines.forEach((line, i) => {
          draw(line, isBold, p.fontSize, at, baseline(font, p.fontSize, blockTop - i * lineH, lineH), color);
        });
      });
    }

    // Header and footer bands: unscaled, at the printable edges, centered in the band.
    const { bands } = p;
    const left = layout.printable.x;
    const right = left + layout.printable.width;
    const slotX: (number | ((w: number) => number))[] = [
      left,
      (w: number) => (left + right - w) / 2,
      (w: number) => right - w,
    ];
    const band = (text: [string, string, string], bottom: number) => {
      if (text.every((t) => t === '')) return;
      const y = baseline(regular, hf.size, bottom + bands.bandSize, bands.bandSize);
      text.forEach((t, i) => draw(t, false, hf.size, slotX[i], y, bandColor));
    };
    band(bands.headerText, bands.headerY);
    band(bands.footerText, bands.footerY);

    if (replaced.length > 0) warnings.push({ page: p.index + 1, replaced });
  }

  return {
    bytes: await doc.save(),
    pageCount: prepared.pageCount,
    drawnPages: chosen.map((p) => p.index),
    warnings,
    subsetFallbacks: docFonts.subsetFallbacks,
    tooSmall: prepared.tooSmall,
    noRoom: prepared.noRoom,
    bandCount: prepared.bandCount,
    pages: prepared.pages,
  };
}

/** Lay out and draw a whole table as a PDF: `drawPages(await prepareTable(input, fonts), 'all')`. */
export async function buildTablePdf(input: BuildInput, fonts: FontProvider): Promise<TablePdf> {
  return drawPages(await prepareTable(input, fonts), 'all');
}

/**
 * Every character the document can draw in the body font, so subsetting keeps every glyph: column names,
 * cells, and header/footer text (page numbers are covered by the digits in EXTRA_GLYPHS).
 */
function sheetText(input: BuildInput): string {
  const parts: string[] = [EXTRA_GLYPHS];
  for (const c of input.columns) parts.push(c.name);
  for (const row of input.rows) parts.push(...row);
  const slotCtx = { ...input.ctx, page: 1, pageCount: 1 };
  for (const slot of [...input.setup.hf.header, ...input.setup.hf.footer]) parts.push(resolveSlot(slot, slotCtx));
  return parts.join('\n');
}

/**
 * Background fills: header row, zebra stripes on every second data row of the page, lead column.
 * The lead fill covers data rows only; the header row's lead cell keeps the header fill, so header
 * text stays on the background its color was chosen for.
 */
function fills(p: Page, leadId: string | null, style: BuildInput['setup']['style']): PDFOperator[] {
  const ops: PDFOperator[] = [];
  const rect = (x: number, y: number, w: number, h: number, color: string) =>
    ops.push(setFillingColor(hexToRgb(color)), rectangle(x, y, w, h), fill());
  const first = p.columns[0];
  const last = p.columns[p.columns.length - 1];
  if (!first) return ops;
  const tableWidth = last.x + last.width - first.x;

  if (p.header && style.header.fill) rect(first.x, p.header.y, tableWidth, p.header.height, style.header.fill);
  if (style.zebra.on) {
    p.rows.forEach((row, i) => {
      if (i % 2 === 1) rect(first.x, row.y, tableWidth, row.height, style.zebra.color);
    });
  }
  const leadFill = style.leadColumn.fill;
  const lead = leadId === null ? undefined : p.columns.find((c) => c.id === leadId);
  if (lead && leadFill) {
    for (const row of p.rows) rect(lead.x, row.y, lead.width, row.height, leadFill);
  }
  return ops.length > 0 ? [pushGraphicsState(), ...ops, popGraphicsState()] : ops;
}

/** The cell grid: a horizontal line at every row boundary and a vertical line at every column boundary. */
function grid(p: Page, rows: PlacedRow[], color: RGB): PDFOperator[] {
  if (rows.length === 0 || p.columns.length === 0) return [];
  const last = p.columns[p.columns.length - 1];
  const left = p.columns[0].x;
  const right = last.x + last.width;
  const top = rows[0].y + rows[0].height;
  const bottom = rows[rows.length - 1].y;
  const ops: PDFOperator[] = [pushGraphicsState(), setLineWidth(GRID_WIDTH), setStrokingColor(color)];
  for (const y of [top, ...rows.map((r) => r.y)]) ops.push(moveTo(left, y), lineTo(right, y));
  for (const x of [...p.columns.map((c) => c.x), right]) ops.push(moveTo(x, top), lineTo(x, bottom));
  ops.push(stroke(), popGraphicsState());
  return ops;
}

/** The left edge of a line `width` points wide in a cell, inset by `pad`. */
function alignX(align: Align, x: number, cellWidth: number, pad: number, width: number): number {
  if (align === 'right') return x + cellWidth - pad - width;
  if (align === 'center') return x + (cellWidth - width) / 2;
  return x + pad;
}

/** The baseline of a line of text whose line box is `lineH` tall with its top at `top`, glyphs centered in the box. */
function baseline(font: PDFFont, size: number, top: number, lineH: number): number {
  const full = font.heightAtSize(size);
  const ascent = font.heightAtSize(size, { descender: false });
  return top - (lineH - full) / 2 - ascent;
}
