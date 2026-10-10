import { describe, it, expect } from 'vitest';
import { columnsSummary, headerFooterSummary, pageSummary, styleSummary } from '../../src/lib/setup/summary';
import { defaultSetup, reconcileColumns, type Setup } from '../../src/lib/setup/setup';
import { updateColumn } from '../../src/lib/setup/columns';

describe('pageSummary', () => {
  it('names the paper, orientation, and scale', () => {
    const s = defaultSetup();
    expect(pageSummary(s)).toBe('Letter · Portrait · Fit to width');
    expect(pageSummary({ ...s, page: { ...s.page, paper: 'a4', landscape: true, scale: { mode: 'percent', value: 75 } } }))
      .toBe('A4 · Landscape · 75%');
    expect(pageSummary({ ...s, page: { ...s.page, scale: { mode: 'fitPages', wide: 2, tall: 1 } } }))
      .toBe('Letter · Portrait · Fit to 2 × 1 pages');
    expect(pageSummary({ ...s, page: { ...s.page, paper: 'custom', customWidthIn: 4, customHeightIn: 6.125 } }))
      .toBe('4 × 6.13 in · Portrait · Fit to width');
  });
});

describe('columnsSummary', () => {
  const ids = ['c0', 'c1', 'c2'];
  const base = reconcileColumns(defaultSetup(), ids.map((id) => ({ id, name: id })));

  it('counts included columns and notes a row limit', () => {
    expect(columnsSummary(base, ids)).toBe('3 of 3 columns');
    const one = updateColumn(base, 'c1', { include: false });
    expect(columnsSummary({ ...one, rows: { ...one.rows, limit: 20 } }, ids)).toBe('2 of 3 columns · first 20 rows');
    expect(columnsSummary({ ...base, rows: { ...base.rows, limit: 1 } }, ['c0'])).toBe('1 of 1 column · first 1 row');
  });

  it('says when no sheet is loaded', () => {
    expect(columnsSummary(base, null)).toBe('No spreadsheet loaded');
  });
});

describe('styleSummary', () => {
  it('names the font and size, then zebra and borders', () => {
    const s = defaultSetup();
    expect(styleSummary(s)).toBe('Helvetica 10pt · zebra');
    const plain: Setup = {
      ...s,
      style: { ...s.style, font: { kind: 'google', family: 'Lora' }, bodySize: 11.5, zebra: { ...s.style.zebra, on: false }, borders: 'none' },
    };
    expect(styleSummary(plain)).toBe('Lora 11.5pt · no borders');
  });
});

describe('headerFooterSummary', () => {
  it('lists the slots that print, once each', () => {
    const s = defaultSetup();
    expect(headerFooterSummary(s)).toBe('Title · Page N of M');
    const hf = { ...s.hf, header: [{ kind: 'title' }, { kind: 'none' }, { kind: 'date' }], footer: [{ kind: 'text', text: 'x' }, { kind: 'pageOf' }, { kind: 'title' }] } as Setup['hf'];
    expect(headerFooterSummary({ ...s, hf })).toBe('Title · Date · Custom text · Page N of M');
  });

  it('says None when nothing prints', () => {
    const s = defaultSetup();
    const none = { kind: 'none' } as const;
    expect(headerFooterSummary({ ...s, hf: { ...s.hf, header: [none, none, none], footer: [none, none, none] } })).toBe('None');
  });
});
