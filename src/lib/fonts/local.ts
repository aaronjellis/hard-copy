/** Fonts installed on the device, via the Local Font Access API (Chrome 103+, including ChromeOS). */

/** PostScript names of a family's faces; `regular` equals the family's `postscriptName`. */
export type LocalFaces = { regular: string; bold?: string; italic?: string; boldItalic?: string };

/** One installed family, represented by its regular face, with the other faces it has. */
export type LocalFont = { postscriptName: string; family: string; fullName: string; faces: LocalFaces };

type FontData = {
  postscriptName: string;
  fullName: string;
  family: string;
  style: string;
  blob(): Promise<Blob>;
};

type QueryLocalFonts = (options?: { postscriptNames?: string[] }) => Promise<FontData[]>;

function getQuery(): QueryLocalFonts | null {
  if (typeof window === 'undefined') return null;
  const q = (window as unknown as { queryLocalFonts?: unknown }).queryLocalFonts;
  return typeof q === 'function' ? (q.bind(window) as QueryLocalFonts) : null;
}

export function isLocalFontsSupported(): boolean {
  return getQuery() !== null;
}

const REGULAR_STYLES = new Set(['regular', 'roman', 'book', 'normal']);
const VARIANT_WORDS = [
  'bold', 'italic', 'oblique', 'light', 'thin', 'black', 'heavy', 'medium', 'semibold', 'extrabold', 'condensed',
];

/** Lower is better: 0 exact regular, 1 no weight or slant words, 2 anything else. */
function styleRank(style: string): number {
  const s = style.trim().toLowerCase();
  if (REGULAR_STYLES.has(s)) return 0;
  return VARIANT_WORDS.some((w) => s.includes(w)) ? 2 : 1;
}

/** Style names (lowercased, without spaces, hyphens, or underscores) for each face beyond regular. */
const FACE_STYLES: Record<'bold' | 'italic' | 'boldItalic', readonly string[]> = {
  bold: ['bold'],
  italic: ['italic', 'oblique'],
  boldItalic: ['bolditalic', 'boldoblique'],
};

function faceOfStyle(style: string): keyof typeof FACE_STYLES | null {
  const s = style.toLowerCase().replace(/[\s_-]+/g, '');
  for (const face of ['bold', 'italic', 'boldItalic'] as const) {
    if (FACE_STYLES[face].includes(s)) return face;
  }
  return null;
}

/**
 * One entry per family, represented by the regular style (the first listed face on a tie), sorted
 * by family. Each entry lists its Bold, Italic (or Oblique), and Bold Italic (or Bold Oblique)
 * faces by exact style name; the first listed face wins when a style repeats.
 */
export function dedupeLocalFonts(
  fonts: readonly { postscriptName: string; family: string; fullName: string; style: string }[],
): LocalFont[] {
  const byFamily = new Map<string, { font: Omit<LocalFont, 'faces'>; rank: number }>();
  const extra = new Map<string, Omit<LocalFaces, 'regular'>>();
  for (const f of fonts) {
    const rank = styleRank(f.style);
    const existing = byFamily.get(f.family);
    if (!existing || rank < existing.rank) {
      byFamily.set(f.family, { font: { postscriptName: f.postscriptName, family: f.family, fullName: f.fullName }, rank });
    }
    const face = faceOfStyle(f.style);
    if (face) {
      const faces = extra.get(f.family) ?? {};
      faces[face] ??= f.postscriptName;
      extra.set(f.family, faces);
    }
  }
  return [...byFamily.values()]
    .map(({ font }) => ({ ...font, faces: { regular: font.postscriptName, ...extra.get(font.family) } }))
    .sort((a, b) => a.family.localeCompare(b.family));
}

function translateError(err: unknown): Error {
  const name = (err as { name?: unknown } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new Error('Permission was declined.');
  }
  return err instanceof Error ? err : new Error(String(err));
}

async function query(options?: { postscriptNames?: string[] }): Promise<FontData[]> {
  const q = getQuery();
  if (!q) throw new Error('Installed fonts are not supported in this browser.');
  try {
    return await q(options);
  } catch (err) {
    throw translateError(err);
  }
}

/** List installed families. The first call triggers the browser's permission prompt. */
export async function listLocalFonts(): Promise<LocalFont[]> {
  return dedupeLocalFonts(await query());
}

let localOnce: Promise<LocalFont[]> | null = null;

/**
 * Installed families, listed once per session and shared by every caller.
 * A failed or empty result is not kept (an empty list can mean the permission was declined),
 * so the next call tries again.
 */
export function loadLocalFontsOnce(list: () => Promise<LocalFont[]> = listLocalFonts): Promise<LocalFont[]> {
  if (localOnce) return localOnce;
  const p: Promise<LocalFont[]> = list().then((fonts) => {
    if (fonts.length === 0 && localOnce === p) localOnce = null;
    return fonts;
  });
  localOnce = p;
  p.catch(() => {
    if (localOnce === p) localOnce = null;
  });
  return p;
}

/** Font file bytes for an installed face. */
export async function localFontBytes(postscriptName: string): Promise<Uint8Array> {
  const [face] = await query({ postscriptNames: [postscriptName] });
  if (!face) throw new Error(`The installed font ${postscriptName} was not found.`);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await (await face.blob()).arrayBuffer());
  } catch (err) {
    throw translateError(err);
  }
  if (String.fromCharCode(...bytes.subarray(0, 4)) === 'ttcf') {
    throw new Error("Font collections aren't supported yet. Choose another installed font.");
  }
  return bytes;
}
