import { describe, it, expect, vi } from 'vitest';
import { defaultSetup, reconcileColumns, type Setup } from '../../src/lib/setup/setup';
import { layoutTable, type LayoutInput } from '../../src/lib/table/layout';

/** Every character is half the font size wide, or 0.6 of it in bold. */
const measure = (t: string, s: number, style: { bold: boolean }) => t.length * s * (style.bold ? 0.6 : 0.5);
const ctx = { title: 'My title', file: 'data.csv', sheet: 'Sheet1', now: new Date(2026, 0, 2, 9, 30), locale: 'en-US' };
const NONE = { kind: 'none' as const };

type Col = { id: string; name: string };

function columns(names: string[]): Col[] {
  return names.map((name, i) => ({ id: `c${i}`, name }));
}

/** Default setup reconciled to the columns, with every header/footer slot off unless the patch turns them on. */
function setupFor(cols: Col[], patch: (s: Setup) => void = () => {}): Setup {
  const s = reconcileColumns(defaultSetup(), cols);
  s.hf.header = [NONE, NONE, NONE];
  s.hf.footer = [NONE, NONE, NONE];
  patch(s);
  return s;
}

function input(cols: Col[], rows: string[][], patch?: (s: Setup) => void, included?: boolean[]): LayoutInput {
  return { columns: cols, rows, included: included ?? rows.map(() => true), setup: setupFor(cols, patch), measure, ctx };
}

const repeat = (s: string, n: number) => s.repeat(n);
const fill = <T>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i));

// Letter portrait, 0.75 in margins: 612 × 792 pt, printable 504 × 684 at (54, 54) with no bands.

