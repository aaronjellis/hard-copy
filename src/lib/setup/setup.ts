import type { FontRef } from '../fonts/types';
import { bundledFontRef, getBundledFont } from '../fonts/catalog';
import {
  CUSTOM_PAPER_MAX_IN, CUSTOM_PAPER_MIN_IN, PAPER_IDS, PAPER_SIZES, marginsForPreset,
  type Margins, type PaperId,
} from './paper';
import { SLOT_KINDS, type Slot } from './hf';

export type { Margins, PaperId } from './paper';
export type { Slot, SlotKind } from './hf';

export const SETUP_VERSION = 1;

export type Scale =
  | { mode: 'fitWidth' }
  | { mode: 'fitPages'; wide: number; tall: number }
  | { mode: 'percent'; value: number };

export type PageOrder = 'downThenOver' | 'overThenDown';
export type ColumnAlign = 'auto' | 'left' | 'center' | 'right';
export type ColumnWidth = { mode: 'auto' } | { mode: 'fixed'; inches: number };
export type CellPadding = 'compact' | 'normal' | 'relaxed';
export type Borders = 'hairline' | 'none';

export type ColumnSetup = {
  /** Dataset column id. */
  id: string;
  include: boolean;
  width: ColumnWidth;
  align: ColumnAlign;
  wrap: boolean;
};

export type PageSetup = {
  paper: PaperId;
  customWidthIn: number;
  customHeightIn: number;
  landscape: boolean;
  margins: Margins;
  scale: Scale;
  repeatHeader: boolean;
  gridlines: boolean;
  order: PageOrder;
};

export type StyleSetup = {
  font: FontRef;
  bodySize: number;
  header: { bold: boolean; fill: string | null; color: string | null };
  leadColumn: { bold: boolean; fill: string | null };
  zebra: { on: boolean; color: string };
  padding: CellPadding;
  borders: Borders;
  borderColor: string;
};

export type HeaderFooterSetup = { title: string; header: [Slot, Slot, Slot]; footer: [Slot, Slot, Slot]; size: number };

/** Everything about printing except the data. Persisted inside the profile; the theme lives on the profile. */
export type Setup = {
  version: typeof SETUP_VERSION;
  page: PageSetup;
  /** Keyed by dataset column id; `order` lists every id that has a setup. */
  columns: { order: string[]; byId: Record<string, ColumnSetup> };
  rows: { limit: number | null; includeBlank: boolean };
  style: StyleSetup;
  hf: HeaderFooterSetup;
};

/**
 * A number field's committed value: `raw` clamped to `range` and rounded to the nearest `step`;
 * `fallback` when `raw` is not a finite number (an emptied field).
 */
export function clampStep(raw: number, [min, max]: readonly [number, number], step: number, fallback: number): number {
  if (!Number.isFinite(raw)) return fallback;
  const clamped = Math.min(max, Math.max(min, raw));
  return Math.round(clamped / step) * step;
}

/** Inclusive [min, max] ranges for numeric fields, plus text caps. Inches unless noted. */
export const SETUP_LIMITS = Object.freeze({
  customPaperIn: [CUSTOM_PAPER_MIN_IN, CUSTOM_PAPER_MAX_IN] as const,
  marginIn: [0, 3] as const,
  scalePercent: [25, 200] as const,
  fitPages: [1, 20] as const,
  bodySizePt: [6, 24] as const,
  hfSizePt: [6, 18] as const,
  fixedWidthIn: [0.1, 48] as const,
  /** Longest title or custom slot text kept. */
  textMax: 200,
  /** Most columns kept in a setup. */
  columnsMax: 1000,
});

export function defaultColumnSetup(id: string): ColumnSetup {
  return { id, include: true, width: { mode: 'auto' }, align: 'auto', wrap: true };
}

export function defaultSetup(): Setup {
  const letter = PAPER_SIZES.letter;
  return {
    version: SETUP_VERSION,
    page: {
      paper: 'letter',
      customWidthIn: letter.widthIn,
      customHeightIn: letter.heightIn,
      landscape: false,
      margins: marginsForPreset('normal'),
      scale: { mode: 'fitWidth' },
      repeatHeader: true,
      gridlines: true,
      order: 'downThenOver',
    },
    columns: { order: [], byId: {} },
    rows: { limit: null, includeBlank: false },
    style: {
      font: { kind: 'standard', id: 'helvetica' },
      bodySize: 10,
      header: { bold: true, fill: '#f2f2f2', color: null },
      leadColumn: { bold: false, fill: null },
      zebra: { on: true, color: '#fafafa' },
      padding: 'normal',
      borders: 'hairline',
      borderColor: '#d0d0d0',
    },
    hf: {
      title: '',
      header: [{ kind: 'title' }, { kind: 'none' }, { kind: 'none' }],
      footer: [{ kind: 'none' }, { kind: 'pageOf' }, { kind: 'none' }],
      size: 9,
    },
  };
}

