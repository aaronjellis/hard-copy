import { wrapLine } from '../pdf/text';
import { POINTS_PER_INCH, resolvePaper } from '../setup/paper';
import { resolveSlot, type Slot, type SlotContext } from '../setup/hf';
import { defaultColumnSetup, type CellPadding, type ColumnSetup, type Setup } from '../setup/setup';

export type Align = 'left' | 'center' | 'right';

export type LayoutInput = {
  /** Dataset columns, all of them; the setup decides which print and in what order. */
  columns: { id: string; name: string }[];
  /** Dataset rows: rows[r][c] follows `columns` order. */
  rows: string[][];
  /** Per dataset row; a missing entry counts as included. */
  included: boolean[];
  setup: Setup;
  /** Width in points of `text` at `sizePt`. Must scale linearly with size. */
  measure: (text: string, sizePt: number, style: { bold: boolean }) => number;
  /** Header/footer slot context; `page` and `pageCount` are filled in per page. */
  ctx: Omit<SlotContext, 'page' | 'pageCount'>;
};

/** One cell: x and width in points from the page's left edge; `lines` already wrapped or truncated. */
export type PlacedCell = { x: number; width: number; align: Align; lines: string[] };

/**
 * One row (or one fragment of a row split across pages). `y` is the row's bottom edge in PDF space
 * (points up from the bottom of the page). `index` is the dataset row index; -1 for the column header row.
 */
export type PlacedRow = { y: number; height: number; cells: PlacedCell[]; index: number };

export type Page = {
  /** Position in print order, from 0. */
  index: number;
  /** Column band, from 0. */
  band: number;
  /** Half-open range of printed-row positions on this page (positions in the filtered row list). */
  rowStart: number;
  rowEnd: number;
  widthPt: number;
  heightPt: number;
  scale: number;
  /** Scaled body font size in points. */
  fontSize: number;
  columns: { id: string; x: number; width: number; align: Align }[];
  /** The column header row, or null when it does not print on this page. */
  header: PlacedRow | null;
  rows: PlacedRow[];
  /**
   * Header/footer text (left, center, right), unscaled. `headerY` is the bottom edge of the header band,
   * `footerY` the bottom edge of the footer band, both in PDF space; each band is `bandSize` points tall.
   */
  bands: { headerText: [string, string, string]; footerText: [string, string, string]; headerY: number; footerY: number; bandSize: number };
};

export type PrintLayout = {
  pages: Page[];
  bandCount: number;
  scale: number;
  /** The scale needed was below MIN_SCALE and was clamped. */
  tooSmall: boolean;
  /** The table area in PDF space: paper minus margins minus header/footer bands. */
  printable: { x: number; y: number; width: number; height: number };
};

export const MIN_SCALE = 0.25;
export const LINE_HEIGHT = 1.3;
export const BAND_FACTOR = 1.6;
export const AUTO_WIDTH_CAP = 0.4;
export const PADDING_PT: Readonly<Record<CellPadding, number>> = Object.freeze({ compact: 3, normal: 5, relaxed: 8 });
const ELLIPSIS = '…';
/** Tolerance for floating-point comparisons, in points. */
const EPS = 1e-6;
/** Each fitPages refinement step shrinks the scale by this factor. */
const REFINE_STEP = 0.99;

type Col = { id: string; name: string; setup: ColumnSetup; dataIndex: number; lead: boolean };
type Fragment = { pos: number; lineStart: number; lineEnd: number };
type Chunk = { header: boolean; items: Fragment[] };