describe('layoutTable: scale', () => {
  it('fitWidth shrinks four 160 pt columns to the 504 pt printable width', () => {
    const cols = columns(['A', 'B', 'C', 'D']);
    const layout = layoutTable(input(cols, [fill(4, () => repeat('a', 30))]));
    expect(layout.scale).toBeCloseTo(0.7875, 6);
    expect(layout.tooSmall).toBe(false);
    expect(layout.bandCount).toBe(1);
    expect(layout.printable).toEqual({ x: 54, y: 54, width: 504, height: 684 });
    const page = layout.pages[0];
    expect(page.fontSize).toBeCloseTo(7.875, 6);
    expect(page.columns.map((c) => c.x)).toEqual([54, 180, 306, 432].map((x) => expect.closeTo(x, 6)));
    expect(page.columns.map((c) => c.width)).toEqual(fill(4, () => expect.closeTo(126, 6)));
    // Row height: 1.3 × 7.875 + 2 × 3.9375 = 18.1125; the 30-character cell still fits on one line.
    expect(page.header!.height).toBeCloseTo(18.1125, 6);
    expect(page.header!.y).toBeCloseTo(719.8875, 6);
    expect(page.rows[0].height).toBeCloseTo(18.1125, 6);
    expect(page.rows[0].y).toBeCloseTo(701.775, 6);
    expect(page.rows[0].cells[0].lines).toEqual([repeat('a', 30)]);
  });

  it('fitWidth widens a narrow table to the printable width without enlarging the text', () => {
    const layout = layoutTable(input(columns(['Name']), [['Ann']]));
    expect(layout.scale).toBe(1);
    expect(layout.pages[0].columns[0].width).toBeCloseTo(504, 6);
  });

  it('fitWidth shares the slack among auto columns in proportion and leaves fixed ones alone', () => {
    const cols = columns(['Name', 'Note', 'Fixed']);
    const layout = layoutTable(input(cols, [['Ann', 'Ann is here', 'x']], (s) => {
      s.columns.byId.c2.width = { mode: 'fixed', inches: 1 };
    }));
    const [a, b, c] = layout.pages[0].columns.map((col) => col.width);
    expect(c).toBe(72);
    expect(a + b + c).toBeCloseTo(504, 6);
    // Natural widths: "Name" bold 24 + 10 = 34; "Ann is here" 55 + 10 = 65. The ratio survives the stretch.
    expect(a / b).toBeCloseTo(34 / 65, 6);
  });

  it('fitWidth leaves an all-fixed table at its fixed widths', () => {
    const cols = columns(['A', 'B']);
    const layout = layoutTable(input(cols, [['x', 'y']], (s) => {
      s.columns.byId.c0.width = { mode: 'fixed', inches: 1 };
      s.columns.byId.c1.width = { mode: 'fixed', inches: 2 };
    }));
    expect(layout.pages[0].columns.map((c) => c.width)).toEqual([72, 144]);
  });

  it('fitPages 1 × 1 takes the width limit when the table is wide', () => {
    const cols = columns(['A', 'B', 'C', 'D']);
    const layout = layoutTable(input(cols, [fill(4, () => repeat('a', 30))], (s) => {
      s.page.scale = { mode: 'fitPages', wide: 1, tall: 1 };
    }));
    expect(layout.scale).toBeCloseTo(0.7875, 6);
    expect(layout.pages).toHaveLength(1);
  });

  it('fitPages 1 × 1 takes the height limit when the table is tall', () => {
    // 71 rows + header, 19 pt each at scale 1 (13 + 2 × 3): 1368 pt into 684 pt → 0.5.
    const layout = layoutTable(input(columns(['N']), fill(71, () => ['x']), (s) => {
      s.style.padding = 'compact';
      s.page.scale = { mode: 'fitPages', wide: 1, tall: 1 };
    }));
    expect(layout.scale).toBeCloseTo(0.5, 6);
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0].rows).toHaveLength(71);
    expect(layout.pages[0].fontSize).toBeCloseTo(5, 6);
    expect(layout.pages[0].rows[70].y).toBeCloseTo(54, 6);
  });

  it('percent 50 splits a wide table into column bands', () => {
    // Ten 110 pt columns at 50% are 55 pt each: nine fit in 504 pt, the tenth starts band 2.
    const cols = columns(fill(10, (i) => `C${i}`));
    const layout = layoutTable(input(cols, [fill(10, () => repeat('a', 20))], (s) => {
      s.page.scale = { mode: 'percent', value: 50 };
    }));
    expect(layout.scale).toBe(0.5);
    expect(layout.bandCount).toBe(2);
    expect(layout.pages).toHaveLength(2);
    expect(layout.pages[0].columns.map((c) => c.id)).toEqual(fill(9, (i) => `c${i}`));
    expect(layout.pages[1].columns.map((c) => c.id)).toEqual(['c9']);
    expect(layout.pages[1].columns[0].x).toBe(54);
    expect(layout.pages[1].rows[0].cells).toHaveLength(1);
  });

  it('repeats the lead column in every band when the lead column is styled', () => {
    const cols = columns(fill(10, (i) => `C${i}`));
    const layout = layoutTable(input(cols, [fill(10, () => repeat('a', 20))], (s) => {
      s.page.scale = { mode: 'percent', value: 50 };
      s.style.leadColumn.fill = '#eeeeee';
    }));
    expect(layout.bandCount).toBe(2);
    expect(layout.pages[1].columns.map((c) => c.id)).toEqual(['c0', 'c9']);
    expect(layout.pages[1].columns.map((c) => c.x)).toEqual([54, 109]);
  });

  it('measures a bold lead column in bold', () => {
    // Bold 20-character cells are 120 + 10 = 130 pt, 65 pt at 50%: eight columns fill band 1 (450 pt).
    const cols = columns(fill(10, (i) => `C${i}`));
    const layout = layoutTable(input(cols, [fill(10, () => repeat('a', 20))], (s) => {
      s.page.scale = { mode: 'percent', value: 50 };
      s.style.leadColumn.bold = true;
    }));
    expect(layout.pages[0].columns[0].width).toBe(65);
    expect(layout.pages[0].columns).toHaveLength(8);
    expect(layout.pages[1].columns.map((c) => c.id)).toEqual(['c0', 'c8', 'c9']);
  });

  it('clamps scaled widths to the printable width at percent 200', () => {
    const layout = layoutTable(input(columns(['Wide', 'B']), [['x', 'y']], (s) => {
      s.page.scale = { mode: 'percent', value: 200 };
      s.columns.byId.c0.width = { mode: 'fixed', inches: 5 };
    }));
    expect(layout.bandCount).toBe(2);
    for (const page of layout.pages) {
      const right = Math.max(...page.columns.map((c) => c.x + c.width));
      expect(right - layout.printable.x).toBeLessThanOrEqual(layout.printable.width + 1e-6);
    }
    expect(layout.pages[0].columns[0].width).toBe(504);
    expect(layout.pages[0].rows[0].cells[0].lines).toEqual(['x']);
  });

  it('skips the repeated lead column in a band it would overflow at percent 150', () => {
    // Fixed 3 in columns are 324 pt at 150%: the lead plus any other column exceeds 504 pt.
    const cols = columns(['A', 'B', 'C']);
    const layout = layoutTable(input(cols, [['1', '2', '3']], (s) => {
      s.page.scale = { mode: 'percent', value: 150 };
      s.style.leadColumn.bold = true;
      for (const id of s.columns.order) s.columns.byId[id].width = { mode: 'fixed', inches: 3 };
    }));
    expect(layout.pages.map((p) => p.columns.map((c) => c.id))).toEqual([['c0'], ['c1'], ['c2']]);
    for (const page of layout.pages) {
      const used = page.columns.reduce((sum, c) => sum + c.width, 0);
      expect(used).toBeLessThanOrEqual(layout.printable.width + 1e-6);
    }
  });

  describe('fitPages refinement', () => {
    // Relaxed padding: a row of n lines is 13n + 16 pt at scale 1; the header row is 29 pt.
    const tallRows = (count: number, lines: number) => fill(count, () => [fill(lines, () => 'x').join('\n')]);
    const twoTall = (s: Setup) => {
      s.style.padding = 'relaxed';
      s.page.repeatHeader = false;
      s.page.scale = { mode: 'fitPages', wide: 1, tall: 2 };
    };

    it('shrinks below the formula scale when page breaks waste space', () => {
      // Three 666 pt rows: the formula gives 1368 / 2027, but page 2 needs both remaining rows,
      // so the scale must drop to 684 / 1332.
      const formula = 1368 / 2027;
      const limit = 684 / 1332;
      const layout = layoutTable(input(columns(['N']), tallRows(3, 50), twoTall));
      expect(layout.pages).toHaveLength(2);
      expect(layout.scale).toBeLessThan(formula);
      expect(layout.scale).toBeLessThanOrEqual(limit + 1e-9);
      expect(layout.scale).toBeGreaterThan(limit * 0.99);
      expect(layout.tooSmall).toBe(false);
    });

    it('clamps to MIN_SCALE without tooSmall when the table fits there exactly', () => {
      // Three 1368 pt rows: page 2 holds two rows only at 0.25 (2 × 342 = 684).
      const layout = layoutTable(input(columns(['N']), tallRows(3, 104), twoTall));
      expect(layout.scale).toBe(0.25);
      expect(layout.tooSmall).toBe(false);
      expect(layout.pages).toHaveLength(2);
    });

    it('reports tooSmall when even MIN_SCALE does not fit', () => {
      const layout = layoutTable(input(columns(['N']), tallRows(4, 104), twoTall));
      expect(layout.scale).toBe(0.25);
      expect(layout.tooSmall).toBe(true);
      expect(layout.pages).toHaveLength(3);
    });

    it('shrinks so the repeated lead column still fits in wide: 2', () => {
      // Six fixed 2 in columns (144 pt): with the lead repeated, band 2 holds the lead plus two
      // columns only when band 1 holds four, at 504 / 576 = 0.875 or less.
      const cols = columns(fill(6, (i) => `C${i}`));
      const layout = layoutTable(input(cols, [fill(6, () => 'x')], (s) => {
        s.page.scale = { mode: 'fitPages', wide: 2, tall: 1 };
        s.style.leadColumn.fill = '#eeeeee';
        for (const id of s.columns.order) s.columns.byId[id].width = { mode: 'fixed', inches: 2 };
      }));
      expect(layout.bandCount).toBe(2);
      expect(layout.scale).toBeLessThanOrEqual(0.875 + 1e-9);
      expect(layout.scale).toBeGreaterThan(0.875 * 0.99);
      expect(layout.pages[1].columns.map((c) => c.id)).toEqual(['c0', 'c4', 'c5']);
    });
  });

  it('clamps to 0.25 and reports tooSmall when fitWidth needs less', () => {
    // Ten fixed 3 in columns: 2160 pt into 504 pt needs 0.233.
    const cols = columns(fill(10, (i) => `C${i}`));
    const layout = layoutTable(input(cols, [fill(10, () => 'x')], (s) => {
      for (const id of s.columns.order) s.columns.byId[id].width = { mode: 'fixed', inches: 3 };
    }));
    expect(layout.scale).toBe(0.25);
    expect(layout.tooSmall).toBe(true);
    expect(layout.pages[0].fontSize).toBe(2.5);
    expect(layout.bandCount).toBe(2); // 54 pt columns: nine per band
    expect(layout.pages[0].columns).toHaveLength(9);

    const eight = columns(fill(8, (i) => `C${i}`));
    const ok = layoutTable(input(eight, [fill(8, () => 'x')], (s) => {
      for (const id of s.columns.order) s.columns.byId[id].width = { mode: 'fixed', inches: 3 };
    }));
    expect(ok.scale).toBeCloseTo(504 / 1728, 9);
    expect(ok.tooSmall).toBe(false);
  });
});