/**
 * Validate an untrusted setup (stored or imported JSON). Never throws: anything that isn't an object
 * yields the defaults, and each missing or invalid field falls back to its default on its own.
 * Numbers out of range are clamped; strings are never coerced to numbers. Unknown fields are dropped.
 */
export function parseSetup(value: unknown): Setup {
  const d = defaultSetup();
  const raw = obj(value);
  return {
    version: SETUP_VERSION,
    page: parsePage(obj(get(raw, 'page')), d.page),
    columns: parseColumns(obj(get(raw, 'columns'))),
    rows: parseRows(obj(get(raw, 'rows')), d.rows),
    style: parseStyle(obj(get(raw, 'style')), d.style),
    hf: parseHf(obj(get(raw, 'hf')), d.hf),
  };
}

/**
 * Fit the column setups to a dataset's columns: setups for ids the dataset lacks are dropped, surviving
 * columns keep their order and settings, and new columns are appended in dataset order with defaults.
 * Returns `setup` itself when nothing changes.
 */
export function reconcileColumns(setup: Setup, columns: readonly { id: string; name: string }[]): Setup {
  const ids = new Set(columns.map((c) => c.id));
  const kept = setup.columns.order.filter((id) => ids.has(id) && Object.hasOwn(setup.columns.byId, id));
  const keptSet = new Set(kept);
  const added = [...ids].filter((id) => !keptSet.has(id));
  if (added.length === 0 && kept.length === setup.columns.order.length && kept.length === Object.keys(setup.columns.byId).length) {
    return setup;
  }
  const byId: Record<string, ColumnSetup> = {};
  for (const id of kept) byId[id] = setup.columns.byId[id];
  for (const id of added) byId[id] = defaultColumnSetup(id);
  return { ...setup, columns: { order: [...kept, ...added], byId } };
}

// --- parsing helpers ---

type Obj = Record<string, unknown>;

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const COLUMN_ID = /^[\w.-]{1,64}$/;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function obj(v: unknown): Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : {};
}

