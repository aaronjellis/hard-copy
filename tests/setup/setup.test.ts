import { describe, it, expect } from 'vitest';
import {
  clampStep, defaultSetup, defaultColumnSetup, parseSetup, reconcileColumns, SETUP_LIMITS,
  type Setup,
} from '../../src/lib/setup/setup';

/** parseSetup on a JSON round trip, the way stored and imported setups arrive. */
function parseJson(value: unknown): Setup {
  return parseSetup(JSON.parse(JSON.stringify(value)));
}

function withPage(page: Record<string, unknown>): unknown {
  return { ...defaultSetup(), page: { ...defaultSetup().page, ...page } };
}

function withStyle(style: Record<string, unknown>): unknown {
  return { ...defaultSetup(), style: { ...defaultSetup().style, ...style } };
}

describe('defaultSetup', () => {
  it('matches the documented defaults', () => {
    expect(defaultSetup()).toEqual({
      version: 1,
      page: {
        paper: 'letter', customWidthIn: 8.5, customHeightIn: 11, landscape: false,
        margins: { top: 0.75, right: 0.75, bottom: 0.75, left: 0.75 },
        scale: { mode: 'fitWidth' }, repeatHeader: true, gridlines: true, order: 'downThenOver',
      },
      columns: { order: [], byId: {} },
      rows: { limit: null, includeBlank: false },
      style: {
        font: { kind: 'standard', id: 'helvetica' }, bodySize: 10,
        header: { bold: true, fill: '#f2f2f2', color: null },
        leadColumn: { bold: false, fill: null },
        zebra: { on: true, color: '#fafafa' },
        padding: 'normal', borders: 'hairline', borderColor: '#d0d0d0',
      },
      hf: {
        title: '',
        header: [{ kind: 'title' }, { kind: 'none' }, { kind: 'none' }],
        footer: [{ kind: 'none' }, { kind: 'pageOf' }, { kind: 'none' }],
        size: 9,
      },
    });
  });

  it('returns a fresh object each time', () => {
    const a = defaultSetup();
    a.page.margins.top = 2;
    a.hf.header[0].kind = 'none';
    expect(defaultSetup().page.margins.top).toBe(0.75);
    expect(defaultSetup().hf.header[0].kind).toBe('title');
  });

  it('gives new columns include, auto width, auto alignment, and wrap', () => {
    expect(defaultColumnSetup('c3')).toEqual({ id: 'c3', include: true, width: { mode: 'auto' }, align: 'auto', wrap: true });
  });
});