describe('layoutTable: widths and alignment', () => {
  it('caps an auto width at 40% of the printable width', () => {
    // At 100% so fit to width's stretching stays out of the measurement.
    const layout = layoutTable(input(columns(['Notes', 'ID']), [[repeat('a', 200), '7']], (s) => {
      s.page.scale = { mode: 'percent', value: 100 };
    }));
    expect(layout.scale).toBe(1);
    expect(layout.pages[0].columns.map((c) => c.width)).toEqual([expect.closeTo(201.6, 9), 22]); // bold "ID" 12 + 10
    expect(layout.pages[0].columns.map((c) => c.x)).toEqual([54, expect.closeTo(255.6, 9)]);
  });

  it('right-aligns columns that are at least 80% numbers, currency, percents, or dates', () => {
    const cols = columns(['Mixed', 'Text', 'Forced']);
    const rows = [
      ['$1,200.50', 'a', '1'],
      ['12%', 'b', '2'],
      ['1/2/2026', '3', '3'],
      ['2026-01-02', '4', '4'],
      ['n/a', '5', '5'],
      ['', 'c', '6'],
    ];
    const layout = layoutTable(input(cols, rows, (s) => { s.columns.byId.c2.align = 'center'; }));
    const page = layout.pages[0];
    expect(page.columns.map((c) => c.align)).toEqual(['right', 'left', 'center']);
    expect(page.header!.cells.map((c) => c.align)).toEqual(['right', 'left', 'center']);
    expect(page.rows[0].cells.map((c) => c.align)).toEqual(['right', 'left', 'center']);
  });
});