/** An own property only, so inherited members (`constructor`, `toString`) never leak in. */
function get(o: Obj, key: string): unknown {
  return Object.hasOwn(o, key) ? o[key] : undefined;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function num(v: unknown, [min, max]: readonly [number, number], fallback: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

function int(v: unknown, range: readonly [number, number], fallback: number): number {
  return num(typeof v === 'number' ? Math.round(v) : v, range, fallback);
}

function oneOf<T extends string>(v: unknown, options: readonly T[], fallback: T): T {
  return typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : fallback;
}

function text(v: unknown, fallback: string): string {
  return typeof v === 'string' ? v.slice(0, SETUP_LIMITS.textMax) : fallback;
}

function color(v: unknown, fallback: string): string {
  return typeof v === 'string' && HEX_COLOR.test(v) ? v.toLowerCase() : fallback;
}

/** A color or null; an explicit null clears it, a missing or invalid value yields the fallback. */
function optionalColor(o: Obj, key: string, fallback: string | null): string | null {
  const v = get(o, key);
  if (v === null) return null;
  return typeof v === 'string' && HEX_COLOR.test(v) ? v.toLowerCase() : fallback;
}

function parsePage(o: Obj, d: PageSetup): PageSetup {
  const m = obj(get(o, 'margins'));
  const margin = (side: keyof Margins) => num(get(m, side), SETUP_LIMITS.marginIn, d.margins[side]);
  return {
    paper: oneOf(get(o, 'paper'), PAPER_IDS, d.paper),
    customWidthIn: num(get(o, 'customWidthIn'), SETUP_LIMITS.customPaperIn, d.customWidthIn),
    customHeightIn: num(get(o, 'customHeightIn'), SETUP_LIMITS.customPaperIn, d.customHeightIn),
    landscape: bool(get(o, 'landscape'), d.landscape),
    margins: { top: margin('top'), right: margin('right'), bottom: margin('bottom'), left: margin('left') },
    scale: parseScale(obj(get(o, 'scale'))),
    repeatHeader: bool(get(o, 'repeatHeader'), d.repeatHeader),
    gridlines: bool(get(o, 'gridlines'), d.gridlines),
    order: oneOf(get(o, 'order'), ['downThenOver', 'overThenDown'] as const, d.order),
  };
}

function parseScale(o: Obj): Scale {
  switch (get(o, 'mode')) {
    case 'fitPages':
      return {
        mode: 'fitPages',
        wide: int(get(o, 'wide'), SETUP_LIMITS.fitPages, 1),
        tall: int(get(o, 'tall'), SETUP_LIMITS.fitPages, 1),
      };
    case 'percent':
      return { mode: 'percent', value: num(get(o, 'value'), SETUP_LIMITS.scalePercent, 100) };
    default:
      return { mode: 'fitWidth' };
  }
}

function parseColumns(o: Obj): Setup['columns'] {
  const rawOrder = get(o, 'order');
  const rawById = obj(get(o, 'byId'));
  const order: string[] = [];
  const byId: Record<string, ColumnSetup> = {};
  for (const id of Array.isArray(rawOrder) ? rawOrder : []) {
    if (order.length >= SETUP_LIMITS.columnsMax) break;
    if (typeof id !== 'string' || !COLUMN_ID.test(id) || UNSAFE_KEYS.has(id) || Object.hasOwn(byId, id)) continue;
    order.push(id);
    byId[id] = parseColumn(id, obj(get(rawById, id)));
  }
  return { order, byId };
}

function parseColumn(id: string, o: Obj): ColumnSetup {
  const d = defaultColumnSetup(id);
  const w = obj(get(o, 'width'));
  const inches = get(w, 'inches');
  const width: ColumnWidth = get(w, 'mode') === 'fixed' && typeof inches === 'number' && Number.isFinite(inches)
    ? { mode: 'fixed', inches: num(inches, SETUP_LIMITS.fixedWidthIn, 1) }
    : { mode: 'auto' };
  return {
    id,
    include: bool(get(o, 'include'), d.include),
    width,
    align: oneOf(get(o, 'align'), ['auto', 'left', 'center', 'right'] as const, d.align),
    wrap: bool(get(o, 'wrap'), d.wrap),
  };
}

function parseRows(o: Obj, d: Setup['rows']): Setup['rows'] {
  const limit = get(o, 'limit');
  return {
    limit: typeof limit === 'number' && Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : null,
    includeBlank: bool(get(o, 'includeBlank'), d.includeBlank),
  };
}

function parseStyle(o: Obj, d: StyleSetup): StyleSetup {
  const header = obj(get(o, 'header'));
  const lead = obj(get(o, 'leadColumn'));
  const zebra = obj(get(o, 'zebra'));
  return {
    font: parseFontRef(obj(get(o, 'font'))) ?? d.font,
    bodySize: num(get(o, 'bodySize'), SETUP_LIMITS.bodySizePt, d.bodySize),
    header: {
      bold: bool(get(header, 'bold'), d.header.bold),
      fill: optionalColor(header, 'fill', d.header.fill),
      color: optionalColor(header, 'color', d.header.color),
    },
    leadColumn: {
      bold: bool(get(lead, 'bold'), d.leadColumn.bold),
      fill: optionalColor(lead, 'fill', d.leadColumn.fill),
    },
    zebra: { on: bool(get(zebra, 'on'), d.zebra.on), color: color(get(zebra, 'color'), d.zebra.color) },
    padding: oneOf(get(o, 'padding'), ['compact', 'normal', 'relaxed'] as const, d.padding),
    borders: oneOf(get(o, 'borders'), ['hairline', 'none'] as const, d.borders),
    borderColor: color(get(o, 'borderColor'), d.borderColor),
  };
}

function name(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' && v.length <= 200 ? v : null;
}

/** A font reference with only its known fields, or null when invalid or not a bundled font this build ships. */
function parseFontRef(o: Obj): FontRef | null {
  switch (get(o, 'kind')) {
    case 'standard': {
      const id = get(o, 'id');
      return id === 'helvetica' || id === 'times' ? { kind: 'standard', id } : null;
    }
    case 'bundled': {
      const id = get(o, 'id');
      const font = typeof id === 'string' ? getBundledFont(id) : undefined;
      return font ? bundledFontRef(font) : null;
    }
    case 'google': {
      const family = name(get(o, 'family'));
      return family ? { kind: 'google', family } : null;
    }
    case 'local': {
      const postscriptName = name(get(o, 'postscriptName'));
      const family = name(get(o, 'family'));
      return postscriptName && family ? { kind: 'local', postscriptName, family } : null;
    }
    default:
      return null;
  }
}

function parseSlots(v: unknown, d: [Slot, Slot, Slot]): [Slot, Slot, Slot] {
  if (!Array.isArray(v)) return d;
  const slot = (i: number): Slot => {
    const o = obj(v[i]);
    const kind = oneOf(get(o, 'kind'), SLOT_KINDS, 'none');
    return kind === 'text' ? { kind, text: text(get(o, 'text'), '') } : { kind };
  };
  return [slot(0), slot(1), slot(2)];
}

function parseHf(o: Obj, d: HeaderFooterSetup): HeaderFooterSetup {
  return {
    title: text(get(o, 'title'), d.title),
    header: parseSlots(get(o, 'header'), d.header),
    footer: parseSlots(get(o, 'footer'), d.footer),
    size: num(get(o, 'size'), SETUP_LIMITS.hfSizePt, d.size),
  };
}