export function layoutTable(input: LayoutInput): PrintLayout {
  const { setup, measure } = input;
  const { page: pageSetup, style, hf } = setup;
  const paper = resolvePaper(pageSetup);

  // Step 1: printable area.
  const bandSize = hf.size * BAND_FACTOR;
  const headerBand = hasText(hf.header) ? bandSize : 0;
  const footerBand = hasText(hf.footer) ? bandSize : 0;
  const m = pageSetup.margins;
  const printable = {
    x: m.left * POINTS_PER_INCH,
    y: m.bottom * POINTS_PER_INCH + footerBand,
    width: paper.widthPt - (m.left + m.right) * POINTS_PER_INCH,
    height: paper.heightPt - (m.top + m.bottom) * POINTS_PER_INCH - headerBand - footerBand,
  };
  const top = printable.y + printable.height;

  const cols = selectColumns(input);
  const positions = selectRows(input, cols);
  const repeatLead = style.leadColumn.fill !== null || style.leadColumn.bold;
  const cellBold = (c: Col) => c.lead && style.leadColumn.bold;
  const text = (c: Col, pos: number) => input.rows[positions[pos]]?.[c.dataIndex] ?? '';
  const basePad = PADDING_PT[style.padding];
  const body = style.bodySize;

  // Step 2: natural widths.
  const natural = cols.map((c) => {
    if (c.setup.width.mode === 'fixed') return Math.min(c.setup.width.inches * POINTS_PER_INCH, printable.width);
    let widest = maxLineWidth(c.name, (t) => measure(t, body, { bold: style.header.bold }));
    for (let p = 0; p < positions.length; p++) {
      widest = Math.max(widest, maxLineWidth(text(c, p), (t) => measure(t, body, { bold: cellBold(c) })));
    }
    return Math.min(widest + 2 * basePad, AUTO_WIDTH_CAP * printable.width);
  });
  const naturalSum = natural.reduce((a, b) => a + b, 0);

  // Cell lines at a given scale (step 4).
  const linesAt = (scale: number) => {
    const size = body * scale;
    const pad = basePad * scale;
    const cellLines = (c: Col, i: number, value: string, bold: boolean) =>
      layoutCell(value, natural[i] * scale - 2 * pad, c.setup.wrap, (t) => measure(t, size, { bold }));
    const header = cols.map((c, i) => cellLines(c, i, c.name, style.header.bold));
    const rows = positions.map((_, p) => cols.map((c, i) => cellLines(c, i, text(c, p), cellBold(c))));
    return { header, rows };
  };
  const rowLineCount = (cells: string[][]) => cells.reduce((n, l) => Math.max(n, l.length), 1);

  // Step 3: scale.
  let scale: number;
  let tooSmall = false;
  const mode = pageSetup.scale;
  if (mode.mode === 'percent') {
    scale = mode.value / 100;
  } else if (mode.mode === 'fitWidth') {
    scale = naturalSum > 0 ? Math.min(1, printable.width / naturalSum) : 1;
  } else {
    const base = linesAt(1);
    const headerLines = cols.length > 0 ? rowLineCount(base.header) : 0;
    const counts = base.rows.map(rowLineCount);
    const heightAt1 = (n: number) => n * LINE_HEIGHT * body + 2 * basePad;
    const headerH1 = cols.length > 0 ? heightAt1(headerLines) : 0;
    const total = counts.reduce((sum, n) => sum + heightAt1(n), 0) + (pageSetup.repeatHeader ? mode.tall : 1) * headerH1;
    const byWidth = naturalSum > 0 ? (mode.wide * printable.width) / naturalSum : 1;
    const byHeight = total > 0 ? (mode.tall * printable.height) / total : 1;
    scale = Math.min(1, byWidth, byHeight);
    // The formulas ignore page-break waste and the repeated lead column; shrink until the table fits.
    const fits = (s: number) =>
      packBands(natural.map((w) => w * s), cols, repeatLead, printable.width).length <= mode.wide &&
      paginate(counts, LINE_HEIGHT * body * s, basePad * s, headerH1 * s, printable.height, pageSetup.repeatHeader).length <= mode.tall;
    while (scale >= MIN_SCALE && !fits(scale)) scale *= REFINE_STEP;
  }
  if (scale < MIN_SCALE) {
    scale = MIN_SCALE;
    tooSmall = true;
  }

  const fontSize = body * scale;
  const pad = basePad * scale;
  const lineH = LINE_HEIGHT * fontSize;
  const widths = natural.map((w) => w * scale);
  const aligns = cols.map((c) => resolveAlign(c, positions.length, (p) => text(c, p)));
  const lines = linesAt(scale);
  const counts = lines.rows.map(rowLineCount);
  const headerH = cols.length > 0 ? rowLineCount(lines.header) * lineH + 2 * pad : 0;

  // Steps 5 and 6: bands and pagination. Row heights span all columns, so every band breaks alike.
  const bands = packBands(widths, cols, repeatLead, printable.width);
  const chunks = paginate(counts, lineH, pad, headerH, printable.height, pageSetup.repeatHeader);

  const order: [number, number][] = [];
  if (pageSetup.order === 'downThenOver') {
    for (let b = 0; b < bands.length; b++) for (let c = 0; c < chunks.length; c++) order.push([b, c]);
  } else {
    for (let c = 0; c < chunks.length; c++) for (let b = 0; b < bands.length; b++) order.push([b, c]);
  }
  const pageCount = order.length;

  // Step 7: placed pages.
  const pages = order.map(([b, c], index): Page => {
    const band = bands[b];
    const chunk = chunks[c];
    let x = printable.x;
    const placedCols = band.map((i) => {
      const col = { id: cols[i].id, x, width: widths[i], align: aligns[i] };
      x += widths[i];
      return col;
    });
    const cellsFor = (cellLines: string[][], from: number, to: number) =>
      band.map((i, k) => ({ x: placedCols[k].x, width: placedCols[k].width, align: aligns[i], lines: cellLines[i].slice(from, to) }));

    let cursor = top;
    let header: PlacedRow | null = null;
    if (chunk.header && cols.length > 0) {
      cursor -= headerH;
      header = { y: cursor, height: headerH, cells: cellsFor(lines.header, 0, Infinity), index: -1 };
    }
    const rows = chunk.items.map((f): PlacedRow => {
      const height = (f.lineEnd - f.lineStart) * lineH + 2 * pad;
      cursor -= height;
      return { y: cursor, height, cells: cellsFor(lines.rows[f.pos], f.lineStart, f.lineEnd), index: positions[f.pos] };
    });
    const first = chunk.items[0];
    const last = chunk.items[chunk.items.length - 1];
    const slotCtx: SlotContext = { ...input.ctx, page: index + 1, pageCount };
    return {
      index,
      band: b,
      rowStart: first ? first.pos : chunkStart(chunks, c),
      rowEnd: last ? last.pos + 1 : chunkStart(chunks, c),
      widthPt: paper.widthPt,
      heightPt: paper.heightPt,
      scale,
      fontSize,
      columns: placedCols,
      header,
      rows,
      bands: {
        headerText: resolveSlots(hf.header, slotCtx),
        footerText: resolveSlots(hf.footer, slotCtx),
        headerY: paper.heightPt - m.top * POINTS_PER_INCH - bandSize,
        footerY: m.bottom * POINTS_PER_INCH,
        bandSize,
      },
    };
  });

  return { pages, bandCount: bands.length, scale, tooSmall, printable };
}

