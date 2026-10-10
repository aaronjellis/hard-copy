import { describe, it, expect, vi } from 'vitest';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream } from 'pdf-lib';
import { buildTablePdf, hexToRgb, type BuildInput } from '../../src/lib/table/build';
import { layoutTable, LINE_HEIGHT, PADDING_PT } from '../../src/lib/table/layout';
import { defaultSetup, reconcileColumns, type Setup } from '../../src/lib/setup/setup';
import { resolvePaper } from '../../src/lib/setup/paper';
import type { FontProvider } from '../../src/lib/fonts/types';

const noFonts: FontProvider = {
  getBytes: vi.fn(async () => {
    throw new Error('standard fonts need no bytes');
  }),
  availableFaces: async () => ({ bold: true, italic: true, boldItalic: true }),
};

const ctx = { title: 'Roster', file: 'roster.csv', sheet: 'Sheet1', now: new Date(2026, 0, 2, 9, 30), locale: 'en-US' };
const NONE = { kind: 'none' as const };
const COLS = [
  { id: 'c0', name: 'Name' },
  { id: 'c1', name: 'Qty' },
  { id: 'c2', name: 'Notes' },
];
const ROWS = [
  ['Ann', '3', 'First'],
  ['Bob', '12', 'Second'],
  ['Cyd', '7', 'Third'],
  ['Dee', '1', 'Fourth'],
  ['Eve', '40', 'Fifth'],
];

/** Default setup for the columns with every header/footer slot, fill, stripe, and line off unless the patch turns them on. */
function plainSetup(patch: (s: Setup) => void = () => {}): Setup {
  const s = reconcileColumns(defaultSetup(), COLS);
  s.hf.header = [NONE, NONE, NONE];
  s.hf.footer = [NONE, NONE, NONE];
  s.style.header.fill = null;
  s.style.zebra.on = false;
  s.page.gridlines = false;
  patch(s);
  return s;
}

function input(patch?: (s: Setup) => void, rows: string[][] = ROWS): BuildInput {
  return { columns: COLS, rows, included: rows.map(() => true), setup: plainSetup(patch), ctx };
}

/** The decoded content stream of a page, joined across content stream parts. */
function content(doc: PDFDocument, index: number): string {
  const contents = doc.getPage(index).node.Contents();
  if (!contents) return '';
  const parts = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : [contents];
  return parts
    .map((s) => Buffer.from(decodePDFRawStream(s as PDFRawStream).decode()).toString('latin1'))
    .join('\n');
}

type DrawnText = { x: number; y: number; text: string };

/** Each drawText call: its text matrix position and its (WinAnsi, so ASCII-identical) text. */
function texts(ops: string): DrawnText[] {
  const out: DrawnText[] = [];
  for (const m of ops.matchAll(/1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm\s*<([0-9A-Fa-f]*)> Tj/g)) {
    out.push({ x: Number(m[1]), y: Number(m[2]), text: Buffer.from(m[3], 'hex').toString('latin1') });
  }
  return out;
}

/** BaseFont names of the PDF's font dictionaries. */
function baseFonts(doc: PDFDocument): string[] {
  return doc.context.enumerateIndirectObjects()
    .map(([, obj]) => obj)
    .filter((o): o is PDFDict => o instanceof PDFDict && o.get(PDFName.of('Type')) === PDFName.of('Font'))
    .map((d) => String(d.get(PDFName.of('BaseFont'))))
    .sort();
}

const count = (ops: string, re: RegExp) => [...ops.matchAll(re)].length;
/** Rectangle fills: `x y w h re` followed by `f`. */
const FILL = /\bre\s+f\b/g;
const STROKE = /\bS\b/g;

async function build(i: BuildInput) {
  const pdf = await buildTablePdf(i, noFonts);
  return { pdf, doc: await PDFDocument.load(pdf.bytes) };
}

describe('hexToRgb', () => {
  it('converts #rrggbb to pdf-lib RGB components', () => {
    expect(hexToRgb('#ff8000')).toEqual({ type: 'RGB', red: 1, green: 128 / 255, blue: 0 });
    expect(hexToRgb('#000000')).toEqual({ type: 'RGB', red: 0, green: 0, blue: 0 });
  });

  it('accepts uppercase digits', () => {
    expect(hexToRgb('#FFFFFF')).toEqual({ type: 'RGB', red: 1, green: 1, blue: 1 });
  });

  it('rejects anything but #rrggbb', () => {
    expect(() => hexToRgb('#fff')).toThrow();
    expect(() => hexToRgb('red')).toThrow();
    expect(() => hexToRgb('#gg0000')).toThrow();
  });
});

