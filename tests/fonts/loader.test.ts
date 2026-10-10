import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  loadFontBytes, fontCacheKey, createBrowserFontProvider, isSfnt, resolveFace, faceFallbacks, availableFacesFor,
} from '../../src/lib/fonts/loader';
import { GOOGLE_CATALOG_CACHE_KEY } from '../../src/lib/fonts/google';
import { getBundledFont } from '../../src/lib/fonts/catalog';
import type { FaceStyle, KeyValueCache } from '../../src/lib/fonts/types';
import type { LocalFont } from '../../src/lib/fonts/local';
import { errorMessage } from '../../src/lib/errors';

const R: FaceStyle = { bold: false, italic: false };
const B: FaceStyle = { bold: true, italic: false };
const I: FaceStyle = { bold: false, italic: true };
const BI: FaceStyle = { bold: true, italic: true };

const FONT_BYTES = new Uint8Array([0, 1, 0, 0, 9, 9, 9]);

function memoryCache(initial: Record<string, unknown> = {}): KeyValueCache & { data: Map<string, unknown> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get: vi.fn(async (k: string) => data.get(k)),
    set: vi.fn(async (k: string, v: unknown) => void data.set(k, v)),
  };
}

function bytesFetch(ok = true) {
  return vi.fn(async (_url: string | URL | Request) =>
    ok ? new Response(FONT_BYTES) : new Response('nope', { status: 404 }),
  );
}

