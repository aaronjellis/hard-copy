import { describe, it, expect, vi, afterEach } from 'vitest';
import { isLocalFontsSupported, dedupeLocalFonts, listLocalFonts, localFontBytes } from '../../src/lib/fonts/local';

describe('local fonts', () => {
  it('is unsupported outside a browser', () => {
    expect(isLocalFontsSupported()).toBe(false);
  });

  it('rejects listing when unsupported', async () => {
    await expect(listLocalFonts()).rejects.toThrow(/not supported/i);
  });

  it('keeps one face per family, preferring Regular, sorted by family', () => {
    const fonts = dedupeLocalFonts([
      { postscriptName: 'Arial-BoldMT', family: 'Arial', fullName: 'Arial Bold', style: 'Bold' },
      { postscriptName: 'ArialMT', family: 'Arial', fullName: 'Arial', style: 'Regular' },
      { postscriptName: 'Arial-ItalicMT', family: 'Arial', fullName: 'Arial Italic', style: 'Italic' },
      { postscriptName: 'Zapfino', family: 'Zapfino', fullName: 'Zapfino', style: 'Regular' },
      { postscriptName: 'Avenir-Heavy', family: 'Avenir', fullName: 'Avenir Heavy', style: 'Heavy' },
    ]);
    expect(fonts).toEqual([
      {
        postscriptName: 'ArialMT', family: 'Arial', fullName: 'Arial',
        faces: { regular: 'ArialMT', bold: 'Arial-BoldMT', italic: 'Arial-ItalicMT' },
      },
      {
        postscriptName: 'Avenir-Heavy', family: 'Avenir', fullName: 'Avenir Heavy',
        faces: { regular: 'Avenir-Heavy' },
      },
      { postscriptName: 'Zapfino', family: 'Zapfino', fullName: 'Zapfino', faces: { regular: 'Zapfino' } },
    ]);
  });

  it('finds bold, italic, and bold italic faces by style name', () => {
    const [f] = dedupeLocalFonts([
      { postscriptName: 'F-Regular', family: 'F', fullName: 'F', style: 'Regular' },
      { postscriptName: 'F-Bold', family: 'F', fullName: 'F Bold', style: 'Bold' },
      { postscriptName: 'F-Oblique', family: 'F', fullName: 'F Oblique', style: 'Oblique' },
      { postscriptName: 'F-BoldOblique', family: 'F', fullName: 'F Bold Oblique', style: 'BoldOblique' },
      { postscriptName: 'F-Semibold', family: 'F', fullName: 'F Semibold', style: 'Semibold' },
    ]);
    expect(f.faces).toEqual({ regular: 'F-Regular', bold: 'F-Bold', italic: 'F-Oblique', boldItalic: 'F-BoldOblique' });

    const [g] = dedupeLocalFonts([
      { postscriptName: 'G-BI', family: 'G', fullName: 'G Bold Italic', style: 'bold italic' },
      { postscriptName: 'G-Roman', family: 'G', fullName: 'G', style: 'Roman' },
      { postscriptName: 'G-It', family: 'G', fullName: 'G Italic', style: 'ITALIC' },
      { postscriptName: 'G-LightItalic', family: 'G', fullName: 'G Light Italic', style: 'Light Italic' },
    ]);
    expect(g.faces).toEqual({ regular: 'G-Roman', italic: 'G-It', boldItalic: 'G-BI' });
  });

  it('keeps the first listed face when a style repeats', () => {
    const [f] = dedupeLocalFonts([
      { postscriptName: 'F-Regular', family: 'F', fullName: 'F', style: 'Regular' },
      { postscriptName: 'F-Bold', family: 'F', fullName: 'F Bold', style: 'Bold' },
      { postscriptName: 'F-Bold2', family: 'F', fullName: 'F Bold', style: 'Bold' },
    ]);
    expect(f.faces.bold).toBe('F-Bold');
  });

  const face = (postscriptName: string, family: string, style: string) => ({
    postscriptName, family, fullName: `${family} ${style}`, style,
  });

  it('prefers a Roman face over Bold and Italic', () => {
    const fonts = dedupeLocalFonts([
      face('F-Bold', 'F', 'Bold'),
      face('F-Roman', 'F', 'Roman'),
      face('F-Italic', 'F', 'Italic'),
    ]);
    expect(fonts.map((f) => f.postscriptName)).toEqual(['F-Roman']);
  });

  it('picks the first listed face when every style is a variant', () => {
    const fonts = dedupeLocalFonts([face('G-Bold', 'G', 'Bold'), face('G-Light', 'G', 'Light')]);
    expect(fonts.map((f) => f.postscriptName)).toEqual(['G-Bold']);
  });

  it('prefers a plain style over a weighted one when no exact regular exists', () => {
    const fonts = dedupeLocalFonts([face('H-Bold', 'H', 'Bold'), face('H-Plain', 'H', 'Display')]);
    expect(fonts.map((f) => f.postscriptName)).toEqual(['H-Plain']);
  });

  it('matches regular, book, and normal case-insensitively', () => {
    for (const style of ['REGULAR', 'book', 'Normal']) {
      const fonts = dedupeLocalFonts([face('X-Display', 'X', 'Display'), face('X-Main', 'X', style)]);
      expect(fonts.map((f) => f.postscriptName)).toEqual(['X-Main']);
    }
  });
});

describe('localFontBytes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFonts(bytes: Uint8Array) {
    vi.stubGlobal('window', {
      queryLocalFonts: async () => [
        { postscriptName: 'P', family: 'P', fullName: 'P', style: 'Regular', blob: async () => new Blob([bytes as BlobPart]) },
      ],
    });
  }

  it('rejects font collections', async () => {
    stubFonts(new TextEncoder().encode('ttcf\0\0\0\0'));
    await expect(localFontBytes('P')).rejects.toThrow(
      "Font collections aren't supported yet. Choose another installed font.",
    );
  });

  it('returns the bytes of a single font', async () => {
    stubFonts(new Uint8Array([0, 1, 0, 0, 7]));
    expect(await localFontBytes('P')).toEqual(new Uint8Array([0, 1, 0, 0, 7]));
  });
});

describe('loadLocalFontsOnce', () => {
  const arial = { postscriptName: 'ArialMT', family: 'Arial', fullName: 'Arial', faces: { regular: 'ArialMT' } };

  afterEach(() => vi.resetModules());

  async function freshModule() {
    vi.resetModules();
    return import('../../src/lib/fonts/local');
  }

  it('lists once and shares the result', async () => {
    const { loadLocalFontsOnce } = await freshModule();
    const list = vi.fn(async () => [arial]);
    expect(await loadLocalFontsOnce(list)).toEqual([arial]);
    expect(await loadLocalFontsOnce(list)).toEqual([arial]);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('retries after a failure or an empty list', async () => {
    const { loadLocalFontsOnce } = await freshModule();
    const list = vi.fn<() => Promise<typeof arial[]>>()
      .mockRejectedValueOnce(new Error('Permission was declined.'))
      .mockResolvedValueOnce([])
      .mockResolvedValue([arial]);
    await expect(loadLocalFontsOnce(list)).rejects.toThrow('Permission was declined.');
    expect(await loadLocalFontsOnce(list)).toEqual([]);
    expect(await loadLocalFontsOnce(list)).toEqual([arial]);
    expect(await loadLocalFontsOnce(list)).toEqual([arial]);
    expect(list).toHaveBeenCalledTimes(3);
  });
});
