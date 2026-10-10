import { describe, it, expect } from 'vitest';
import {
  clampFixedWidth, moveColumn, parseRowLimit, reorderColumn, updateColumn, withColumnOrder,
} from '../../src/lib/setup/columns';
import { defaultSetup, reconcileColumns } from '../../src/lib/setup/setup';

const ORDER = ['a', 'b', 'c', 'd'] as const;

describe('moveColumn', () => {
  it('moves up and down one place', () => {
    expect(moveColumn(ORDER, 'c', -1)).toEqual(['a', 'c', 'b', 'd']);
    expect(moveColumn(ORDER, 'b', 1)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('moves several places and stops at the ends', () => {
    expect(moveColumn(ORDER, 'a', 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveColumn(ORDER, 'b', 10)).toEqual(['a', 'c', 'd', 'b']);
    expect(moveColumn(ORDER, 'c', -10)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('returns the same array when nothing moves', () => {
    expect(moveColumn(ORDER, 'a', -1)).toBe(ORDER);
    expect(moveColumn(ORDER, 'd', 1)).toBe(ORDER);
    expect(moveColumn(ORDER, 'b', 0)).toBe(ORDER);
    expect(moveColumn(ORDER, 'zz', 1)).toBe(ORDER);
    expect(moveColumn(ORDER, 'b', Number.NaN)).toBe(ORDER);
  });

  it('never mutates its input', () => {
    const order = ['a', 'b', 'c'];
    moveColumn(order, 'a', 1);
    expect(order).toEqual(['a', 'b', 'c']);
  });
});

describe('reorderColumn', () => {
  it('moves to an index, counted in the final order', () => {
    expect(reorderColumn(ORDER, 'a', 3)).toEqual(['b', 'c', 'd', 'a']);
    expect(reorderColumn(ORDER, 'd', 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(reorderColumn(ORDER, 'b', 2)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('clamps the index and truncates fractions', () => {
    expect(reorderColumn(ORDER, 'b', -5)).toEqual(['b', 'a', 'c', 'd']);
    expect(reorderColumn(ORDER, 'b', 99)).toEqual(['a', 'c', 'd', 'b']);
    expect(reorderColumn(ORDER, 'a', 1.9)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('returns the same array for the current index, an unknown id, or NaN', () => {
    expect(reorderColumn(ORDER, 'c', 2)).toBe(ORDER);
    expect(reorderColumn(ORDER, 'zz', 0)).toBe(ORDER);
    expect(reorderColumn(ORDER, 'a', Number.NaN)).toBe(ORDER);
  });
});

describe('updateColumn and withColumnOrder', () => {
  const setup = reconcileColumns(defaultSetup(), [{ id: 'c0', name: 'A' }, { id: 'c1', name: 'B' }]);

  it('patches one column and keeps its id', () => {
    const next = updateColumn(setup, 'c1', { include: false, align: 'right' });
    expect(next.columns.byId.c1).toEqual({ id: 'c1', include: false, width: { mode: 'auto' }, align: 'right', wrap: true });
    expect(next.columns.byId.c0).toBe(setup.columns.byId.c0);
    expect(setup.columns.byId.c1.include).toBe(true);
  });

  it('ignores unknown and inherited ids', () => {
    expect(updateColumn(setup, 'c9', { include: false })).toBe(setup);
    expect(updateColumn(setup, 'constructor', { include: false })).toBe(setup);
  });

  it('sets the order, or returns the setup when the order is the same array', () => {
    expect(withColumnOrder(setup, ['c1', 'c0']).columns.order).toEqual(['c1', 'c0']);
    expect(withColumnOrder(setup, setup.columns.order)).toBe(setup);
  });
});

describe('clampFixedWidth', () => {
  it('clamps to 0.1–48 in and rounds to hundredths', () => {
    expect(clampFixedWidth(2)).toBe(2);
    expect(clampFixedWidth(0)).toBe(0.1);
    expect(clampFixedWidth(100)).toBe(48);
    expect(clampFixedWidth(1.23456)).toBe(1.23);
  });

  it('rejects non-finite values', () => {
    expect(clampFixedWidth(Number.NaN)).toBeNull();
    expect(clampFixedWidth(Infinity)).toBeNull();
  });
});

describe('parseRowLimit', () => {
  it('reads whole numbers of at least 1', () => {
    expect(parseRowLimit('2')).toBe(2);
    expect(parseRowLimit(' 15 ')).toBe(15);
    expect(parseRowLimit('3.7')).toBe(3);
  });

  it('treats empty, zero, negative, and junk as every row', () => {
    for (const raw of ['', '  ', '0', '-4', 'abc', '0.5']) expect(parseRowLimit(raw)).toBeNull();
  });
});
