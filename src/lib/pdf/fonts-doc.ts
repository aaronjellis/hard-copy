import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib';
import { sanitizeForFont, type SanitizeResult } from './text';
import { subsetSource } from './subset-check';
import {
  FACE_LABELS, NO_FACES, faceKey, fontLabel, fontRefKey, isRegularFace, resolveFace,
  type AvailableFaces, type FaceKey, type FaceStyle, type FontProvider, type FontRef, type StandardFontId,
} from '../fonts/types';
import { errorMessage } from '../errors';

/** The fonts of one PDF document: each (font, face) resolved and embedded once. */
export type DocFonts = {
  /**
   * The embedded font for a face. Standard fonts map to their built-in faces; other fonts use the
   * nearest face the provider has (bold italic → bold → regular; italic → regular). Each resolved
   * face is embedded once, and identical bytes are embedded only once.
   */
  get(ref: FontRef, style: FaceStyle): Promise<PDFFont>;
  /** NFC-normalize `text` and replace characters `font` cannot encode with '?'. */
  sanitize(text: string, font: PDFFont): SanitizeResult;
  /**
   * Faces embedded whole, such as `Lobster` or `Lora Bold`, because fontkit's subsetter would
   * corrupt their glyphs even from a padded copy (see subsetSource). For diagnostics.
   */
  subsetFallbacks: string[];
};

type Fontkit = Parameters<PDFDocument['registerFontkit']>[0];
let fontkitOnce: Promise<Fontkit> | null = null;

/** fontkit is only needed to embed non-standard fonts, so it loads on first use in its own chunk. */
function loadFontkit(): Promise<Fontkit> {
  if (!fontkitOnce) {
    const p = import('@pdf-lib/fontkit').then((m) => m.default);
    fontkitOnce = p;
    p.catch(() => {
      if (fontkitOnce === p) fontkitOnce = null;
    });
  }
  return fontkitOnce;
}

const STANDARD_FACES: Record<StandardFontId, Record<FaceKey, StandardFonts>> = {
  helvetica: {
    regular: StandardFonts.Helvetica,
    bold: StandardFonts.HelveticaBold,
    italic: StandardFonts.HelveticaOblique,
    bolditalic: StandardFonts.HelveticaBoldOblique,
  },
  times: {
    regular: StandardFonts.TimesRoman,
    bold: StandardFonts.TimesRomanBold,
    italic: StandardFonts.TimesRomanItalic,
    bolditalic: StandardFonts.TimesRomanBoldItalic,
  },
};

/** The pdf-lib built-in font for a face of a standard font. */
export function standardFace(id: StandardFontId, style: FaceStyle): StandardFonts {
  return STANDARD_FACES[id][faceKey(style)];
}

/** A face's name for messages: the font's label, plus the face unless it is regular. */
function faceName(ref: FontRef, face: FaceStyle): string {
  return isRegularFace(face) ? fontLabel(ref) : `${fontLabel(ref)} ${FACE_LABELS[faceKey(face)]}`;
}

/**
 * Font machinery for one document. Fonts other than the standard ones come from `fonts` and are
 * subset, from a padded copy when that is what keeps the subset's glyphs intact (see subsetSource),
 * or embedded whole and named in `subsetFallbacks` when neither copy subsets cleanly.
 * `textFor` gives the text the document draws in a font, keyed by fontRefKey(ref), so the subset
 * check sees every glyph in use; fonts missing from it are checked against a fixed probe only.
 */
export async function createDocFonts(
  doc: PDFDocument,
  fonts: FontProvider,
  textFor: ReadonlyMap<string, string> = new Map(),
): Promise<DocFonts> {
  const subsetFallbacks: string[] = [];
  const faces = new Map<string, Promise<AvailableFaces>>();
  const resolved = new Map<string, Promise<PDFFont>>();
  const byBytes = new Map<Uint8Array, Promise<PDFFont>>();

  function available(ref: FontRef): Promise<AvailableFaces> {
    const key = fontRefKey(ref);
    let p = faces.get(key);
    if (!p) {
      p = fonts.availableFaces(ref).catch(() => NO_FACES);
      faces.set(key, p);
    }
    return p;
  }

  async function load(ref: FontRef, face: FaceStyle): Promise<PDFFont> {
    if (ref.kind === 'standard') return doc.embedFont(standardFace(ref.id, face));
    const [bytes, fontkit] = await Promise.all([fonts.getBytes(ref, face), loadFontkit()]);
    const name = faceName(ref, face);
    if (!bytes) throw new Error(`No font data for ${name}.`);
    let p = byBytes.get(bytes);
    if (!p) {
      doc.registerFontkit(fontkit);
      p = subsetSource(bytes, textFor.get(fontRefKey(ref)) ?? '')
        .then((source) => {
          if (!source) subsetFallbacks.push(name);
          return doc.embedFont(source ?? bytes, { subset: source !== null });
        })
        .catch((err: unknown) => {
          throw new Error(`The font ${name} could not be used: ${errorMessage(err)}`);
        });
      byBytes.set(bytes, p);
    }
    return p;
  }

  async function get(ref: FontRef, style: FaceStyle): Promise<PDFFont> {
    const face = ref.kind === 'standard' || isRegularFace(style) ? style : resolveFace(style, await available(ref));
    const key = fontRefKey(ref, face);
    let p = resolved.get(key);
    if (!p) {
      p = load(ref, face);
      resolved.set(key, p);
    }
    return p;
  }

  return { get, sanitize: sanitizeForFont, subsetFallbacks };
}