describe('layoutTable: rows', () => {
  const longText = 'aaaa bbbb cccc dddd';
  const oneInch = (wrap: boolean) => (s: Setup) => {
    s.columns.byId.c0.width = { mode: 'fixed', inches: 1 };
    s.columns.byId.c0.wrap = wrap;
  };

  it('wraps text to the column width and grows the row', () => {
    // 72 pt column, 62 pt inner: twelve 5 pt characters per line.
    const page = layoutTable(input(columns(['T']), [[longText]], oneInch(true))).pages[0];
    expect(page.rows[0].cells[0].lines).toEqual(['aaaa bbbb', 'cccc dddd']);
    expect(page.rows[0].height).toBe(36); // 2 × 13 + 2 × 5
  });

  it('sizes a wrap-off auto column to the joined single line', () => {
    // "12 Elm St Springfield" is 21 characters: 105 + 2 × 5 = 115 pt.
    const page = layoutTable(input(columns(['Address']), [['12 Elm St\nSpringfield']], (s) => {
      s.columns.byId.c0.wrap = false;
      s.page.scale = { mode: 'percent', value: 100 };
    })).pages[0];
    expect(page.columns[0].width).toBe(115);
    expect(page.rows[0].cells[0].lines).toEqual(['12 Elm St Springfield']);
  });

  it('keeps one line with an ellipsis when wrap is off', () => {
    const page = layoutTable(input(columns(['T']), [[longText]], oneInch(false))).pages[0];
    expect(page.rows[0].cells[0].lines).toEqual(['aaaa bbbb c…']);
    expect(page.rows[0].height).toBe(23);
  });

  it('splits a 200-line cell across pages by lines', () => {
    // Header 23 pt; each page then holds floor((684 − 23 − 10) / 13) = 50 lines.
    const big = fill(200, () => 'x').join('\n');
    const layout = layoutTable(input(columns(['Notes']), [[big]]));
    expect(layout.pages).toHaveLength(4);
    for (const page of layout.pages) {
      expect(page.rows).toHaveLength(1);
      expect(page.rows[0].index).toBe(0);
      expect(page.rows[0].cells[0].lines).toHaveLength(50);
      expect(page.rows[0].height).toBe(660);
      expect(page.rows[0].y).toBe(55);
      expect(page.header!.y).toBe(715);
      expect([page.rowStart, page.rowEnd]).toEqual([0, 1]);
    }
  });

  it('continues a split row without the header row when repeatHeader is off', () => {
    // Page 1 holds 50 lines under the header; later pages hold floor((684 − 10) / 13) = 51.
    const big = fill(200, () => 'x').join('\n');
    const layout = layoutTable(input(columns(['Notes']), [[big]], (s) => { s.page.repeatHeader = false; }));
    expect(layout.pages.map((p) => p.rows[0].cells[0].lines.length)).toEqual([50, 51, 51, 48]);
    expect(layout.pages.map((p) => p.header !== null)).toEqual([true, false, false, false]);
    expect(layout.pages[1].rows[0].height).toBe(673);
    expect(layout.pages[1].rows[0].y).toBe(65);
  });

  it('prints only the header row when every row is excluded', () => {
    const rows = [['1'], ['2']];
    const layout = layoutTable(input(columns(['N']), rows, undefined, [false, false]));
    expect(layout.pages).toHaveLength(1);
    expect(layout.pages[0].header).not.toBeNull();
    expect(layout.pages[0].rows).toEqual([]);
    expect([layout.pages[0].rowStart, layout.pages[0].rowEnd]).toEqual([0, 0]);
  });

  it('prints one empty page when no column is included', () => {
    const cols = columns(['A', 'B']);
    const layout = layoutTable(input(cols, [['1', '2'], ['3', '4']], (s) => {
      s.columns.byId.c0.include = false;
      s.columns.byId.c1.include = false;
    }));
    expect(layout.pages).toHaveLength(1);
    const page = layout.pages[0];
    expect(page.columns).toEqual([]);
    expect(page.header).toBeNull();
    expect(page.rows).toEqual([]);
    expect([page.rowStart, page.rowEnd]).toEqual([0, 0]);
  });

  it('skips excluded rows and columns, drops blank rows, and honors the row limit', () => {
    const cols = columns(['A', 'B', 'C']);
    const rows = [['1', 'x', 'q'], ['2', 'y', 'q'], ['', '', 'q'], ['4', 'z', 'q'], ['5', 'w', 'q']];
    const included = [true, false, true, true, true];
    const base = layoutTable(input(cols, rows, (s) => { s.columns.byId.c2.include = false; }, included)).pages[0];
    expect(base.columns.map((c) => c.id)).toEqual(['c0', 'c1']);
    expect(base.rows.map((r) => r.index)).toEqual([0, 3, 4]);
    expect(base.rows[1].cells.map((c) => c.lines)).toEqual([['4'], ['z']]);

    const blanks = layoutTable(input(cols, rows, (s) => {
      s.columns.byId.c2.include = false;
      s.rows.includeBlank = true;
      s.rows.limit = 3;
    }, included)).pages[0];
    expect(blanks.rows.map((r) => r.index)).toEqual([0, 2, 3]);
    expect([blanks.rowStart, blanks.rowEnd]).toEqual([0, 3]);
  });
});

