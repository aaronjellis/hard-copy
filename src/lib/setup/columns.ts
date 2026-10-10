import { SETUP_LIMITS, type ColumnSetup, type Setup } from './setup';

/**
 * Column list edits for the Columns card. Each returns a new array or setup and never mutates its
 * input; an edit that changes nothing returns the input itself, so callers can skip a no-op save.
 */

/** `order` with `id` moved `delta` places (negative is up), stopping at either end. */
export function moveColumn(order: readonly string[], id: string, delta: number): readonly string[] {
  const from = order.indexOf(id);
  if (from === -1 || !Number.isFinite(delta)) return order;
  return reorderColumn(order, id, from + Math.trunc(delta));
}

/** `order` with `id` moved to `toIndex`, clamped to the list. */
export function reorderColumn(order: readonly string[], id: string, toIndex: number): readonly string[] {
  const from = order.indexOf(id);
  if (from === -1 || Number.isNaN(toIndex)) return order;
  const to = Math.min(order.length - 1, Math.max(0, Math.trunc(toIndex)));
  if (to === from) return order;
  const next = order.filter((x) => x !== id);
  next.splice(to, 0, id);
  return next;
}

/** The setup with one column's settings patched. Unknown ids leave the setup unchanged. */
export function updateColumn(setup: Setup, id: string, patch: Partial<Omit<ColumnSetup, 'id'>>): Setup {
  if (!Object.hasOwn(setup.columns.byId, id)) return setup;
  const byId = { ...setup.columns.byId, [id]: { ...setup.columns.byId[id], ...patch, id } };
  return { ...setup, columns: { ...setup.columns, byId } };
}

/** The setup with a new column order. */
export function withColumnOrder(setup: Setup, order: readonly string[]): Setup {
  if (order === setup.columns.order) return setup;
  return { ...setup, columns: { ...setup.columns, order: [...order] } };
}

/** A fixed column width in inches, clamped and rounded to hundredths; null when not a finite number. */
export function clampFixedWidth(inches: number): number | null {
  if (!Number.isFinite(inches)) return null;
  const [min, max] = SETUP_LIMITS.fixedWidthIn;
  return Math.round(Math.min(max, Math.max(min, inches)) * 100) / 100;
}

/** A row limit from a text field: empty, zero, or invalid means every row (null); otherwise a whole number ≥ 1. */
export function parseRowLimit(raw: string): number | null {
  const n = Number(raw.trim());
  if (raw.trim() === '' || !Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}
