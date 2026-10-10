import type { FaceStyle } from '../text-runs';

export type { FaceStyle } from '../text-runs';

export type StandardFontId = 'helvetica' | 'times';

export type FontRef =
  | { kind: 'standard'; id: StandardFontId } // pdf-lib built-ins, no loading
  | { kind: 'bundled'; id: string; family?: string } // shipped with the app
  | { kind: 'google'; family: string } // Google Fonts catalog
  | { kind: 'local'; postscriptName: string; family: string }; // installed on device

export const STANDARD_FONTS: readonly { id: StandardFontId; label: string }[] = [
  { id: 'helvetica', label: 'Helvetica' },
  { id: 'times', label: 'Times' },
];

export type FaceKey = 'regular' | 'bold' | 'italic' | 'bolditalic';

/** The upright, normal-weight face. */
export const REGULAR_FACE: FaceStyle = Object.freeze({ bold: false, italic: false });

/** Display names for each face. */
export const FACE_LABELS: Readonly<Record<FaceKey, string>> = Object.freeze({
  regular: 'Regular',
  bold: 'Bold',
  italic: 'Italic',
  bolditalic: 'Bold Italic',
});

/**
 * The entry for a face from a per-face record (file names, URLs, PostScript names, flags), or
 * undefined when the record lacks it. Does not fall back to another face.
 */
export function pickFace<T>(faces: { regular: T; bold?: T; italic?: T; boldItalic?: T }, style: FaceStyle): T | undefined {
  if (style.bold) return style.italic ? faces.boldItalic : faces.bold;
  return style.italic ? faces.italic : faces.regular;
}

/** A short name for a face: `regular`, `bold`, `italic`, or `bolditalic`. */
export function faceKey(style: FaceStyle): FaceKey {
  if (style.bold) return style.italic ? 'bolditalic' : 'bold';
  return style.italic ? 'italic' : 'regular';
}

/** True for the upright, normal-weight face. */
export function isRegularFace(style: FaceStyle): boolean {
  return !style.bold && !style.italic;
}

/**
 * A stable string identifying a font reference, such as `google:Lora` or `local:ArialMT`.
 * With a style, the face is appended: `bundled:lato:bold`, `google:Lora:regular`.
 */
export function fontRefKey(ref: FontRef, style?: FaceStyle): string {
  const base = (() => {
    switch (ref.kind) {
      case 'standard':
      case 'bundled':
        return `${ref.kind}:${ref.id}`;
      case 'google':
        return `google:${ref.family}`;
      case 'local':
        return `local:${ref.postscriptName}`;
    }
  })();
  return style ? `${base}:${faceKey(style)}` : base;
}

/** Display name for a font reference. */
export function fontLabel(ref: FontRef): string {
  switch (ref.kind) {
    case 'standard':
      return STANDARD_FONTS.find((f) => f.id === ref.id)?.label ?? ref.id;
    case 'bundled':
      return ref.family ?? ref.id;
    case 'google':
    case 'local':
      return ref.family;
  }
}

/** Which faces beyond regular a font has. Regular is always assumed. */
export type AvailableFaces = { bold: boolean; italic: boolean; boldItalic: boolean };

/** Regular only: no bold, italic, or bold italic face. */
export const NO_FACES: Readonly<AvailableFaces> = Object.freeze({ bold: false, italic: false, boldItalic: false });

/** The faces to try for a style, nearest first: bold italic → bold → regular; italic → regular. */
export function faceFallbacks(style: FaceStyle): FaceStyle[] {
  const chain: FaceStyle[] = [{ bold: style.bold, italic: style.italic }];
  if (style.bold && style.italic) chain.push({ bold: true, italic: false });
  if (style.bold || style.italic) chain.push({ bold: false, italic: false });
  return chain;
}

/** True when the font has the face; regular always exists. */
export function hasFace(available: AvailableFaces, style: FaceStyle): boolean {
  return pickFace({ ...available, regular: true }, style) === true;
}

/** The nearest face to `style` that exists, following `faceFallbacks`. Regular always exists. */
export function resolveFace(style: FaceStyle, available: AvailableFaces): FaceStyle {
  return faceFallbacks(style).find((f) => hasFace(available, f)) ?? { bold: false, italic: false };
}

/** Supplies font file bytes to the PDF builder. Null means a standard font (no bytes needed). */
export interface FontProvider {
  /**
   * Bytes for the requested face, or the nearest available one (bold italic → bold → regular;
   * italic → regular). Throws only when the regular face cannot load.
   */
  getBytes(ref: FontRef, style: FaceStyle): Promise<Uint8Array | null>;
  /** Which faces exist, so the UI can disable buttons and the builder can pick a fallback. */
  availableFaces(ref: FontRef): Promise<AvailableFaces>;
}

/** Minimal async key-value store (for example idb-keyval) used to cache fonts and catalogs. */
export interface KeyValueCache {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}