describe('layoutTable: pagination', () => {
  // One narrow column, compact padding: header and rows are 19 pt, so a 684 pt page holds 36.
  const rows71 = fill(71, (i) => [String(i)]);
  const compact = (repeatHeader: boolean) => (s: Setup) => {
    s.style.padding = 'compact';
    s.page.repeatHeader = repeatHeader;
  };

  it('repeats the header row on every page when repeatHeader is on', () => {
    const layout = layoutTable(input(columns(['N']), rows71, compact(true)));
    expect(layout.pages.map((p) => [p.rowStart, p.rowEnd])).toEqual([[0, 35], [35, 70], [70, 71]]);
    expect(layout.pages.every((p) => p.header !== null)).toBe(true);
    expect(layout.pages[1].header!.y).toBe(719);
    expect(layout.pages[1].rows[0].y).toBe(700);
    expect(layout.pages[1].rows[0].index).toBe(35);
  });

  it('puts the header row on the first page only when repeatHeader is off', () => {
    const layout = layoutTable(input(columns(['N']), rows71, compact(false)));
    expect(layout.pages.map((p) => [p.rowStart, p.rowEnd])).toEqual([[0, 35], [35, 71]]);
    expect(layout.pages[0].header).not.toBeNull();
    expect(layout.pages[1].header).toBeNull();
    expect(layout.pages[1].rows[0].y).toBe(719);
  });

  it('reduces rows per page for wider margins and header/footer bands', () => {
    const rows = fill(100, (i) => [String(i)]);
    const plain = layoutTable(input(columns(['N']), rows, compact(true)));
    expect(plain.pages[0].rows).toHaveLength(35);

    const narrow = layoutTable(input(columns(['N']), rows, (s) => {
      compact(true)(s);
      s.page.margins = { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 };
    }));
    expect(narrow.printable).toEqual({ x: 36, y: 36, width: 540, height: 720 });
    expect(narrow.pages[0].rows).toHaveLength(36);

    // Header and footer bands of 9 × 1.6 = 14.4 pt each leave 655.2 pt: 34 slots, 33 rows.
    const banded = layoutTable(input(columns(['N']), rows, (s) => {
      compact(true)(s);
      s.hf.header = [{ kind: 'title' }, NONE, NONE];
      s.hf.footer = [NONE, { kind: 'pageOf' }, NONE];
    }));
    expect(banded.printable.x).toBe(54);
    expect(banded.printable.y).toBeCloseTo(68.4, 9);
    expect(banded.printable.width).toBe(504);
    expect(banded.printable.height).toBeCloseTo(655.2, 9);
    expect(banded.pages.map((p) => p.rows.length)).toEqual([33, 33, 33, 1]);
    const { bands } = banded.pages[1];
    expect(bands.bandSize).toBeCloseTo(14.4, 9);
    expect(bands.headerY).toBeCloseTo(723.6, 9);
    expect(bands.footerY).toBe(54);
    expect(bands.headerText).toEqual(['My title', '', '']);
    expect(bands.footerText).toEqual(['', 'Page 2 of 4', '']);
  });

  describe('page order across bands', () => {
    // Two bands (see the percent test); rows are 11.5 pt at 50%. A footer band leaves 669.6 pt:
    // 58 slots, so 57 rows under the header. 100 rows make two pages per band.
    const cols = columns(fill(10, (i) => `C${i}`));
    const rows = fill(100, () => fill(10, () => repeat('a', 20)));
    const run = (order: 'downThenOver' | 'overThenDown') => layoutTable(input(cols, rows, (s) => {
      s.page.scale = { mode: 'percent', value: 50 };
      s.page.order = order;
      s.hf.footer = [NONE, { kind: 'pageOf' }, NONE];
    }));

    it('downThenOver prints every page of band 1 before band 2', () => {
      const layout = run('downThenOver');
      expect(layout.pages.map((p) => [p.index, p.band, p.rowStart, p.rowEnd])).toEqual([
        [0, 0, 0, 57], [1, 0, 57, 100], [2, 1, 0, 57], [3, 1, 57, 100],
      ]);
      expect(layout.pages[1].bands.footerText[1]).toBe('Page 2 of 4');
    });

    it('prints the header row on the first page of each band when repeatHeader is off', () => {
      const layout = layoutTable(input(cols, rows, (s) => {
        s.page.scale = { mode: 'percent', value: 50 };
        s.page.repeatHeader = false;
      }));
      expect(layout.pages.map((p) => [p.band, p.header !== null])).toEqual([
        [0, true], [0, false], [1, true], [1, false],
      ]);
    });

    it('overThenDown prints each page row across the bands first', () => {
      const layout = run('overThenDown');
      expect(layout.pages.map((p) => [p.index, p.band, p.rowStart, p.rowEnd])).toEqual([
        [0, 0, 0, 57], [1, 1, 0, 57], [2, 0, 57, 100], [3, 1, 57, 100],
      ]);
      expect(layout.pages[1].columns.map((c) => c.id)).toEqual(['c9']);
      expect(layout.pages[3].bands.footerText[1]).toBe('Page 4 of 4');
    });
  });
});

