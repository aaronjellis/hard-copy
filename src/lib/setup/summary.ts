import { fontLabel } from '../fonts/types';
import { SLOT_LABELS } from './hf';
import { PAPER_SIZES } from './paper';
import type { Setup } from './setup';

/** One-line summaries shown under each settings card's title while it is collapsed. */

const fmt = (n: number) => String(Number(n.toFixed(2)));

export function pageSummary(setup: Setup): string {
  const { page } = setup;
  const paper = page.paper === 'custom'
    ? `${fmt(page.customWidthIn)} × ${fmt(page.customHeightIn)} in`
    : PAPER_SIZES[page.paper].label;
  const orientation = page.landscape ? 'Landscape' : 'Portrait';
  const s = page.scale;
  const scale = s.mode === 'fitWidth' ? 'Fit to width'
    : s.mode === 'fitPages' ? `Fit to ${s.wide} × ${s.tall} pages`
    : `${fmt(s.value)}%`;
  return `${paper} · ${orientation} · ${scale}`;
}

/** Included columns out of the dataset's, plus the row limit; `columnIds` null when no sheet is loaded. */
export function columnsSummary(setup: Setup, columnIds: readonly string[] | null): string {
  if (!columnIds) return 'No spreadsheet loaded';
  const total = columnIds.length;
  const included = columnIds.filter((id) => setup.columns.byId[id]?.include ?? true).length;
  const parts = [`${included} of ${total} ${total === 1 ? 'column' : 'columns'}`];
  const { limit } = setup.rows;
  if (limit !== null) parts.push(`first ${limit} ${limit === 1 ? 'row' : 'rows'}`);
  return parts.join(' · ');
}

export function styleSummary(setup: Setup): string {
  const { style } = setup;
  const parts = [`${fontLabel(style.font)} ${fmt(style.bodySize)}pt`];
  if (style.zebra.on) parts.push('zebra');
  if (style.borders === 'none') parts.push('no borders');
  return parts.join(' · ');
}

/** The header and footer slots that print something, in reading order. */
export function headerFooterSummary(setup: Setup): string {
  const labels = [...setup.hf.header, ...setup.hf.footer]
    .filter((slot) => slot.kind !== 'none')
    .map((slot) => SLOT_LABELS[slot.kind]);
  const unique = [...new Set(labels)];
  return unique.length ? unique.join(' · ') : 'None';
}
