import { pickFace, type FaceStyle, type FontRef } from './types';

export type BundledFontCategory = 'sans' | 'serif' | 'script' | 'display';

export type BundledFont = {
  id: string;
  family: string;
  /** File name of the Regular face under `public/fonts/<id>/`. */
  file: string;
  /** File names of the other faces in the same folder. */
  faces: BundledFaces;
  category: BundledFontCategory;
};

export type BundledFaces = { bold?: string; italic?: string; boldItalic?: string };

/** The Bold, Italic, and BoldItalic files that sit next to `<stem>-Regular.ttf`. */
function allFaces(stem: string): BundledFaces {
  return { bold: `${stem}-Bold.ttf`, italic: `${stem}-Italic.ttf`, boldItalic: `${stem}-BoldItalic.ttf` };
}

/** Open-licensed families shipped in `public/fonts`. See `public/fonts/README.md`. */
export const BUNDLED_FONTS: readonly BundledFont[] = [
  {
    id: 'noto-sans', family: 'Noto Sans', category: 'sans',
    file: 'NotoSans-Regular.ttf', faces: allFaces('NotoSans'),
  },
  {
    id: 'noto-serif', family: 'Noto Serif', category: 'serif',
    file: 'NotoSerif-Regular.ttf', faces: allFaces('NotoSerif'),
  },
  {
    id: 'open-sans', family: 'Open Sans', category: 'sans',
    file: 'OpenSans-Regular.ttf', faces: allFaces('OpenSans'),
  },
  {
    id: 'lato', family: 'Lato', category: 'sans',
    file: 'Lato-Regular.ttf', faces: allFaces('Lato'),
  },
  {
    id: 'roboto', family: 'Roboto', category: 'sans',
    file: 'Roboto-Regular.ttf', faces: allFaces('Roboto'),
  },
  {
    id: 'source-sans-3', family: 'Source Sans 3', category: 'sans',
    file: 'SourceSans3-Regular.ttf', faces: allFaces('SourceSans3'),
  },
  {
    id: 'merriweather', family: 'Merriweather', category: 'serif',
    file: 'Merriweather-Regular.ttf', faces: allFaces('Merriweather'),
  },
  {
    id: 'lora', family: 'Lora', category: 'serif',
    file: 'Lora-Regular.ttf', faces: allFaces('Lora'),
  },
];

/** The file name for a face of a bundled font, or undefined when the font lacks that face. */
export function bundledFaceFile(font: BundledFont, style: FaceStyle): string | undefined {
  return pickFace({ ...font.faces, regular: font.file }, style);
}

export function getBundledFont(id: string): BundledFont | undefined {
  return BUNDLED_FONTS.find((f) => f.id === id);
}

/** Font reference for a bundled font, carrying the family for display. */
export function bundledFontRef(font: BundledFont): FontRef {
  return { kind: 'bundled', id: font.id, family: font.family };
}