describe('buildTablePdf: pages', () => {
  it('sizes pages from the paper setup', async () => {
    const { doc } = await build(input((s) => {
      s.page.paper = 'a4';
    }));
    const paper = resolvePaper({ paper: 'a4', customWidthIn: 0, customHeightIn: 0, landscape: false });
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(paper.widthPt, 3);
    expect(height).toBeCloseTo(paper.heightPt, 3);
  });

  it('turns Letter landscape into 792 × 612', async () => {
    const { doc } = await build(input((s) => {
      s.page.landscape = true;
    }));
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo(792, 3);
    expect(height).toBeCloseTo(612, 3);
  });

  it('makes one PDF page per layout page, laid out with the real font metrics', async () => {
    const rows = Array.from({ length: 150 }, (_, i) => [`Person ${i}`, String(i * 7), 'Some note text']);
    const i = input(undefined, rows);
    const { pdf, doc } = await build(i);

    const probe = await PDFDocument.create();
    const regular = await probe.embedFont(StandardFonts.Helvetica);
    const bold = await probe.embedFont(StandardFonts.HelveticaBold);
    const layout = layoutTable({
      ...i,
      measure: (t, size, style) => (style.bold ? bold : regular).widthOfTextAtSize(t, size),
    });

    expect(layout.pages.length).toBeGreaterThan(1);
    expect(pdf.pageCount).toBe(layout.pages.length);
    expect(doc.getPageCount()).toBe(layout.pages.length);
    expect(pdf.tooSmall).toBe(false);
  });

  it('draws the title and "Page 1 of N" in the header and footer bands', async () => {
    const rows = Array.from({ length: 150 }, (_, i) => [`Person ${i}`, String(i), 'x']);
    const { pdf, doc } = await build(input((s) => {
      s.hf.title = 'Roster';
      s.hf.header = [{ kind: 'title' }, NONE, NONE];
      s.hf.footer = [NONE, { kind: 'pageOf' }, NONE];
    }, rows));
    const n = pdf.pageCount;
    expect(n).toBeGreaterThan(1);
    const first = texts(content(doc, 0)).map((t) => t.text);
    expect(first).toContain('Roster');
    expect(first).toContain(`Page 1 of ${n}`);
    expect(texts(content(doc, n - 1)).map((t) => t.text)).toContain(`Page ${n} of ${n}`);
  });

  it('places band text at the printable edges, left, center, and right', async () => {
    const { doc } = await build(input((s) => {
      s.hf.header = [{ kind: 'text', text: 'L' }, { kind: 'text', text: 'C' }, { kind: 'text', text: 'R' }];
    }));
    const drawn = texts(content(doc, 0));
    const at = (t: string) => drawn.find((d) => d.text === t)!;
    // Letter portrait, 0.75 in margins: printable x 54 to 558. Helvetica 9 pt: L 5.004, C 6.498, R 6.498 wide.
    expect(at('L').x).toBeCloseTo(54, 2);
    expect(at('C').x).toBeCloseTo(306 - 6.498 / 2, 2);
    expect(at('R').x).toBeCloseTo(558 - 6.498, 2);
    // The band is 9 × 1.6 = 14.4 pt tall with its top at 792 - 54; text sits inside it.
    expect(at('L').y).toBeGreaterThan(738 - 14.4);
    expect(at('L').y).toBeLessThan(738);
    expect(content(doc, 0)).toMatch(/0\.4 0\.4 0\.4 rg/);
  });
});

describe('buildTablePdf: cells', () => {
  it('draws cell text inside the cell with padding, per alignment, vertically centered', async () => {
    const i = input();
    const { doc } = await build(i);
    const drawn = texts(content(doc, 0));
    const pad = PADDING_PT.normal; // scale 1: the table is narrow
    const ann = drawn.find((d) => d.text === 'Ann')!;
    const name = drawn.find((d) => d.text === 'Name')!;
    expect(ann.x).toBeCloseTo(54 + pad, 3);
    // Header row: one line, 10 pt; its top is the printable top, 738.
    const rowH = LINE_HEIGHT * 10 + 2 * pad;
    expect(name.y).toBeLessThan(738 - pad);
    expect(name.y).toBeGreaterThan(738 - rowH + pad);
    // The first data row sits one row height below the header.
    expect(name.y - ann.y).toBeCloseTo(rowH, 3);
    // Qty is numeric, so auto alignment puts it at the right edge of its column.
    const twelve = drawn.find((d) => d.text === '12')!;
    const three = drawn.find((d) => d.text === '3')!;
    expect(three.x).toBeGreaterThan(twelve.x);
  });

  it('reports replaced characters per page, once each', async () => {
    const { pdf } = await build(input(undefined, [['Zoë ❤', '1', '❤ ✓'], ['Al', '2', '✓']]));
    expect(pdf.warnings).toEqual([{ page: 1, replaced: ['❤', '✓'] }]);
    expect(pdf.subsetFallbacks).toEqual([]);
  });
});

