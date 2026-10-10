import {
  PDFDocument, fill, lineTo, moveTo, popGraphicsState, pushGraphicsState, rectangle, rgb, setFillingColor,
  setLineWidth, setStrokingColor, stroke, type PDFFont, type PDFOperator, type RGB,
} from 'pdf-lib';
import { createDocFonts } from '../pdf/fonts-doc';
import { fontRefKey, type FontProvider } from '../fonts/types';
import { resolveSlot } from '../setup/hf';
import { LINE_HEIGHT, PADDING_PT, layoutTable, type Align, type LayoutInput, type Page, type PlacedRow } from './layout';

/** What the builder needs: a layout input without `measure`, which the builder makes from the real font. */
export type BuildInput = Omit<LayoutInput, 'measure'>;

export type TablePdf = {
  bytes: Uint8Array;
  pageCount: number;
  /** Characters replaced with '?' because the font lacks them, per page (numbered from 1), each listed once. */
  warnings: { page: number; replaced: string[] }[];
  /** Faces embedded whole instead of subset (see DocFonts.subsetFallbacks). */
  subsetFallbacks: string[];
  /** The layout needed a scale below MIN_SCALE and was clamped. */
  tooSmall: boolean;
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

/**
 * Lay out and draw a table as a PDF. The layout runs here, measuring text with the body font's real
 * metrics, so the PDF matches the layout exactly.
 *
 * Lines: `page.gridlines` draws the cell grid (0.5 pt, `style.borderColor`); `style.borders: 'none'`
 * suppresses every line, so the grid draws only when gridlines are on and borders are not none.
 */
export async function buildTablePdf(input: BuildInput, fonts: FontProvider): Promise<TablePdf> {
  const { setup } = input;
  const { style, hf } = setup;
  const doc = await PDFDocument.create();
  const docFonts = await createDocFonts(doc, fonts, new Map([[fontRefKey(style.font), sheetText(input)]]));

  const regular = await docFonts.get(style.font, REGULAR);
  // Embed the bold face only when something prints bold.
  const bold = style.header.bold || style.leadColumn.bold ? await docFonts.get(style.font, BOLD) : regular;
  const faceFor = (isBold: boolean) => (isBold ? bold : regular);
  const clean = (text: string, font: PDFFont) => docFonts.sanitize(text, font);

  const layout = layoutTable({
    ...input,
    measure: (text, size, { bold: isBold }) => {
      const font = faceFor(isBold);
      return font.widthOfTextAtSize(clean(text, font).text, size);
    },
  });

  const repeatLead = style.leadColumn.fill !== null || style.leadColumn.bold;
  const headerColor = style.header.color ? hexToRgb(style.header.color) : BLACK;
  const bandColor = hexToRgb(BAND_GRAY);
  const warnings: TablePdf['warnings'] = [];

  for (const p of layout.pages) {
    const page = doc.addPage([p.widthPt, p.heightPt]);
    const replaced: string[] = [];
    const draw = (text: string, font: PDFFont, size: number, at: (width: number) => number, y: number, color: RGB) => {
      if (text === '') return;
      const s = clean(text, font);
      for (const ch of s.replaced) if (!replaced.includes(ch)) replaced.push(ch);
      page.drawText(s.text, { x: at(font.widthOfTextAtSize(s.text, size)), y, size, font, color });
    };

    // The lead column is the page's first column on band 0, and on every band when it repeats.
    const leadOnPage = p.columns.length > 0 && (p.band === 0 || repeatLead);
    const placed = p.header ? [p.header, ...p.rows] : p.rows;

    page.pushOperators(...fills(p, leadOnPage, setup.style));
    if (setup.page.gridlines && style.borders !== 'none') page.pushOperators(...grid(p, placed, hexToRgb(style.borderColor)));

    // Cell text.
    const pad = PADDING_PT[style.padding] * p.scale;
    const lineH = LINE_HEIGHT * p.fontSize;
    for (const row of placed) {
      const isHeader = row.index === -1;
      row.cells.forEach((cell, k) => {
        const isBold = isHeader ? style.header.bold : leadOnPage && k === 0 && style.leadColumn.bold;
        const font = faceFor(isBold);
        const color = isHeader ? headerColor : BLACK;
        const blockTop = row.y + (row.height + cell.lines.length * lineH) / 2;
        const at = (w: number) => alignX(cell.align, cell.x, cell.width, pad, w);
        cell.lines.forEach((line, i) => {
          draw(line, font, p.fontSize, at, baseline(font, p.fontSize, blockTop - i * lineH, lineH), color);
        });
      });
    }

    // Header and footer bands: unscaled, at the printable edges, centered in the band.
    const { bands } = p;
    const left = layout.printable.x;
    const right = left + layout.printable.width;
    const slotX = [
      () => left,
      (w: number) => (left + right - w) / 2,
      (w: number) => right - w,
    ];
    const band = (text: [string, string, string], bottom: number) => {
      const y = baseline(regular, hf.size, bottom + bands.bandSize, bands.bandSize);
      text.forEach((t, i) => draw(t, regular, hf.size, slotX[i], y, bandColor));
    };
    band(bands.headerText, bands.headerY);
    band(bands.footerText, bands.footerY);

    if (replaced.length > 0) warnings.push({ page: p.index + 1, replaced });
  }

  return {
    bytes: await doc.save(),
    pageCount: layout.pages.length,
    warnings,
    subsetFallbacks: docFonts.subsetFallbacks,
    tooSmall: layout.tooSmall,
  };
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

/** Background fills: header row, zebra stripes on every second data row of the page, lead column. */
function fills(p: Page, leadOnPage: boolean, style: BuildInput['setup']['style']): PDFOperator[] {
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
  if (leadOnPage && leadFill) {
    for (const row of p.header ? [p.header, ...p.rows] : p.rows) rect(first.x, row.y, first.width, row.height, leadFill);
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