describe('parseSetup', () => {
  it('round-trips a fully customized setup', () => {
    const s = defaultSetup();
    s.page = {
      paper: 'custom', customWidthIn: 6, customHeightIn: 9, landscape: true,
      margins: { top: 0.5, right: 1, bottom: 0.25, left: 2 },
      scale: { mode: 'fitPages', wide: 2, tall: 3 }, repeatHeader: false, gridlines: false, order: 'overThenDown',
    };
    s.columns = {
      order: ['c1', 'c0'],
      byId: {
        c0: { id: 'c0', include: false, width: { mode: 'fixed', inches: 1.5 }, align: 'right', wrap: false },
        c1: defaultColumnSetup('c1'),
      },
    };
    s.rows = { limit: 50, includeBlank: true };
    s.style = {
      font: { kind: 'google', family: 'Lora' }, bodySize: 12,
      header: { bold: false, fill: null, color: '#112233' },
      leadColumn: { bold: true, fill: '#eeeeee' },
      zebra: { on: false, color: '#abcdef' },
      padding: 'relaxed', borders: 'none', borderColor: '#000000',
    };
    s.hf = {
      title: 'Roster',
      header: [{ kind: 'text', text: 'Draft' }, { kind: 'date' }, { kind: 'time' }],
      footer: [{ kind: 'file' }, { kind: 'sheet' }, { kind: 'page' }],
      size: 11,
    };
    expect(parseJson(s)).toEqual(s);
  });

  it('accepts each scale mode', () => {
    expect(parseJson(withPage({ scale: { mode: 'percent', value: 80 } })).page.scale).toEqual({ mode: 'percent', value: 80 });
    expect(parseJson(withPage({ scale: { mode: 'fitWidth' } })).page.scale).toEqual({ mode: 'fitWidth' });
    expect(parseJson(withPage({ scale: { mode: 'fitPages', wide: 1, tall: 1 } })).page.scale).toEqual({ mode: 'fitPages', wide: 1, tall: 1 });
  });

  it('accepts each font kind', () => {
    const font = (f: unknown) => parseJson(withStyle({ font: f })).style.font;
    expect(font({ kind: 'standard', id: 'times' })).toEqual({ kind: 'standard', id: 'times' });
    expect(font({ kind: 'bundled', id: 'lora' })).toEqual({ kind: 'bundled', id: 'lora', family: 'Lora' });
    expect(font({ kind: 'google', family: 'Inter' })).toEqual({ kind: 'google', family: 'Inter' });
    expect(font({ kind: 'local', postscriptName: 'ArialMT', family: 'Arial' })).toEqual({ kind: 'local', postscriptName: 'ArialMT', family: 'Arial' });
  });

  it('returns defaults for anything that is not an object', () => {
    for (const v of [null, undefined, 42, 'setup', [], true]) expect(parseSetup(v)).toEqual(defaultSetup());
  });

  it('fills missing sections and fields with defaults', () => {
    expect(parseSetup({})).toEqual(defaultSetup());
    const partial = parseJson({ page: { paper: 'a4' }, style: { bodySize: 12 } });
    expect(partial.page).toEqual({ ...defaultSetup().page, paper: 'a4' });
    expect(partial.style).toEqual({ ...defaultSetup().style, bodySize: 12 });
    expect(partial.hf).toEqual(defaultSetup().hf);
  });

  it('replaces invalid fields individually, keeping valid neighbors', () => {
    const s = parseJson(withPage({ paper: 'napkin', landscape: 'yes', order: 'sideways', gridlines: false, repeatHeader: 0 }));
    expect(s.page.paper).toBe('letter');
    expect(s.page.landscape).toBe(false);
    expect(s.page.order).toBe('downThenOver');
    expect(s.page.repeatHeader).toBe(true);
    expect(s.page.gridlines).toBe(false);
  });

  it('rejects strings where numbers are expected', () => {
    const s = parseJson({
      page: { customWidthIn: '5', margins: { top: '1', right: 0.5 }, scale: { mode: 'percent', value: '80' } },
      style: { bodySize: '12' },
      hf: { size: '10' },
      rows: { limit: '20' },
    });
    expect(s.page.customWidthIn).toBe(8.5);
    expect(s.page.margins).toEqual({ top: 0.75, right: 0.5, bottom: 0.75, left: 0.75 });
    expect(s.page.scale).toEqual({ mode: 'percent', value: 100 });
    expect(s.style.bodySize).toBe(10);
    expect(s.hf.size).toBe(9);
    expect(s.rows.limit).toBeNull();
  });

  it('rejects non-finite numbers', () => {
    const s = parseSetup({ style: { bodySize: NaN }, hf: { size: Infinity }, page: { margins: { top: -Infinity } } });
    expect(s.style.bodySize).toBe(10);
    expect(s.hf.size).toBe(9);
    expect(s.page.margins.top).toBe(0.75);
  });

  it('clamps out-of-range numbers', () => {
    const lo = parseJson({
      page: { customWidthIn: 1, customHeightIn: 0, margins: { top: -1, right: -0.1, bottom: 0, left: 0 }, scale: { mode: 'percent', value: 5 } },
      style: { bodySize: 2 }, hf: { size: 1 },
    });
    expect(lo.page.customWidthIn).toBe(3);
    expect(lo.page.customHeightIn).toBe(3);
    expect(lo.page.margins).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(lo.page.scale).toEqual({ mode: 'percent', value: 25 });
    expect(lo.style.bodySize).toBe(6);
    expect(lo.hf.size).toBe(6);

    const hi = parseJson({
      page: { customWidthIn: 99, customHeightIn: 1e9, margins: { top: 5, right: 3, bottom: 3.5, left: 100 }, scale: { mode: 'percent', value: 900 } },
      style: { bodySize: 99 }, hf: { size: 40 },
    });
    expect(hi.page.customWidthIn).toBe(48);
    expect(hi.page.customHeightIn).toBe(48);
    expect(hi.page.margins).toEqual({ top: 3, right: 3, bottom: 3, left: 3 });
    expect(hi.page.scale).toEqual({ mode: 'percent', value: 200 });
    expect(hi.style.bodySize).toBe(24);
    expect(hi.hf.size).toBe(18);
  });

  it('clamps fit-to-pages counts to whole numbers from 1 to 20', () => {
    expect(parseJson(withPage({ scale: { mode: 'fitPages', wide: 0, tall: 50 } })).page.scale).toEqual({ mode: 'fitPages', wide: 1, tall: 20 });
    expect(parseJson(withPage({ scale: { mode: 'fitPages', wide: 2.6, tall: 'x' } })).page.scale).toEqual({ mode: 'fitPages', wide: 3, tall: 1 });
  });

  it('falls back to fit width for an unknown scale mode', () => {
    expect(parseJson(withPage({ scale: { mode: 'zoom', value: 2 } })).page.scale).toEqual({ mode: 'fitWidth' });
    expect(parseJson(withPage({ scale: 'fitPages' })).page.scale).toEqual({ mode: 'fitWidth' });
  });

  it('accepts colors as #rrggbb or null, normalized to lowercase', () => {
    const s = parseJson(withStyle({
      header: { bold: true, fill: '#ABCDEF', color: null },
      leadColumn: { bold: false, fill: 'red' },
      zebra: { on: true, color: '#fff' },
      borderColor: 'url(javascript:alert(1))',
    }));
    expect(s.style.header).toEqual({ bold: true, fill: '#abcdef', color: null });
    expect(s.style.leadColumn.fill).toBeNull();
    expect(s.style.zebra.color).toBe('#fafafa');
    expect(s.style.borderColor).toBe('#d0d0d0');
  });

  it('keeps an explicit null fill but defaults a missing one', () => {
    expect(parseJson(withStyle({ header: { fill: null } })).style.header.fill).toBeNull();
    expect(parseJson(withStyle({ header: {} })).style.header.fill).toBe('#f2f2f2');
  });

  it('replaces invalid fonts with Helvetica', () => {
    const font = (f: unknown) => parseJson(withStyle({ font: f })).style.font;
    const helvetica = { kind: 'standard', id: 'helvetica' };
    expect(font({ kind: 'standard', id: 'comic-sans' })).toEqual(helvetica);
    expect(font({ kind: 'bundled', id: 'not-bundled' })).toEqual(helvetica);
    expect(font({ kind: 'google', family: '' })).toEqual(helvetica);
    expect(font({ kind: 'google', family: 7 })).toEqual(helvetica);
    expect(font({ kind: 'local', family: 'Arial' })).toEqual(helvetica);
    expect(font({ kind: 'remote', url: 'https://example.com/x.ttf' })).toEqual(helvetica);
    expect(font('helvetica')).toEqual(helvetica);
  });

  it('drops extra properties on fonts', () => {
    expect(parseJson(withStyle({ font: { kind: 'google', family: 'Lora', url: 'https://evil' } })).style.font).toEqual({ kind: 'google', family: 'Lora' });
  });

  it('validates header and footer slots one at a time', () => {
    const s = parseJson({
      hf: {
        title: 42,
        header: [{ kind: 'date' }, { kind: 'bogus' }, 'title'],
        footer: [{ kind: 'text', text: 5 }, { kind: 'text', text: 'Hi' }],
      },
    });
    expect(s.hf.title).toBe('');
    expect(s.hf.header).toEqual([{ kind: 'date' }, { kind: 'none' }, { kind: 'none' }]);
    expect(s.hf.footer).toEqual([{ kind: 'text', text: '' }, { kind: 'text', text: 'Hi' }, { kind: 'none' }]);
  });

  it('keeps exactly three slots', () => {
    const s = parseJson({ hf: { header: [{ kind: 'date' }, { kind: 'time' }, { kind: 'page' }, { kind: 'title' }] } });
    expect(s.hf.header).toHaveLength(3);
    expect(s.hf.footer).toHaveLength(3);
  });

  it('drops the text of a slot that is not custom text', () => {
    expect(parseJson({ hf: { header: [{ kind: 'date', text: 'x' }] } }).hf.header[0]).toEqual({ kind: 'date' });
  });

  it('caps long text', () => {
    const s = parseJson({ hf: { title: 'x'.repeat(10_000), header: [{ kind: 'text', text: 'y'.repeat(10_000) }] } });
    expect(s.hf.title.length).toBeLessThanOrEqual(SETUP_LIMITS.textMax);
    expect(s.hf.header[0].text!.length).toBeLessThanOrEqual(SETUP_LIMITS.textMax);
  });

  it('accepts a row limit of whole positive numbers or null', () => {
    expect(parseJson({ rows: { limit: 0 } }).rows.limit).toBeNull();
    expect(parseJson({ rows: { limit: -5 } }).rows.limit).toBeNull();
    expect(parseJson({ rows: { limit: 12.7 } }).rows.limit).toBe(12);
    expect(parseJson({ rows: { limit: null, includeBlank: 'true' } }).rows).toEqual({ limit: null, includeBlank: false });
  });

  it('validates column setups field by field', () => {
    const s = parseJson({
      columns: {
        order: ['c0', 'c1', 'c2'],
        byId: {
          c0: { include: 'no', width: { mode: 'fixed', inches: '2' }, align: 'justify', wrap: false },
          c1: { include: false, width: { mode: 'fixed', inches: 500 }, align: 'center' },
          c2: { width: { mode: 'fixed', inches: 0 } },
        },
      },
    });
    expect(s.columns.byId.c0).toEqual({ id: 'c0', include: true, width: { mode: 'auto' }, align: 'auto', wrap: false });
    expect(s.columns.byId.c1).toEqual({ id: 'c1', include: false, width: { mode: 'fixed', inches: SETUP_LIMITS.fixedWidthIn[1] }, align: 'center', wrap: true });
    expect(s.columns.byId.c2.width).toEqual({ mode: 'fixed', inches: SETUP_LIMITS.fixedWidthIn[0] });
  });

  it('keys column setups by their position in the order, ignoring a mismatched inner id', () => {
    const s = parseJson({ columns: { order: ['c0'], byId: { c0: { id: 'c9', include: false } } } });
    expect(s.columns.byId.c0.id).toBe('c0');
    expect(s.columns.byId.c0.include).toBe(false);
  });

  it('gives ordered columns without a setup the defaults and drops setups not in the order', () => {
    const s = parseJson({ columns: { order: ['c0', 'c1'], byId: { c1: { include: false }, c5: { include: false } } } });
    expect(s.columns.order).toEqual(['c0', 'c1']);
    expect(Object.keys(s.columns.byId).sort()).toEqual(['c0', 'c1']);
    expect(s.columns.byId.c0).toEqual(defaultColumnSetup('c0'));
  });

  it('drops duplicate and invalid column ids', () => {
    const s = parseJson({ columns: { order: ['c0', 'c0', 7, '', null, 'c1', 'x'.repeat(500)], byId: {} } });
    expect(s.columns.order).toEqual(['c0', 'c1']);
  });

  it('ignores prototype keys in hostile JSON', () => {
    const text = '{"__proto__":{"polluted":true},"columns":{"order":["__proto__","constructor","prototype","c0"],'
      + '"byId":{"__proto__":{"include":false},"constructor":{"include":false},"c0":{"include":false}}},'
      + '"style":{"__proto__":{"bodySize":20},"header":{"__proto__":{"bold":false}}}}';
    const s = parseSetup(JSON.parse(text));
    expect(s.columns.order).toEqual(['c0']);
    expect(Object.keys(s.columns.byId)).toEqual(['c0']);
    expect(Object.getPrototypeOf(s.columns.byId)).toBe(Object.prototype);
    expect(s.style.bodySize).toBe(10);
    expect(s.style.header.bold).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((s as unknown as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('drops unknown fields', () => {
    const s = parseJson({ ...defaultSetup(), extra: 1, page: { ...defaultSetup().page, extra: 2 } });
    expect(s).toEqual(defaultSetup());
  });

  it('always reports version 1', () => {
    expect(parseSetup({ version: 7 }).version).toBe(1);
  });

  it('does not share structure with its input', () => {
    const input = defaultSetup();
    const s = parseSetup(input);
    s.page.margins.top = 2;
    expect(input.page.margins.top).toBe(0.75);
  });
});

describe('reconcileColumns', () => {
  const cols = (...ids: string[]) => ids.map((id) => ({ id, name: id.toUpperCase() }));

  it('adds every column with defaults to an empty setup, in dataset order', () => {
    const s = reconcileColumns(defaultSetup(), cols('c0', 'c1', 'c2'));
    expect(s.columns.order).toEqual(['c0', 'c1', 'c2']);
    expect(s.columns.byId.c1).toEqual(defaultColumnSetup('c1'));
  });

  it('keeps the order and setups of surviving columns', () => {
    const base = defaultSetup();
    base.columns = {
      order: ['c2', 'c0', 'c1'],
      byId: {
        c0: { ...defaultColumnSetup('c0'), include: false },
        c1: defaultColumnSetup('c1'),
        c2: { ...defaultColumnSetup('c2'), align: 'right', width: { mode: 'fixed', inches: 2 } },
      },
    };
    const s = reconcileColumns(base, cols('c0', 'c1', 'c2'));
    expect(s.columns).toEqual(base.columns);
  });

  it('drops unknown ids and appends new ones with defaults', () => {
    const base = defaultSetup();
    base.columns = {
      order: ['c3', 'c1', 'c0'],
      byId: {
        c0: { ...defaultColumnSetup('c0'), wrap: false },
        c1: { ...defaultColumnSetup('c1'), include: false },
        c3: defaultColumnSetup('c3'),
      },
    };
    const s = reconcileColumns(base, cols('c0', 'c1', 'c4', 'c5'));
    expect(s.columns.order).toEqual(['c1', 'c0', 'c4', 'c5']);
    expect(Object.keys(s.columns.byId).sort()).toEqual(['c0', 'c1', 'c4', 'c5']);
    expect(s.columns.byId.c0.wrap).toBe(false);
    expect(s.columns.byId.c1.include).toBe(false);
    expect(s.columns.byId.c4).toEqual(defaultColumnSetup('c4'));
  });

  it('leaves the rest of the setup alone and does not mutate its input', () => {
    const base = { ...defaultSetup(), hf: { ...defaultSetup().hf, title: 'Kept' } };
    const before = JSON.stringify(base);
    const s = reconcileColumns(base, cols('c0'));
    expect(JSON.stringify(base)).toBe(before);
    expect(s.hf.title).toBe('Kept');
    expect(s.page).toEqual(base.page);
  });

  it('returns the same setup when nothing changes', () => {
    const s = reconcileColumns(defaultSetup(), cols('c0', 'c1'));
    expect(reconcileColumns(s, cols('c1', 'c0'))).toBe(s);
  });

  it('ignores duplicate dataset ids', () => {
    expect(reconcileColumns(defaultSetup(), cols('c0', 'c0', 'c1')).columns.order).toEqual(['c0', 'c1']);
  });
});

describe('clampStep', () => {
  it('clamps to the range and rounds to the step', () => {
    expect(clampStep(11.3, [6, 24], 0.5, 10)).toBe(11.5);
    expect(clampStep(40, [6, 24], 0.5, 10)).toBe(24);
    expect(clampStep(-3, [6, 24], 0.5, 10)).toBe(6);
    expect(clampStep(7.6, [1, 20], 1, 1)).toBe(8);
  });

  it('falls back when the value is not a finite number', () => {
    expect(clampStep(Number.NaN, [6, 24], 0.5, 10)).toBe(10);
    expect(clampStep(Number.POSITIVE_INFINITY, [6, 24], 0.5, 10)).toBe(10);
  });
});