describe('buildTablePdf: style', () => {
  it('fills the header row when it has a fill, and fills nothing otherwise', async () => {
    const filled = await build(input((s) => {
      s.style.header.fill = '#ff0000';
    }));
    const ops = content(filled.doc, 0);
    expect(ops).toMatch(/1 0 0 rg\s+[\d. -]+ re\s+f\b/);
    expect(count(ops, FILL)).toBe(1);

    const plain = await build(input());
    expect(count(content(plain.doc, 0), FILL)).toBe(0);
  });

  it('embeds Helvetica Bold for a bold header and only Helvetica otherwise', async () => {
    const bold = await build(input((s) => {
      s.style.header.bold = true;
    }));
    expect(baseFonts(bold.doc)).toEqual(['/Helvetica', '/Helvetica-Bold']);

    const regular = await build(input((s) => {
      s.style.header.bold = false;
    }));
    expect(baseFonts(regular.doc)).toEqual(['/Helvetica']);
  });

  it('colors header text with the header color', async () => {
    const { doc } = await build(input((s) => {
      s.style.header.color = '#0000ff';
    }));
    expect(content(doc, 0)).toMatch(/0 0 1 rg[^]*?<4E616D65> Tj/); // "Name"
  });

  it('stripes every second data row on each page', async () => {
    const { doc } = await build(input((s) => {
      s.style.zebra = { on: true, color: '#00ff00' };
    }));
    const ops = content(doc, 0);
    expect(count(ops, FILL)).toBe(Math.floor(ROWS.length / 2));
    expect(count(ops, /0 1 0 rg/g)).toBe(Math.floor(ROWS.length / 2));
  });

  it('fills and bolds the lead column, header included', async () => {
    const { doc } = await build(input((s) => {
      s.style.header.bold = false;
      s.style.leadColumn = { bold: true, fill: '#0000ff' };
    }));
    const ops = content(doc, 0);
    expect(count(ops, FILL)).toBe(ROWS.length + 1);
    expect(baseFonts(doc)).toEqual(['/Helvetica', '/Helvetica-Bold']);
  });

  it('fills the lead column by id, not on a band that starts without it', async () => {
    // Fixed 3 in columns are 324 pt at 150%: the lead plus any other column exceeds the 504 pt printable
    // width, so bands 1 and 2 start without c0. Only the band-0 page may carry the lead fill.
    const { doc, pdf } = await build(input((s) => {
      s.page.scale = { mode: 'percent', value: 150 };
      s.style.header.bold = false;
      s.style.leadColumn = { bold: false, fill: '#0000ff' };
      for (const id of s.columns.order) s.columns.byId[id].width = { mode: 'fixed', inches: 3 };
    }, [['1', '2', '3']]));
    expect(pdf.pageCount).toBe(3);
    const lead = /0 0 1 rg\s+[\d. -]+ re\s+f\b/g;
    expect(count(content(doc, 0), lead)).toBe(2); // header row + one data row
    expect(count(content(doc, 1), lead)).toBe(0);
    expect(count(content(doc, 2), lead)).toBe(0);
  });

  it('draws gridlines as 0.5 pt strokes in the border color', async () => {
    const { doc } = await build(input((s) => {
      s.page.gridlines = true;
      s.style.borders = 'hairline';
      s.style.borderColor = '#ff0000';
    }));
    const ops = content(doc, 0);
    expect(count(ops, STROKE)).toBeGreaterThan(0);
    expect(ops).toMatch(/1 0 0 RG/);
    expect(ops).toMatch(/0\.5 w/);
    // Header + 5 rows → 7 horizontal lines; 3 columns → 4 vertical lines.
    expect(count(ops, /\bl\b/g)).toBe(7 + 4);
  });

  it('draws no lines when borders are none, even with gridlines on', async () => {
    const none = await build(input((s) => {
      s.page.gridlines = true;
      s.style.borders = 'none';
    }));
    expect(count(content(none.doc, 0), STROKE)).toBe(0);

    const off = await build(input((s) => {
      s.page.gridlines = false;
    }));
    expect(count(content(off.doc, 0), STROKE)).toBe(0);
  });
});
