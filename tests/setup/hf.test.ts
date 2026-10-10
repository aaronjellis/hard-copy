import { describe, it, expect } from 'vitest';
import { resolveSlot, SLOT_KINDS, SLOT_LABELS, type SlotContext } from '../../src/lib/setup/hf';

const now = new Date(2026, 9, 10, 14, 5);
const ctx: SlotContext = { title: 'Roster', file: 'members.xlsx', sheet: 'Fall', page: 2, pageCount: 7, now, locale: 'en-US' };

describe('resolveSlot', () => {
  it('resolves none to an empty string', () => {
    expect(resolveSlot({ kind: 'none' }, ctx)).toBe('');
  });

  it('resolves title, file, and sheet from the context', () => {
    expect(resolveSlot({ kind: 'title' }, ctx)).toBe('Roster');
    expect(resolveSlot({ kind: 'file' }, ctx)).toBe('members.xlsx');
    expect(resolveSlot({ kind: 'sheet' }, ctx)).toBe('Fall');
  });

  it('resolves page numbers', () => {
    expect(resolveSlot({ kind: 'page' }, ctx)).toBe('Page 2');
    expect(resolveSlot({ kind: 'pageOf' }, ctx)).toBe('Page 2 of 7');
  });

  it('resolves custom text, empty when missing', () => {
    expect(resolveSlot({ kind: 'text', text: 'Confidential' }, ctx)).toBe('Confidential');
    expect(resolveSlot({ kind: 'text' }, ctx)).toBe('');
  });

  it('formats the date and time with the given locale', () => {
    expect(resolveSlot({ kind: 'date' }, ctx)).toBe(new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(now));
    expect(resolveSlot({ kind: 'date' }, ctx)).toContain('2026');
    expect(resolveSlot({ kind: 'time' }, ctx)).toBe(new Intl.DateTimeFormat('en-US', { timeStyle: 'short' }).format(now));
    expect(resolveSlot({ kind: 'time' }, ctx)).toMatch(/2:05/);
  });

  it('follows the locale', () => {
    const de = resolveSlot({ kind: 'date' }, { ...ctx, locale: 'de-DE' });
    expect(de).toBe(new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(now));
    expect(de).not.toBe(resolveSlot({ kind: 'date' }, ctx));
  });

  it('defaults to the current time and the user locale', () => {
    const { now: _n, locale: _l, ...bare } = ctx;
    expect(resolveSlot({ kind: 'date' }, bare)).toBe(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date()));
  });

  it('labels every slot kind', () => {
    expect(SLOT_KINDS).toEqual(['none', 'title', 'file', 'sheet', 'date', 'time', 'page', 'pageOf', 'text']);
    for (const k of SLOT_KINDS) expect(SLOT_LABELS[k]).toMatch(/\S/);
  });
});