function hasText(slots: readonly Slot[]): boolean {
  return slots.some((s) => s.kind !== 'none');
}

function resolveSlots(slots: [Slot, Slot, Slot], ctx: SlotContext): [string, string, string] {
  return [resolveSlot(slots[0], ctx), resolveSlot(slots[1], ctx), resolveSlot(slots[2], ctx)];
}

/**
 * Included columns in setup order. Dataset columns the setup does not know yet print with defaults,
 * appended in dataset order; setup ids the dataset lacks are ignored. The first printed column is the lead.
 */
function selectColumns(input: LayoutInput): Col[] {
  const { setup } = input;
  const indexOf = new Map(input.columns.map((c, i) => [c.id, i]));
  const ids = setup.columns.order.filter((id) => indexOf.has(id));
  const known = new Set(ids);
  for (const c of input.columns) if (!known.has(c.id)) ids.push(c.id);
  const cols: Col[] = [];
  for (const id of ids) {
    const cs = Object.hasOwn(setup.columns.byId, id) ? setup.columns.byId[id] : defaultColumnSetup(id);
    if (!cs.include) continue;
    const dataIndex = indexOf.get(id)!;
    cols.push({ id, name: input.columns[dataIndex].name, setup: cs, dataIndex, lead: cols.length === 0 });
  }
  return cols;
}

/** Dataset row indices that print: included, non-blank unless blanks are on, capped at the row limit. */
function selectRows(input: LayoutInput, cols: Col[]): number[] {
  const { rows: rowSetup } = input.setup;
  const out: number[] = [];
  for (let r = 0; r < input.rows.length; r++) {
    if (rowSetup.limit !== null && out.length >= rowSetup.limit) break;
    if (input.included[r] === false) continue;
    const row = input.rows[r];
    if (!rowSetup.includeBlank && cols.every((c) => (row[c.dataIndex] ?? '').trim() === '')) continue;
    out.push(r);
  }
  return out;
}

function maxLineWidth(value: string, width: (t: string) => number): number {
  return value.split('\n').reduce((max, line) => Math.max(max, width(line)), 0);
}