describe('loadFontBytes', () => {
  it('returns null for standard fonts without fetching', async () => {
    const fetchFn = bytesFetch();
    const bytes = await loadFontBytes({ kind: 'standard', id: 'times' }, R, { fetchFn, cache: memoryCache(), base: '/' });
    expect(bytes).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('fetches a bundled font once, then serves it from the cache', async () => {
    const fetchFn = bytesFetch();
    const cache = memoryCache();
    const deps = { fetchFn, cache, base: '/app/' };
    const ref = { kind: 'bundled' as const, id: 'lato' };
    const file = getBundledFont('lato')!.file;

    const first = await loadFontBytes(ref, R, deps);
    expect(first).toEqual(FONT_BYTES);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(String(fetchFn.mock.calls[0][0])).toBe(`/app/fonts/lato/${file}`);
    expect(cache.data.has('font:bundled:lato')).toBe(true);

    const second = await loadFontBytes(ref, R, deps);
    expect(second).toEqual(FONT_BYTES);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('adds a trailing slash to the base', async () => {
    const fetchFn = bytesFetch();
    await loadFontBytes({ kind: 'bundled', id: 'lora' }, R, { fetchFn, cache: memoryCache(), base: '.' });
    expect(String(fetchFn.mock.calls[0][0])).toBe(`./fonts/lora/${getBundledFont('lora')!.file}`);
  });

  it('rejects a 200 response that is not a font file and does not cache it', async () => {
    const html = new TextEncoder().encode('<!doctype html><html><body>Not found</body></html>');
    const fetchFn = vi.fn(async (_url: string | URL | Request) => new Response(html));
    const cache = memoryCache();
    const deps = { fetchFn, cache, base: '/' };
    await expect(loadFontBytes({ kind: 'bundled', id: 'lora' }, R, deps)).rejects.toThrow(
      'The download for Lora was not a font file.',
    );
    expect(cache.set).not.toHaveBeenCalled();
    expect(cache.data.has('font:bundled:lora')).toBe(false);
  });

  it('treats a cached non-font entry as a miss and downloads again', async () => {
    const cache = memoryCache({ 'font:bundled:lato': new TextEncoder().encode('<!doctype html>') });
    const fetchFn = bytesFetch();
    const bytes = await loadFontBytes({ kind: 'bundled', id: 'lato' }, R, { fetchFn, cache, base: '/' });
    expect(bytes).toEqual(FONT_BYTES);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(cache.data.get('font:bundled:lato')).toEqual(FONT_BYTES);
  });

  it('names the font when a download fails', async () => {
    const deps = { fetchFn: bytesFetch(false), cache: memoryCache(), base: '/' };
    await expect(loadFontBytes({ kind: 'bundled', id: 'merriweather' }, R, deps)).rejects.toThrow(/Merriweather/);
  });

  it('names the font when the network is down', async () => {
    const fetchFn = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const deps = { fetchFn, cache: memoryCache(), base: '/' };
    await expect(loadFontBytes({ kind: 'bundled', id: 'lora' }, R, deps)).rejects.toThrow(/Lora/);
  });

  it('rejects an unknown bundled id with the id in the message', async () => {
    const deps = { fetchFn: bytesFetch(), cache: memoryCache(), base: '/' };
    await expect(loadFontBytes({ kind: 'bundled', id: 'zapf' }, R, deps)).rejects.toThrow(/zapf/);
  });

  it('still loads when the cache throws', async () => {
    const cache: KeyValueCache = {
      get: async () => { throw new Error('blocked'); },
      set: async () => { throw new Error('blocked'); },
    };
    const bytes = await loadFontBytes({ kind: 'bundled', id: 'lato' }, R, { fetchFn: bytesFetch(), cache, base: '/' });
    expect(bytes).toEqual(FONT_BYTES);
  });

  it('loads a Google font through the catalog and caches it', async () => {
    const cache = memoryCache({
      [GOOGLE_CATALOG_CACHE_KEY]: {
        fetchedAt: Date.now(),
        items: [{ family: 'Inter', category: 'sans-serif', files: { regular: 'https://fonts.gstatic.com/inter.ttf' } }],
      },
    });
    const fetchFn = bytesFetch();
    const deps = { fetchFn, cache, base: '/', googleApiKey: 'K' };
    expect(await loadFontBytes({ kind: 'google', family: 'Inter' }, R, deps)).toEqual(FONT_BYTES);
    expect(String(fetchFn.mock.calls[0][0])).toBe('https://fonts.gstatic.com/inter.ttf');
    expect(cache.data.has('font:google:Inter')).toBe(true);
    await loadFontBytes({ kind: 'google', family: 'Inter' }, R, deps);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('names a Google family that is not in the catalog', async () => {
    const cache = memoryCache({ [GOOGLE_CATALOG_CACHE_KEY]: { fetchedAt: Date.now(), items: [] } });
    const deps = { fetchFn: bytesFetch(), cache, base: '/', googleApiKey: 'K' };
    await expect(loadFontBytes({ kind: 'google', family: 'Nonesuch' }, R, deps)).rejects.toThrow(/Nonesuch/);
  });

  it('reads local fonts through the injected reader without caching', async () => {
    const cache = memoryCache();
    const localBytes = vi.fn(async () => FONT_BYTES);
    const ref = { kind: 'local' as const, postscriptName: 'Arial-Regular', family: 'Arial' };
    expect(await loadFontBytes(ref, R, { cache, localBytes, base: '/' })).toEqual(FONT_BYTES);
    expect(localBytes).toHaveBeenCalledWith('Arial-Regular');
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('names a local font that fails to load', async () => {
    const localBytes = vi.fn(async () => { throw new Error('Permission was declined.'); });
    const ref = { kind: 'local' as const, postscriptName: 'Arial-Regular', family: 'Arial' };
    await expect(loadFontBytes(ref, R, { cache: memoryCache(), localBytes, base: '/' })).rejects.toThrow(/Arial/);
  });
});

describe('isSfnt', () => {
  const ascii = (s: string) => new TextEncoder().encode(`${s}rest`);
  it('accepts TrueType, OpenType, and collection signatures', () => {
    expect(isSfnt(new Uint8Array([0, 1, 0, 0, 5]))).toBe(true);
    expect(isSfnt(ascii('true'))).toBe(true);
    expect(isSfnt(ascii('OTTO'))).toBe(true);
    expect(isSfnt(ascii('ttcf'))).toBe(true);
  });

  it('rejects other content and short input', () => {
    expect(isSfnt(ascii('<!do'))).toBe(false);
    expect(isSfnt(new Uint8Array([0, 1, 0]))).toBe(false);
    expect(isSfnt(new Uint8Array())).toBe(false);
  });
});

describe('fontCacheKey', () => {
  it('keys bundled and Google fonts and skips the rest', () => {
    expect(fontCacheKey({ kind: 'bundled', id: 'lato' })).toBe('font:bundled:lato');
    expect(fontCacheKey({ kind: 'google', family: 'Open Sans' })).toBe('font:google:Open Sans');
    expect(fontCacheKey({ kind: 'standard', id: 'helvetica' })).toBeNull();
    expect(fontCacheKey({ kind: 'local', postscriptName: 'A', family: 'A' })).toBeNull();
  });
});

describe('createBrowserFontProvider', () => {
  it('loads through injected deps and reuses in-flight results', async () => {
    const fetchFn = bytesFetch();
    const provider = createBrowserFontProvider({ fetchFn, cache: memoryCache(), base: '/' });
    const ref = { kind: 'bundled' as const, id: 'lato' };
    const [a, b] = await Promise.all([provider.getBytes(ref, R), provider.getBytes(ref, R)]);
    expect(a).toEqual(FONT_BYTES);
    expect(b).toEqual(FONT_BYTES);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(await provider.getBytes({ kind: 'standard', id: 'helvetica' }, R)).toBeNull();
  });

  it('retries after a failure instead of caching the error', async () => {
    const fetchFn = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(new Response(FONT_BYTES));
    const provider = createBrowserFontProvider({ fetchFn, cache: memoryCache(), base: '/' });
    const ref = { kind: 'bundled' as const, id: 'lato' };
    await expect(provider.getBytes(ref, R)).rejects.toThrow(/Lato/);
    expect(await provider.getBytes(ref, R)).toEqual(FONT_BYTES);
  });
});

/** A font-like payload that records which URL it came from. */
function tagged(url: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array([0, 1, 0, 0, ...new TextEncoder().encode(url)]);
}
const tagOf = (bytes: Uint8Array | null) => (bytes ? new TextDecoder().decode(bytes.subarray(4)) : null);

/** Serves tagged bytes for every URL except those listed as failing (404). */
function routeFetch(failing: string[] = []) {
  return vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    return failing.some((f) => u.endsWith(f)) ? new Response('nope', { status: 404 }) : new Response(tagged(u));
  });
}

const loraCatalog = {
  [GOOGLE_CATALOG_CACHE_KEY]: {
    fetchedAt: Date.now(),
    items: [
      {
        family: 'Lora',
        category: 'serif',
        files: { regular: 'https://g/lora.ttf', bold: 'https://g/lora-b.ttf', italic: 'https://g/lora-i.ttf' },
      },
      { family: 'Inter', category: 'sans-serif', files: { regular: 'https://g/inter.ttf' } },
    ],
  },
};

const arialListing: LocalFont[] = [
  {
    postscriptName: 'ArialMT', family: 'Arial', fullName: 'Arial',
    faces: { regular: 'ArialMT', bold: 'Arial-BoldMT', italic: 'Arial-ItalicMT', boldItalic: 'Arial-BoldItalicMT' },
  },
  { postscriptName: 'Zapfino', family: 'Zapfino', fullName: 'Zapfino', faces: { regular: 'Zapfino' } },
];
const ARIAL = { kind: 'local' as const, postscriptName: 'ArialMT', family: 'Arial' };
const ZAPFINO = { kind: 'local' as const, postscriptName: 'Zapfino', family: 'Zapfino' };

describe('fontCacheKey with faces', () => {
  it('keeps the regular key unchanged so existing caches still hit', () => {
    expect(fontCacheKey({ kind: 'bundled', id: 'lato' }, R)).toBe('font:bundled:lato');
    expect(fontCacheKey({ kind: 'google', family: 'Lora' }, R)).toBe('font:google:Lora');
  });

  it('adds the face for bold and italic', () => {
    expect(fontCacheKey({ kind: 'bundled', id: 'lato' }, B)).toBe('font:bundled:lato:bold');
    expect(fontCacheKey({ kind: 'google', family: 'Lora' }, I)).toBe('font:google:Lora:italic');
    expect(fontCacheKey({ kind: 'bundled', id: 'lato' }, BI)).toBe('font:bundled:lato:bolditalic');
    expect(fontCacheKey({ kind: 'standard', id: 'times' }, B)).toBeNull();
    expect(fontCacheKey(ARIAL, B)).toBeNull();
  });
});

describe('loadFontBytes with a face', () => {
  it('fetches a bundled face file and caches it under the face key', async () => {
    const fetchFn = routeFetch();
    const cache = memoryCache();
    const bytes = await loadFontBytes({ kind: 'bundled', id: 'lato' }, B, { fetchFn, cache, base: '/app/' });
    expect(tagOf(bytes)).toBe('/app/fonts/lato/Lato-Bold.ttf');
    expect(cache.data.has('font:bundled:lato:bold')).toBe(true);
    expect(cache.data.has('font:bundled:lato')).toBe(false);

    await loadFontBytes({ kind: 'bundled', id: 'lato' }, B, { fetchFn, cache, base: '/app/' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('fetches italic and bold italic bundled faces', async () => {
    const fetchFn = routeFetch();
    const deps = { fetchFn, cache: memoryCache(), base: '/' };
    expect(tagOf(await loadFontBytes({ kind: 'bundled', id: 'noto-serif' }, I, deps)))
      .toBe('/fonts/noto-serif/NotoSerif-Italic.ttf');
    expect(tagOf(await loadFontBytes({ kind: 'bundled', id: 'noto-serif' }, BI, deps)))
      .toBe('/fonts/noto-serif/NotoSerif-BoldItalic.ttf');
  });

  it('names the font and face when a face download fails', async () => {
    const deps = { fetchFn: routeFetch(['Lora-BoldItalic.ttf']), cache: memoryCache(), base: '/' };
    await expect(loadFontBytes({ kind: 'bundled', id: 'lora' }, BI, deps)).rejects.toThrow(/Lora Bold Italic/);
  });

  it('loads a Google face from the catalog and caches it under the face key', async () => {
    const cache = memoryCache(loraCatalog);
    const fetchFn = routeFetch();
    const deps = { fetchFn, cache, base: '/', googleApiKey: 'K' };
    expect(tagOf(await loadFontBytes({ kind: 'google', family: 'Lora' }, B, deps))).toBe('https://g/lora-b.ttf');
    expect(cache.data.has('font:google:Lora:bold')).toBe(true);
  });

  it('rejects a Google face the family lacks', async () => {
    const deps = { fetchFn: routeFetch(), cache: memoryCache(loraCatalog), base: '/', googleApiKey: 'K' };
    await expect(loadFontBytes({ kind: 'google', family: 'Inter' }, B, deps)).rejects.toThrow('Inter has no bold face.');
    await expect(loadFontBytes({ kind: 'google', family: 'Lora' }, BI, deps))
      .rejects.toThrow('Lora has no bold italic face.');
  });

  it('reads an installed face by its PostScript name from the listing', async () => {
    const localBytes = vi.fn(async (name: string) => tagged(name));
    const localFonts = vi.fn(async () => arialListing);
    const deps = { cache: memoryCache(), localBytes, localFonts, base: '/' };
    expect(tagOf(await loadFontBytes(ARIAL, BI, deps))).toBe('Arial-BoldItalicMT');
    expect(localBytes).toHaveBeenCalledWith('Arial-BoldItalicMT');
  });

  it('does not list installed fonts for the regular face', async () => {
    const localBytes = vi.fn(async (name: string) => tagged(name));
    const localFonts = vi.fn(async () => arialListing);
    expect(tagOf(await loadFontBytes(ARIAL, R, { cache: memoryCache(), localBytes, localFonts, base: '/' })))
      .toBe('ArialMT');
    expect(localFonts).not.toHaveBeenCalled();
  });

  it('rejects an installed face the family lacks', async () => {
    const deps = { cache: memoryCache(), localBytes: vi.fn(), localFonts: async () => arialListing, base: '/' };
    await expect(loadFontBytes(ZAPFINO, I, deps)).rejects.toThrow('Zapfino has no italic face.');
  });
});

describe('resolveFace', () => {
  const all = { bold: true, italic: true, boldItalic: true };
  const none = { bold: false, italic: false, boldItalic: false };

  it('keeps a face that exists', () => {
    for (const style of [R, B, I, BI]) expect(resolveFace(style, all)).toEqual(style);
  });

  it('falls back bold italic → bold → regular', () => {
    expect(resolveFace(BI, { bold: true, italic: true, boldItalic: false })).toEqual(B);
    expect(resolveFace(BI, { bold: false, italic: true, boldItalic: false })).toEqual(R);
    expect(resolveFace(BI, none)).toEqual(R);
  });

  it('falls back italic → regular and bold → regular', () => {
    expect(resolveFace(I, none)).toEqual(R);
    expect(resolveFace(B, none)).toEqual(R);
    expect(resolveFace(R, none)).toEqual(R);
  });

  it('lists the fallback chain for each face', () => {
    expect(faceFallbacks(BI)).toEqual([BI, B, R]);
    expect(faceFallbacks(B)).toEqual([B, R]);
    expect(faceFallbacks(I)).toEqual([I, R]);
    expect(faceFallbacks(R)).toEqual([R]);
  });
});

describe('availableFacesFor', () => {
  const all = { bold: true, italic: true, boldItalic: true };
  const none = { bold: false, italic: false, boldItalic: false };

  it('reports every face for standard fonts', async () => {
    expect(await availableFacesFor({ kind: 'standard', id: 'helvetica' })).toEqual(all);
  });

  it('reads bundled faces from the catalog', async () => {
    expect(await availableFacesFor({ kind: 'bundled', id: 'lato' })).toEqual(all);
    expect(await availableFacesFor({ kind: 'bundled', id: 'zapf' })).toEqual(none);
  });

  it('reads Google faces from the catalog files', async () => {
    const deps = { fetchFn: routeFetch(), cache: memoryCache(loraCatalog), googleApiKey: 'K' };
    expect(await availableFacesFor({ kind: 'google', family: 'Lora' }, deps))
      .toEqual({ bold: true, italic: true, boldItalic: false });
    expect(await availableFacesFor({ kind: 'google', family: 'Inter' }, deps)).toEqual(none);
    expect(await availableFacesFor({ kind: 'google', family: 'Nonesuch' }, deps)).toEqual(none);
  });

  it('reports no extra Google faces when the catalog is unreachable', async () => {
    const deps = { fetchFn: vi.fn(async () => new Response('x', { status: 503 })), cache: memoryCache(), googleApiKey: 'K' };
    expect(await availableFacesFor({ kind: 'google', family: 'Lora' }, deps)).toEqual(none);
  });

  it('reads installed faces from the listing', async () => {
    expect(await availableFacesFor(ARIAL, { localFonts: async () => arialListing })).toEqual(all);
    expect(await availableFacesFor(ZAPFINO, { localFonts: async () => arialListing })).toEqual(none);
    const failing = async (): Promise<LocalFont[]> => { throw new Error('Permission was declined.'); };
    expect(await availableFacesFor(ARIAL, { localFonts: failing })).toEqual(none);
  });
});

describe('createBrowserFontProvider faces', () => {
  it('reports available faces', async () => {
    const provider = createBrowserFontProvider({ fetchFn: routeFetch(), cache: memoryCache(), base: '/' });
    expect(await provider.availableFaces({ kind: 'bundled', id: 'lora' }))
      .toEqual({ bold: true, italic: true, boldItalic: true });
    const local = createBrowserFontProvider({ cache: memoryCache(), localFonts: async () => arialListing });
    expect(await local.availableFaces(ZAPFINO)).toEqual({ bold: false, italic: false, boldItalic: false });
  });

  it('loads the requested face', async () => {
    const fetchFn = routeFetch();
    const provider = createBrowserFontProvider({ fetchFn, cache: memoryCache(), base: '/' });
    expect(tagOf(await provider.getBytes({ kind: 'bundled', id: 'lato' }, BI))).toBe('/fonts/lato/Lato-BoldItalic.ttf');
    expect(tagOf(await provider.getBytes({ kind: 'bundled', id: 'lato' }, R))).toBe('/fonts/lato/Lato-Regular.ttf');
  });

  it('falls back to regular for a face the font lacks, without throwing', async () => {
    const localBytes = vi.fn(async (name: string) => tagged(name));
    const provider = createBrowserFontProvider({ cache: memoryCache(), localBytes, localFonts: async () => arialListing });
    const bold = await provider.getBytes(ZAPFINO, B);
    const regular = await provider.getBytes(ZAPFINO, R);
    expect(tagOf(bold)).toBe('Zapfino');
    expect(bold).toBe(regular);
    expect(localBytes).toHaveBeenCalledTimes(1);
  });

  it('falls back bold italic → bold for an installed font with no bold italic', async () => {
    const listing: LocalFont[] = [
      { postscriptName: 'F-R', family: 'F', fullName: 'F', faces: { regular: 'F-R', bold: 'F-B', italic: 'F-I' } },
    ];
    const provider = createBrowserFontProvider({
      cache: memoryCache(), localBytes: async (n) => tagged(n), localFonts: async () => listing,
    });
    const ref = { kind: 'local' as const, postscriptName: 'F-R', family: 'F' };
    expect(tagOf(await provider.getBytes(ref, BI))).toBe('F-B');
  });

  it('falls back to the next face when a face download fails', async () => {
    const fetchFn = routeFetch(['Lora-BoldItalic.ttf', 'Lora-Bold.ttf']);
    const onFaceFallback = vi.fn();
    const provider = createBrowserFontProvider({ fetchFn, cache: memoryCache(), base: '/', onFaceFallback });
    expect(tagOf(await provider.getBytes({ kind: 'bundled', id: 'lora' }, BI))).toBe('/fonts/lora/Lora-Regular.ttf');
    expect(onFaceFallback).toHaveBeenCalledTimes(1);
    expect(onFaceFallback.mock.calls[0][0]).toMatchObject({ requested: BI, used: R });
  });

  it('reports a face that fails to download, with the face used instead and the error', async () => {
    const onFaceFallback = vi.fn();
    const provider = createBrowserFontProvider({
      fetchFn: routeFetch(['Lora-BoldItalic.ttf']), cache: memoryCache(), base: '/', onFaceFallback,
    });
    const ref = { kind: 'bundled' as const, id: 'lora' };
    expect(tagOf(await provider.getBytes(ref, BI))).toBe('/fonts/lora/Lora-Bold.ttf');
    expect(onFaceFallback).toHaveBeenCalledTimes(1);
    const info = onFaceFallback.mock.calls[0][0];
    expect(info).toMatchObject({ ref, requested: BI, used: B });
    expect(errorMessage(info.error)).toMatch(/Lora Bold Italic/);
  });

  it('does not report a face the font lacks or a face that loads', async () => {
    const onFaceFallback = vi.fn();
    const provider = createBrowserFontProvider({
      fetchFn: routeFetch(), cache: memoryCache(), base: '/', onFaceFallback,
      localBytes: async (n) => tagged(n), localFonts: async () => arialListing,
    });
    await provider.getBytes(ZAPFINO, B);
    await provider.getBytes({ kind: 'bundled', id: 'lora' }, BI);
    expect(onFaceFallback).not.toHaveBeenCalled();
  });

  it('warns on the console by default when it falls back', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const provider = createBrowserFontProvider({ fetchFn: routeFetch(['Lora-Italic.ttf']), cache: memoryCache(), base: '/' });
      expect(tagOf(await provider.getBytes({ kind: 'bundled', id: 'lora' }, I))).toBe('/fonts/lora/Lora-Regular.ttf');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toMatch(/Lora Italic/);
    } finally {
      warn.mockRestore();
    }
  });

  it('throws when the regular face cannot load', async () => {
    const provider = createBrowserFontProvider({ fetchFn: routeFetch(['.ttf']), cache: memoryCache(), base: '/' });
    await expect(provider.getBytes({ kind: 'bundled', id: 'lora' }, B)).rejects.toThrow(/Lora/);
  });

  it('returns null for standard fonts in every face', async () => {
    const provider = createBrowserFontProvider({ fetchFn: routeFetch(), cache: memoryCache(), base: '/' });
    expect(await provider.getBytes({ kind: 'standard', id: 'times' }, BI)).toBeNull();
  });

  it('loads each face once and keeps faces apart', async () => {
    const fetchFn = routeFetch();
    const provider = createBrowserFontProvider({ fetchFn, cache: memoryCache(), base: '/' });
    const ref = { kind: 'bundled' as const, id: 'lato' };
    await Promise.all([provider.getBytes(ref, B), provider.getBytes(ref, B), provider.getBytes(ref, I)]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe('createBrowserFontProvider face availability', () => {
  const all = { bold: true, italic: true, boldItalic: true };
  const none = { bold: false, italic: false, boldItalic: false };
  const catalogReads = (cache: { get: unknown }) =>
    (cache.get as ReturnType<typeof vi.fn>).mock.calls.filter(([k]) => k === GOOGLE_CATALOG_CACHE_KEY).length;

  it('remembers a regular-only Google font instead of reading the catalog again', async () => {
    const cache = memoryCache(loraCatalog);
    const provider = createBrowserFontProvider({ fetchFn: routeFetch(), cache, googleApiKey: 'K' });
    const inter = { kind: 'google' as const, family: 'Inter' };
    expect(await provider.availableFaces(inter)).toEqual(none);
    expect(await provider.availableFaces(inter)).toEqual(none);
    expect(catalogReads(cache)).toBe(1);
  });

  it('remembers an installed font with no extra faces from a successful listing', async () => {
    const localFonts = vi.fn(async () => arialListing);
    const provider = createBrowserFontProvider({ localFonts });
    expect(await provider.availableFaces(ZAPFINO)).toEqual(none);
    expect(await provider.availableFaces(ZAPFINO)).toEqual(none);
    expect(localFonts).toHaveBeenCalledTimes(1);
  });

  it('retries a failed listing on the next call', async () => {
    const localFonts = vi.fn<() => Promise<LocalFont[]>>()
      .mockRejectedValueOnce(new Error('Permission was declined.'))
      .mockResolvedValue(arialListing);
    const provider = createBrowserFontProvider({ localFonts });
    expect(await provider.availableFaces(ARIAL)).toEqual(none);
    expect(await provider.availableFaces(ARIAL)).toEqual(all);
    expect(await provider.availableFaces(ARIAL)).toEqual(all);
    expect(localFonts).toHaveBeenCalledTimes(2);
  });

  it('retries an empty listing, which can mean the permission was declined', async () => {
    const localFonts = vi.fn<() => Promise<LocalFont[]>>().mockResolvedValueOnce([]).mockResolvedValue(arialListing);
    const provider = createBrowserFontProvider({ localFonts });
    expect(await provider.availableFaces(ARIAL)).toEqual(none);
    expect(await provider.availableFaces(ARIAL)).toEqual(all);
    expect(localFonts).toHaveBeenCalledTimes(2);
  });

  it('retries a Google catalog that could not be loaded', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response('x', { status: 503 }))
      .mockResolvedValue(new Response(JSON.stringify({
        items: [{ family: 'Lora', category: 'serif', files: { regular: 'https://g/l.ttf', '700': 'https://g/lb.ttf' } }],
      })));
    const provider = createBrowserFontProvider({ fetchFn, cache: memoryCache(), googleApiKey: 'K' });
    const lora = { kind: 'google' as const, family: 'Lora' };
    expect(await provider.availableFaces(lora)).toEqual(none);
    expect(await provider.availableFaces(lora)).toEqual({ bold: true, italic: false, boldItalic: false });
  });
});

describe('Google catalog without injected deps', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('reads the catalog once per session for face lists and face loads', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_GOOGLE_FONTS_API_KEY', 'K');
    const api = 'https://www.googleapis.com/webfonts/v1/webfonts';
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.startsWith(api)) {
        return new Response(JSON.stringify({
          items: [{ family: 'Lora', category: 'serif', files: { regular: 'https://g/l.ttf', '700': 'https://g/lb.ttf' } }],
        }));
      }
      return new Response(tagged(u));
    });
    vi.stubGlobal('fetch', fetchFn);
    const loader = await import('../../src/lib/fonts/loader');
    const provider = loader.createBrowserFontProvider({ base: '/' });
    const lora = { kind: 'google' as const, family: 'Lora' };

    expect(await loader.availableFacesFor(lora)).toEqual({ bold: true, italic: false, boldItalic: false });
    expect(tagOf(await provider.getBytes(lora, B))).toBe('https://g/lb.ttf');
    expect(tagOf(await loader.loadFontBytes(lora, B))).toBe('https://g/lb.ttf');
    expect(fetchFn.mock.calls.filter(([u]) => String(u).startsWith(api))).toHaveLength(1);
  });
});
