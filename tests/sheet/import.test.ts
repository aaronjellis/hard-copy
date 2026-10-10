import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseDelimited, detectDelimiter, parseWorkbook, detectHeaderRow, transpose, buildDataset,
  renameColumn, setIncluded, setAllIncluded, setHeaderRow, setTransposed, recordFromRow, carryRenames,
  includedCount, fieldKey, ImportError, UNREADABLE_FILE, NO_ROWS, READER_UNAVAILABLE,
} from '../../src/lib/sheet/import';

const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`../fixtures/sheet/${name}`, import.meta.url))));

describe('parseDelimited', () => {
  it('parses a CSV with quoted commas, quotes, and embedded newlines', () => {
    const csv = 'Name,Address\n"Smith, Jane","12 Elm St\nApt 4"\n"Bob ""The Builder""",Main St\n';
    expect(parseDelimited(csv)).toEqual([
      ['Name', 'Address'],
      ['Smith, Jane', '12 Elm St\nApt 4'],
      ['Bob "The Builder"', 'Main St'],
    ]);
  });

  it('parses TSV', () => {
    expect(parseDelimited('Name\tCity\nAda\tLondon, UK\n')).toEqual([
      ['Name', 'City'],
      ['Ada', 'London, UK'],
    ]);
  });

  it('parses semicolon CSV, as exported by European Excel', () => {
    expect(parseDelimited('Name;City;Amount\nAda;London;1,5\nAlan;Wilmslow;2,25')).toEqual([
      ['Name', 'City', 'Amount'],
      ['Ada', 'London', '1,5'],
      ['Alan', 'Wilmslow', '2,25'],
    ]);
  });

  it('handles CRLF, including inside quoted fields', () => {
    expect(parseDelimited('a,b\r\n"x\r\ny",z\r\n')).toEqual([
      ['a', 'b'],
      ['x\r\ny', 'z'],
    ]);
  });

  it('handles lone CR line endings', () => {
    expect(parseDelimited('a,b\rc,d')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('strips a UTF-8 BOM', () => {
    const rows = parseDelimited('﻿Name,City\nAda,London');
    expect(rows[0][0]).toBe('Name');
  });

  it('treats a paste with no tabs or commas as a single column', () => {
    expect(parseDelimited('Ada Lovelace\nAlan Turing\n')).toEqual([['Ada Lovelace'], ['Alan Turing']]);
  });

  it('keeps empty fields and trailing delimiters', () => {
    expect(parseDelimited('a,,c\n,,\n')).toEqual([['a', '', 'c'], ['', '', '']]);
  });

  it('honors an explicit delimiter', () => {
    expect(parseDelimited('a,b|c', { delimiter: '|' })).toEqual([['a,b', 'c']]);
  });

  it('returns no rows for empty text', () => {
    expect(parseDelimited('')).toEqual([]);
    expect(parseDelimited('﻿')).toEqual([]);
  });

  it('ends an unclosed quoted field at the end of the text', () => {
    expect(parseDelimited('a,"b\nc,d')).toEqual([['a', 'b\nc,d']]);
    expect(parseDelimited('"abc', { delimiter: ',' })).toEqual([['abc']]);
  });

  it('treats a quote after leading spaces as a quoted field', () => {
    expect(parseDelimited('a, "b,c"\nd,  "e ""f"" g"\n')).toEqual([['a', 'b,c'], ['d', 'e "f" g']]);
  });

  it('keeps leading spaces when no quote follows them', () => {
    expect(parseDelimited('a,  b\n', { delimiter: ',' })).toEqual([['a', '  b']]);
  });

  it('still splits on a space delimiter', () => {
    expect(parseDelimited('a  "b c"', { delimiter: ' ' })).toEqual([['a', '', 'b c']]);
  });
});

describe('detectDelimiter', () => {
  it('prefers tab for spreadsheet pastes that contain commas', () => {
    expect(detectDelimiter('Name\tAddress\nSmith, Jane\t12 Elm St, Apt 4')).toBe('\t');
  });

  it('picks semicolon when commas are only decimal separators', () => {
    expect(detectDelimiter('a;b;c\n1,5;2,5;3\n4;5;6,1')).toBe(';');
  });

  it('ignores delimiters inside quotes', () => {
    expect(detectDelimiter('"a;b;c",d\n"e;f;g",h')).toBe(',');
  });

  it('skips leading blank lines', () => {
    expect(detectDelimiter('\n\n  \na\tb\nc\td')).toBe('\t');
  });

  it('samples only the first 64 KB, ignoring a partial last line', () => {
    const text = 'a\tb\nc\td\n' + 'x,'.repeat(40_000) + '\n' + 'y,'.repeat(40_000);
    expect(detectDelimiter(text)).toBe('\t');
  });

  it('strips a BOM before counting', () => {
    expect(detectDelimiter('\ufeffa;b\nc;d')).toBe(';');
  });
});

describe('detectHeaderRow', () => {
  it('is true for a labeled first row', () => {
    expect(detectHeaderRow([['Name', 'City', 'ZIP'], ['Ada', 'London', '02134']])).toBe(true);
  });

  it('is false when the first row is mostly numeric', () => {
    expect(detectHeaderRow([['1', '2', 'x'], ['3', '4', 'y']])).toBe(false);
    expect(detectHeaderRow([['$1,200.50', '2024-01-15', '15%'], ['a', 'b', 'c']])).toBe(false);
  });

  it('is false when the first row has an empty cell', () => {
    expect(detectHeaderRow([['Name', '', 'ZIP'], ['Ada', 'London', '02134']])).toBe(false);
  });

  it('is false when a ragged first row is shorter than the data', () => {
    expect(detectHeaderRow([['Name', 'City'], ['Ada', 'London', '02134']])).toBe(false);
  });

  it('is false when the first row has duplicates, ignoring case', () => {
    expect(detectHeaderRow([['Name', 'name'], ['Ada', 'Alan']])).toBe(false);
  });

  it('is false without at least one data row', () => {
    expect(detectHeaderRow([['Name', 'City']])).toBe(false);
    expect(detectHeaderRow([['Name', 'City'], ['', '']])).toBe(false);
    expect(detectHeaderRow([])).toBe(false);
  });

  it('skips leading empty rows', () => {
    expect(detectHeaderRow([['', ''], ['Name', 'City'], ['Ada', 'London']])).toBe(true);
  });

  it('is false for a single column', () => {
    expect(detectHeaderRow([['Name'], ['Ada'], ['Alan']])).toBe(false);
    expect(detectHeaderRow([['Name', ''], ['Ada', '  ']])).toBe(false);
  });

  it('ignores trailing columns that are empty everywhere', () => {
    expect(detectHeaderRow([['Name', 'City', '', ' '], ['Ada', 'London', '', '']])).toBe(true);
    expect(detectHeaderRow([[' Name ', 'City  '], ['Ada', 'London']])).toBe(true);
  });
});

describe('transpose', () => {
  it('swaps rows and columns, padding ragged rows', () => {
    expect(transpose([['a', 'b', 'c'], ['d']])).toEqual([['a', 'd'], ['b', ''], ['c', '']]);
  });

  it('handles empty input', () => {
    expect(transpose([])).toEqual([]);
  });
});

describe('buildDataset', () => {
  const opts = { sourceName: 'list.csv', headerRow: true, transposed: false };

  it('builds columns from the header row and trims cells', () => {
    const ds = buildDataset([[' Name ', 'City'], ['  Ada ', ' London'], ['Alan', 'Wilmslow']], opts);
    expect(ds.sourceName).toBe('list.csv');
    expect(ds.columns).toEqual([
      { id: 'c0', name: 'Name', originalName: 'Name' },
      { id: 'c1', name: 'City', originalName: 'City' },
    ]);
    expect(ds.rows).toEqual([['Ada', 'London'], ['Alan', 'Wilmslow']]);
    expect(ds.included).toEqual([true, true]);
  });

  it('names columns Column N without a header row', () => {
    const ds = buildDataset([['Ada', 'London'], ['Alan', 'Wilmslow']], { ...opts, headerRow: false });
    expect(ds.columns.map((c) => c.name)).toEqual(['Column 1', 'Column 2']);
    expect(ds.rows).toHaveLength(2);
  });

  it('drops empty rows, including whitespace-only rows', () => {
    const ds = buildDataset([['', ''], ['Name', 'City'], ['Ada', 'London'], ['', '  '], [], ['Alan', '']], opts);
    expect(ds.columns.map((c) => c.name)).toEqual(['Name', 'City']);
    expect(ds.rows).toEqual([['Ada', 'London'], ['Alan', '']]);
    expect(ds.included).toEqual([true, true]);
  });

  it('pads ragged rows to the widest row', () => {
    const ds = buildDataset([['Name', 'City', 'ZIP'], ['Ada'], ['Alan', 'Wilmslow', 'SK9', 'extra']], opts);
    expect(ds.columns.map((c) => c.name)).toEqual(['Name', 'City', 'ZIP', 'Column 4']);
    expect(ds.rows).toEqual([['Ada', '', '', ''], ['Alan', 'Wilmslow', 'SK9', 'extra']]);
  });

  it('drops trailing columns that are empty in every row', () => {
    const ds = buildDataset([['Name', 'City', '', ''], ['Ada', 'London', '', ' ']], opts);
    expect(ds.columns.map((c) => c.name)).toEqual(['Name', 'City']);
    expect(ds.rows).toEqual([['Ada', 'London']]);
  });

  it('names empty headers Column N and dedupes duplicates, ignoring case', () => {
    const ds = buildDataset(
      [['Name', '', 'name', 'Name', 'Column 2', 'City'], ['a', 'b', 'c', 'd', 'e', 'f']],
      opts,
    );
    expect(ds.columns.map((c) => c.name)).toEqual(['Name', 'Column 2', 'name 2', 'Name 3', 'Column 2 2', 'City']);
    expect(ds.columns.map((c) => c.id)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5']);
  });

  it('transposes before everything else', () => {
    const ds = buildDataset(
      [['Name', 'Ada', 'Alan'], ['City', 'London', ''], ['', '', '']],
      { ...opts, transposed: true },
    );
    expect(ds.transposed).toBe(true);
    expect(ds.columns.map((c) => c.name)).toEqual(['Name', 'City']);
    expect(ds.rows).toEqual([['Ada', 'London'], ['Alan', '']]);
  });

  it('handles a header-only and an empty source', () => {
    expect(buildDataset([['Name', 'City']], opts).rows).toEqual([]);
    const empty = buildDataset([], opts);
    expect(empty.columns).toEqual([]);
    expect(empty.rows).toEqual([]);
  });

  it('strips braces from header names so they work as tokens', () => {
    const ds = buildDataset([['{{Name}}', 'Ci{t}y', '{}', '{ }'], ['a', 'b', 'c', 'd']], opts);
    expect(ds.columns.map((c) => c.name)).toEqual(['Name', 'City', 'Column 3', 'Column 4']);
  });

  it('dedupes names that differ only by case or inner spaces', () => {
    const ds = buildDataset([['Zip Code', 'zip  code', 'ZIP CODE'], ['1', '2', '3']], opts);
    expect(ds.columns.map((c) => c.name)).toEqual(['Zip Code', 'zip  code 2', 'ZIP CODE 3']);
  });

  it('dedupes 10,000 duplicate headers quickly', () => {
    const header = Array.from({ length: 10_000 }, () => 'Name');
    const t0 = performance.now();
    const ds = buildDataset([header, header.map(() => 'x')], opts);
    expect(performance.now() - t0).toBeLessThan(200);
    expect(ds.columns[0].name).toBe('Name');
    expect(ds.columns[1].name).toBe('Name 2');
    expect(ds.columns[9_999].name).toBe('Name 10000');
    expect(new Set(ds.columns.map((c) => c.name.toLowerCase())).size).toBe(10_000);
  });

  it('carries sheet info for workbooks', () => {
    const ds = buildDataset([['a']], { ...opts, sheetNames: ['One', 'Two'], activeSheet: 'Two' });
    expect(ds.sheetNames).toEqual(['One', 'Two']);
    expect(ds.activeSheet).toBe('Two');
  });
});

describe('dataset edits', () => {
  const base = () =>
    buildDataset(
      [['Name', 'City'], ['Ada', 'London'], ['Alan', 'Wilmslow'], ['Grace', 'Arlington']],
      { sourceName: 'x.csv', headerRow: true, transposed: false },
    );

  it('renameColumn sets the name and keeps originalName', () => {
    const before = base();
    const ds = renameColumn(before, 'c1', '  Town ');
    expect(ds.columns[1]).toEqual({ id: 'c1', name: 'Town', originalName: 'City' });
    expect(before.columns[1].name).toBe('City');
  });

  it('renameColumn to empty restores the original name', () => {
    const ds = renameColumn(renameColumn(base(), 'c1', 'Town'), 'c1', '   ');
    expect(ds.columns[1].name).toBe('City');
  });

  it('renameColumn dedupes against other columns', () => {
    const ds = renameColumn(base(), 'c1', 'name');
    expect(ds.columns[1].name).toBe('name 2');
    expect(renameColumn(base(), 'c0', 'NAME').columns[0].name).toBe('NAME');
  });

  it('renameColumn strips braces and dedupes on the token key', () => {
    expect(renameColumn(base(), 'c1', ' {{Town}} ').columns[1].name).toBe('Town');
    expect(renameColumn(base(), 'c1', '{{}}').columns[1].name).toBe('City');
    const ds = buildDataset([['Zip Code', 'City'], ['1', '2']], { sourceName: 'x', headerRow: true, transposed: false });
    expect(renameColumn(ds, 'c1', 'zip   CODE').columns[1].name).toBe('zip   CODE 2');
  });

  it('renameColumn ignores unknown ids', () => {
    const ds = base();
    expect(renameColumn(ds, 'c9', 'X')).toBe(ds);
  });

  it('setIncluded and setAllIncluded toggle rows without mutating', () => {
    const before = base();
    const one = setIncluded(before, 1, false);
    expect(one.included).toEqual([true, false, true]);
    expect(before.included).toEqual([true, true, true]);
    expect(includedCount(one)).toBe(2);
    expect(setIncluded(one, 9, false)).toBe(one);
    expect(setAllIncluded(one, false).included).toEqual([false, false, false]);
    expect(setAllIncluded(one, true).included).toEqual([true, true, true]);
  });

  it('setHeaderRow rebuilds from the source cells', () => {
    const off = setHeaderRow(base(), false);
    expect(off.headerRow).toBe(false);
    expect(off.columns.map((c) => c.name)).toEqual(['Column 1', 'Column 2']);
    expect(off.rows[0]).toEqual(['Name', 'City']);
    expect(off.included).toHaveLength(4);
    const on = setHeaderRow(off, true);
    expect(on.columns.map((c) => c.name)).toEqual(['Name', 'City']);
    expect(on.rows).toHaveLength(3);
  });

  it('setTransposed rebuilds from the source cells and back', () => {
    const t = setTransposed(base(), true);
    expect(t.transposed).toBe(true);
    expect(t.columns.map((c) => c.name)).toEqual(['Name', 'Ada', 'Alan', 'Grace']);
    expect(t.rows).toEqual([['City', 'London', 'Wilmslow', 'Arlington']]);
    expect(setTransposed(t, false)).toEqual(base());
  });

  it('recordFromRow keys values by current column names', () => {
    const ds = renameColumn(base(), 'c1', 'Town');
    expect(recordFromRow(ds, 1)).toEqual({ Name: 'Alan', Town: 'Wilmslow' });
    expect(recordFromRow(ds, 99)).toEqual({ Name: '', Town: '' });
  });

  it('recordFromRow keeps the first of two same-named columns', () => {
    const ds = { columns: [{ name: 'A' }, { name: 'A' }, { name: 'B' }], rows: [['1', '2', '3']] };
    expect(recordFromRow(ds, 0)).toEqual({ A: '1', B: '3' });
  });

  it('keeps a __proto__ column as an own property', () => {
    const ds = buildDataset([['__proto__', 'constructor'], ['a', 'b']], { sourceName: 'x', headerRow: true, transposed: false });
    const record = recordFromRow(ds, 0);
    expect(Object.keys(record)).toEqual(['__proto__', 'constructor']);
    expect(Object.hasOwn(record, '__proto__')).toBe(true);
    expect(record['__proto__']).toBe('a');
    expect(record.constructor).toBe('b');
  });
});

describe('fieldKey', () => {
  it('ignores case, outer spaces, and inner whitespace runs', () => {
    expect(fieldKey('  First \t Name ')).toBe('first name');
    expect(fieldKey('ZIP')).toBe(fieldKey('zip'));
  });
});

describe('carryRenames', () => {
  const base = () =>
    buildDataset(
      [['Name', 'City', 'Zip'], ['Ada', 'London', '1'], ['Alan', 'Wilmslow', '2']],
      { sourceName: 'x.csv', headerRow: true, transposed: false },
    );

  it('keeps a rename across transpose on and off', () => {
    const renamed = renameColumn(base(), 'c0', 'Full Name');
    const on = carryRenames(renamed, setTransposed(renamed, true));
    expect(on.columns[0]).toEqual({ id: 'c0', name: 'Full Name', originalName: 'Name' });
    const off = carryRenames(on, setTransposed(on, false));
    expect(off.columns.map((c) => c.name)).toEqual(['Full Name', 'City', 'Zip']);
    expect(off.columns.map((c) => c.originalName)).toEqual(['Name', 'City', 'Zip']);
  });

  it('drops a rename whose column no longer exists', () => {
    const renamed = renameColumn(base(), 'c1', 'Town');
    const off = carryRenames(renamed, setHeaderRow(renamed, false));
    expect(off.columns.map((c) => c.name)).toEqual(['Column 1', 'Column 2', 'Column 3']);
  });

  it('returns next unchanged when nothing was renamed', () => {
    const ds = base();
    const next = setTransposed(ds, true);
    expect(carryRenames(ds, next)).toBe(next);
  });

  it('keeps swapped names', () => {
    const swapped = renameColumn(renameColumn(renameColumn(base(), 'c0', 'Tmp'), 'c1', 'Name'), 'c0', 'City');
    expect(swapped.columns.map((c) => c.name)).toEqual(['City', 'Name', 'Zip']);
    const rebuilt = setTransposed(setTransposed(swapped, true), false);
    expect(carryRenames(swapped, rebuilt).columns.map((c) => c.name)).toEqual(['City', 'Name', 'Zip']);
  });

  it('dedupes a carried name against a column that appears in the rebuild', () => {
    // Header off: Column 1..3. Rename Column 1 to "Name"; header on brings back a real "Name" column.
    const off = setHeaderRow(base(), false);
    const renamed = renameColumn(off, 'c1', 'Name');
    expect(renamed.columns[1].originalName).toBe('Column 2');
    const t = carryRenames(renamed, setTransposed(renamed, true));
    expect(t.columns.find((c) => c.originalName === 'Column 2')?.name).toBe('Name');
    const on = carryRenames(renamed, buildDataset(renamed.source, {
      sourceName: 'x.csv', headerRow: false, transposed: false,
    }));
    expect(on.columns.map((c) => c.name)).toEqual(['Column 1', 'Name', 'Column 3']);
  });

  it('does not mutate its inputs', () => {
    const renamed = renameColumn(base(), 'c0', 'Full Name');
    const next = setTransposed(renamed, true);
    const before = structuredClone(next.columns);
    carryRenames(renamed, next);
    expect(next.columns).toEqual(before);
  });
});

describe('parseWorkbook', () => {
  it('reads every sheet of an XLSX as formatted strings', async () => {
    const { sheets } = await parseWorkbook(fixture('sample.xlsx'));
    expect(sheets.map((s) => s.name)).toEqual(['Contacts', 'Sideways']);
    const contacts = sheets[0].cells.filter((r) => r.some((c) => c !== ''));
    expect(contacts[0]).toEqual(['Name', 'Street', 'City', 'State', 'ZIP', 'Joined']);
    // ZIP keeps its leading zero and the date keeps its display format.
    expect(contacts[1]).toEqual(['Ada Lovelace', '12 St James Sq', 'London', 'LDN', '02134', '2024-01-15']);
    expect(sheets[1].cells).toEqual([
      ['Name', 'Margaret Hamilton', 'Katherine Johnson'],
      ['City', 'Cambridge', 'Hampton'],
      ['State', 'MA', 'VA'],
    ]);
  });

  it('accepts an ArrayBuffer', async () => {
    const bytes = fixture('sample.xlsx');
    const { sheets } = await parseWorkbook(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(sheets).toHaveLength(2);
  });

  it('feeds buildDataset end to end', async () => {
    const { sheets } = await parseWorkbook(fixture('sample.xlsx'));
    const contacts = sheets[0].cells;
    const ds = buildDataset(contacts, {
      sourceName: 'sample.xlsx',
      headerRow: detectHeaderRow(contacts),
      transposed: false,
      sheetNames: sheets.map((s) => s.name),
      activeSheet: 'Contacts',
    });
    expect(ds.headerRow).toBe(true);
    expect(ds.rows).toHaveLength(3);
    expect(recordFromRow(ds, 2)).toMatchObject({ Name: 'Alan Turing', Street: 'Bletchley Park', ZIP: '90210' });

    const side = sheets[1].cells;
    const t = buildDataset(side, { sourceName: 'sample.xlsx', headerRow: true, transposed: true });
    expect(t.columns.map((c) => c.name)).toEqual(['Name', 'City', 'State']);
    expect(t.rows).toEqual([['Margaret Hamilton', 'Cambridge', 'MA'], ['Katherine Johnson', 'Hampton', 'VA']]);
  });

  it('rejects an unreadable file with a friendly message', async () => {
    const broken = fixture('sample.xlsx').slice(0, 64);
    await expect(parseWorkbook(broken)).rejects.toThrow(ImportError);
    await expect(parseWorkbook(broken)).rejects.toThrow(UNREADABLE_FILE);
  });

  it('rejects a workbook with no rows', async () => {
    await expect(parseWorkbook(new Uint8Array(0))).rejects.toThrow(NO_ROWS);
  });
});

describe('parseWorkbook when the reader fails to load', () => {
  afterEach(() => {
    vi.doUnmock('xlsx');
    vi.resetModules();
  });

  it('throws an ImportError instead of a raw load error', async () => {
    vi.resetModules();
    vi.doMock('xlsx', () => {
      throw new TypeError('Failed to fetch dynamically imported module');
    });
    const fresh = await import('../../src/lib/sheet/import');
    const err = await fresh.parseWorkbook(fixture('sample.xlsx')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(fresh.ImportError);
    expect((err as Error).message).toBe(READER_UNAVAILABLE);
    expect((err as Error).cause).toBeInstanceOf(Error);
  });
});

describe('parseWorkbook codepage tables', () => {
  afterEach(() => {
    vi.doUnmock('xlsx/dist/cpexcel.full.mjs');
    vi.resetModules();
  });

  async function withSpy() {
    vi.resetModules();
    const loaded = vi.fn();
    vi.doMock('xlsx/dist/cpexcel.full.mjs', async (importOriginal) => {
      loaded();
      return importOriginal();
    });
    return { loaded, mod: await import('../../src/lib/sheet/import') };
  }

  it('skips them for .xlsx', async () => {
    const { loaded, mod } = await withSpy();
    const { sheets } = await mod.parseWorkbook(fixture('sample.xlsx'));
    expect(sheets).toHaveLength(2);
    expect(loaded).not.toHaveBeenCalled();
  });

  it('loads them for legacy .xls', async () => {
    const { loaded, mod } = await withSpy();
    const { sheets } = await mod.parseWorkbook(fixture('sample.xlsx'), { legacy: true });
    expect(sheets).toHaveLength(2);
    expect(loaded).toHaveBeenCalledTimes(1);
  });
});