describe('layoutTable: edges', () => {
  it('is deterministic', () => {
    const make = () => input(columns(['A', 'B']), fill(80, (i) => [`row ${i}`, `$${i}.00`]), (s) => {
      s.hf.header = [{ kind: 'title' }, { kind: 'date' }, { kind: 'pageOf' }];
    });
    expect(layoutTable(make())).toEqual(layoutTable(make()));
  });

  it('resolves date and time once, so every page shows the same text', () => {
    // Each argument-free `new Date()` jumps 25 hours ahead.
    const RealDate = Date;
    let calls = 0;
    class TickingDate extends RealDate {
      constructor(value?: number | string | Date) {
        super(value ?? RealDate.UTC(2026, 0, 2, 9, 0) + calls++ * 25 * 3_600_000);
      }
    }
    vi.stubGlobal('Date', TickingDate);
    try {
      const layout = layoutTable({
        ...input(columns(['N']), fill(100, (i) => [String(i)]), (s) => {
          s.hf.header = [{ kind: 'date' }, { kind: 'time' }, NONE];
        }),
        ctx: { title: '', file: 'data.csv', sheet: 'Sheet1', locale: 'en-US' },
      });
      expect(layout.pages.length).toBeGreaterThan(1);
      const texts = layout.pages.map((p) => p.bands.headerText.join('|'));
      expect(new Set(texts).size).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reports noRoom with one empty page when the printable area is too small', () => {
    // 3 × 3 in paper with 1.5 in margins leaves nothing.
    const rows = fill(2000, (i) => [`row ${i}`, String(i)]);
    const started = performance.now();
    const layout = layoutTable(input(columns(['A', 'B']), rows, (s) => {
      s.page.paper = 'custom';
      s.page.customWidthIn = 3;
      s.page.customHeightIn = 3;
      s.page.margins = { top: 1.5, right: 1.5, bottom: 1.5, left: 1.5 };
    }));
    expect(performance.now() - started).toBeLessThan(50);
    expect(layout.noRoom).toBe(true);
    expect(layout.pages).toHaveLength(1);
    expect(layout.bandCount).toBe(1);
    expect(layout.printable.width).toBe(0);
    expect(layout.printable.height).toBe(0);
    const page = layout.pages[0];
    expect(page.rows).toEqual([]);
    expect(page.header).toBeNull();
    expect(page.columns).toEqual([]);
    expect([page.widthPt, page.heightPt]).toEqual([216, 216]);
  });

  it('reports noRoom when the printable width is under half an inch', () => {
    const layout = layoutTable(input(columns(['A']), [['1']], (s) => {
      s.page.paper = 'custom';
      s.page.customWidthIn = 3;
      s.page.margins = { top: 0.5, right: 1.3, bottom: 0.5, left: 1.3 };
    }));
    expect(layout.noRoom).toBe(true);
    expect(layoutTable(input(columns(['A']), [['1']])).noRoom).toBe(false);
  });

  describe('header and footer bands', () => {
    const cols = columns(['N']);
    const withDefaults = (title: string, ctxTitle: string) => ({
      columns: cols,
      rows: [['1']],
      included: [true],
      setup: (() => { const s = reconcileColumns(defaultSetup(), cols); s.hf.title = title; return s; })(),
      measure,
      ctx: { ...ctx, title: ctxTitle },
    });

    it('reserves no header band for the default setup with an empty title', () => {
      // The default footer (Page N of M) still takes its 14.4 pt band.
      const layout = layoutTable(withDefaults('', ''));
      expect(layout.printable.y + layout.printable.height).toBe(738);
      expect(layout.printable.height).toBeCloseTo(669.6, 9);
      expect(layout.pages[0].bands.headerText).toEqual(['', '', '']);
    });

    it('reserves the header band for the setup title, which wins over the context title', () => {
      const layout = layoutTable(withDefaults('Roster', 'From file'));
      expect(layout.printable.y + layout.printable.height).toBeCloseTo(723.6, 9);
      expect(layout.printable.height).toBeCloseTo(655.2, 9);
      expect(layout.pages[0].bands.headerText).toEqual(['Roster', '', '']);
    });

    it('falls back to the context title', () => {
      const layout = layoutTable(withDefaults('', 'From file'));
      expect(layout.pages[0].bands.headerText).toEqual(['From file', '', '']);
      expect(layout.printable.height).toBeCloseTo(655.2, 9);
    });
  });

  it('lays out an empty dataset as one page with no rows', () => {
    const layout = layoutTable(input([], []));
    expect(layout.pages).toHaveLength(1);
    expect(layout.bandCount).toBe(1);
    expect(layout.scale).toBe(1);
    expect(layout.tooSmall).toBe(false);
    expect(layout.noRoom).toBe(false);
    const page = layout.pages[0];
    expect(page.rows).toEqual([]);
    expect(page.header).toBeNull();
    expect(page.columns).toEqual([]);
    expect([page.index, page.band, page.rowStart, page.rowEnd]).toEqual([0, 0, 0, 0]);
    expect([page.widthPt, page.heightPt]).toEqual([612, 792]);
  });
});