/** A cell's lines: wrapped at `inner` points per source line, or one line truncated with an ellipsis. */
function layoutCell(value: string, inner: number, wrap: boolean, width: (t: string) => number): string[] {
  if (wrap) return value.split('\n').flatMap((line) => wrapLine(line, width, inner + EPS));
  return [truncate(value.replace(/\s*\n\s*/g, ' '), inner, width)];
}

function truncate(value: string, inner: number, width: (t: string) => number): string {
  if (width(value) <= inner + EPS) return value;
  const chars = Array.from(value);
  // Longest prefix that fits with the ellipsis; measured width grows with length.
  let lo = 0;
  let hi = chars.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (width(chars.slice(0, mid).join('').trimEnd() + ELLIPSIS) <= inner + EPS) lo = mid;
    else hi = mid - 1;
  }
  const candidate = chars.slice(0, lo).join('').trimEnd() + ELLIPSIS;
  return width(candidate) <= inner + EPS ? candidate : '';
}

const NUMBER = /^\(?[-+]?[$€£¥]?\s?[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?%?\)?$/;
const SLASH_DATE = /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/;
const ISO_DATE = /^\d{4}-\d{1,2}-\d{1,2}$/;

/** A number (with optional sign, currency, thousands separators, decimals, percent, parentheses) or a date. */
export function looksNumeric(value: string): boolean {
  const v = value.trim();
  if (!/\d/.test(v)) return false;
  return NUMBER.test(v) || SLASH_DATE.test(v) || ISO_DATE.test(v);
}

function resolveAlign(c: Col, count: number, text: (pos: number) => string): Align {
  if (c.setup.align !== 'auto') return c.setup.align;
  let filled = 0;
  let numeric = 0;
  for (let p = 0; p < count; p++) {
    const v = text(p);
    if (v.trim() === '') continue;
    filled++;
    if (looksNumeric(v)) numeric++;
  }
  return filled > 0 && numeric >= 0.8 * filled ? 'right' : 'left';
}

/**
 * Split column indices into bands no wider than `available`. Each band takes at least one new column;
 * with `repeatLead`, bands after the first start with the lead column.
 */
function packBands(widths: number[], cols: Col[], repeatLead: boolean, available: number): number[][] {
  if (cols.length === 0) return [[]];
  const bands: number[][] = [];
  let i = 0;
  while (i < cols.length) {
    const band: number[] = [];
    let used = 0;
    if (repeatLead && bands.length > 0) {
      band.push(0);
      used = widths[0];
    }
    let added = 0;
    while (i < cols.length && (added === 0 || used + widths[i] <= available + EPS)) {
      band.push(i);
      used += widths[i];
      i++;
      added++;
    }
    bands.push(band);
  }
  return bands;
}

/**
 * Fill pages with rows (given as line counts). A row that does not fit starts a new page; a row taller
 * than a fresh page splits by lines. The header row prints on the first page, and on every page with
 * `repeatHeader`. Always returns at least one page.
 */
function paginate(counts: number[], lineH: number, pad: number, headerH: number, available: number, repeatHeader: boolean): Chunk[] {
  const chunks: Chunk[] = [];
  let cur: Chunk = { header: true, items: [] };
  let used = headerH;
  const next = () => {
    chunks.push(cur);
    cur = { header: repeatHeader, items: [] };
    used = repeatHeader ? headerH : 0;
  };
  for (let pos = 0; pos < counts.length; pos++) {
    const n = counts[pos];
    const h = n * lineH + 2 * pad;
    if (used + h <= available + EPS) {
      cur.items.push({ pos, lineStart: 0, lineEnd: n });
      used += h;
      continue;
    }
    if (cur.items.length > 0) {
      next();
      if (used + h <= available + EPS) {
        cur.items.push({ pos, lineStart: 0, lineEnd: n });
        used += h;
        continue;
      }
    }
    let start = 0;
    while (start < n) {
      const fit = Math.max(1, Math.floor((available - used - 2 * pad + EPS) / lineH));
      const end = Math.min(n, start + fit);
      cur.items.push({ pos, lineStart: start, lineEnd: end });
      used += (end - start) * lineH + 2 * pad;
      start = end;
      if (start < n) next();
    }
  }
  chunks.push(cur);
  return chunks;
}

/** The first row position on an empty page: where the previous page ended. */
function chunkStart(chunks: Chunk[], c: number): number {
  for (let k = c - 1; k >= 0; k--) {
    const items = chunks[k].items;
    if (items.length > 0) return items[items.length - 1].pos + 1;
  }
  return 0;
}
