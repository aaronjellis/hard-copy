import { getBundledFont } from './catalog';
import type { FontRef, StandardFontId } from './types';

/**
 * Previews for the font picker: each option's name shown in its own typeface. Browser-only side
 * effects are guarded, so importing this module in Node is safe and `ensurePreview` does nothing.
 *
 * Bundled fonts register under `hc-preview-<id>`, apart from any other registered families, so a
 * preview never stands in for (or replaces) another face.
 */

const UI_FALLBACK = 'var(--font-ui)';

const STANDARD_PREVIEW: Readonly<Record<StandardFontId, string>> = {
  helvetica: 'Helvetica, Arial, sans-serif',
  times: '"Times New Roman", Times, serif',
};

const GOOGLE_CSS_URL = 'https://fonts.googleapis.com/css2';

/** A CSS string literal for a family name. */
function cssString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** The family a bundled font's preview face is registered under. */
export function bundledPreviewFamily(id: string): string {
  return `hc-preview-${id.replace(/[^A-Za-z0-9-]/g, '_')}`;
}

/** The Google Fonts CSS URL for a family's preview, subset to the characters of its name. */
export function googlePreviewUrl(family: string): string {
  const name = encodeURIComponent(family).replace(/%20/g, '+');
  return `${GOOGLE_CSS_URL}?family=${name}&text=${encodeURIComponent(family)}&display=swap`;
}

/**
 * A CSS `font-family` value that shows `ref` in its own typeface once its preview has loaded, and
 * the UI font until then (or when the preview fails).
 */
export function previewFamily(ref: FontRef): string {
  switch (ref.kind) {
    case 'standard':
      return STANDARD_PREVIEW[ref.id];
    case 'bundled':
      return `${cssString(bundledPreviewFamily(ref.id))}, ${UI_FALLBACK}`;
    case 'google':
    case 'local':
      return `${cssString(ref.family)}, ${UI_FALLBACK}`;
  }
}

const bundledLoads = new Map<string, Promise<unknown>>();
const googleLinks = new Set<string>();

function withBase(base: string, path: string): string {
  return `${base.endsWith('/') ? base : `${base}/`}${path}`;
}

/**
 * Start loading the preview face for `ref`; idempotent. Bundled fonts load their regular file
 * through `FontFace`. Google fonts add one stylesheet link per family to fonts.googleapis.com,
 * subset to the name's characters. Standard and installed fonts need nothing. Failures are
 * swallowed: the name stays in the UI font.
 */
export function ensurePreview(ref: FontRef): void {
  if (typeof document === 'undefined') return;
  if (ref.kind === 'bundled') {
    if (bundledLoads.has(ref.id) || typeof FontFace === 'undefined' || !document.fonts) return;
    const font = getBundledFont(ref.id);
    if (!font) return;
    const url = withBase(import.meta.env.BASE_URL ?? '/', `fonts/${font.id}/${font.file}`);
    const load = (async () => {
      const face = new FontFace(bundledPreviewFamily(font.id), `url(${JSON.stringify(url)})`, { display: 'swap' });
      document.fonts.add(face);
      await face.load();
    })().catch(() => undefined);
    bundledLoads.set(ref.id, load);
  } else if (ref.kind === 'google') {
    if (googleLinks.has(ref.family)) return;
    googleLinks.add(ref.family);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = googlePreviewUrl(ref.family);
    link.dataset.fontPreview = ref.family;
    document.head.append(link);
  }
}
