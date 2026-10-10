export type PaperId = 'letter' | 'legal' | 'tabloid' | 'a4' | 'a3' | 'custom';

/** Page margins in inches. */
export type Margins = { top: number; right: number; bottom: number; left: number };

export type MarginPreset = 'normal' | 'narrow' | 'wide';

/** The paper fields of a page setup. */
export type PaperSpec = { paper: PaperId; customWidthIn: number; customHeightIn: number; landscape: boolean };

export type PaperSize = { label: string; widthIn: number; heightIn: number };

export const POINTS_PER_INCH = 72;

/** Every paper choice, in menu order. */
export const PAPER_IDS: readonly PaperId[] = ['letter', 'legal', 'tabloid', 'a4', 'a3', 'custom'];

/** Fixed paper sizes, portrait, in inches. */
export const PAPER_SIZES: Readonly<Record<Exclude<PaperId, 'custom'>, PaperSize>> = Object.freeze({
  letter: { label: 'Letter', widthIn: 8.5, heightIn: 11 },
  legal: { label: 'Legal', widthIn: 8.5, heightIn: 14 },
  tabloid: { label: 'Tabloid', widthIn: 11, heightIn: 17 },
  a4: { label: 'A4', widthIn: 8.27, heightIn: 11.69 },
  a3: { label: 'A3', widthIn: 11.69, heightIn: 16.54 },
});

export const CUSTOM_PAPER_MIN_IN = 3;
export const CUSTOM_PAPER_MAX_IN = 48;

/** Margin presets in inches, applied to all four sides. */
export const MARGIN_PRESETS: Readonly<Record<MarginPreset, number>> = Object.freeze({ normal: 0.75, narrow: 0.5, wide: 1 });

/** A custom paper dimension clamped to [CUSTOM_PAPER_MIN_IN, CUSTOM_PAPER_MAX_IN]; non-finite values yield the minimum. */
export function clampCustomInches(value: number): number {
  if (!Number.isFinite(value)) return CUSTOM_PAPER_MIN_IN;
  return Math.min(CUSTOM_PAPER_MAX_IN, Math.max(CUSTOM_PAPER_MIN_IN, value));
}

/** The page size in points, with width and height swapped in landscape. */
export function resolvePaper(page: PaperSpec): { widthPt: number; heightPt: number } {
  const size = page.paper === 'custom'
    ? { widthIn: clampCustomInches(page.customWidthIn), heightIn: clampCustomInches(page.customHeightIn) }
    : PAPER_SIZES[page.paper];
  const w = size.widthIn * POINTS_PER_INCH;
  const h = size.heightIn * POINTS_PER_INCH;
  return page.landscape ? { widthPt: h, heightPt: w } : { widthPt: w, heightPt: h };
}

/** Four equal margins for a preset. */
export function marginsForPreset(preset: MarginPreset): Margins {
  const m = MARGIN_PRESETS[preset];
  return { top: m, right: m, bottom: m, left: m };
}

/** The preset that matches the margins exactly, or `custom`. */
export function marginPresetOf(margins: Margins): MarginPreset | 'custom' {
  const { top, right, bottom, left } = margins;
  if (top !== right || top !== bottom || top !== left) return 'custom';
  const match = (Object.keys(MARGIN_PRESETS) as MarginPreset[]).find((p) => MARGIN_PRESETS[p] === top);
  return match ?? 'custom';
}
