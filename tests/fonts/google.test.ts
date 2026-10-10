import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseGoogleCatalog, fetchGoogleCatalog, googleFontFileUrl,
  GOOGLE_CATALOG_TTL_MS, GOOGLE_CATALOG_CACHE_KEY, type GoogleFont,
} from '../../src/lib/fonts/google';
import type { KeyValueCache } from '../../src/lib/fonts/types';

const fixture = {
  kind: 'webfonts#webfontList',
  items: [
    {
      family: 'ABeeZee',
      category: 'sans-serif',
      files: { regular: 'http://fonts.gstatic.com/s/abeezee/v22/abeezee.ttf', italic: 'http://x/i.ttf' },
    },
    {
      family: 'Lora',
      category: 'serif',
      files: {
        regular: 'http://x/lora-400.ttf',
        '500': 'http://x/lora-500.ttf',
        '700': 'http://x/lora-700.ttf',
        italic: 'http://x/lora-400i.ttf',
        '700italic': 'https://x/lora-700i.ttf',
      },
    },
    { family: 'Inter', category: 'sans-serif', files: { regular: 'https://fonts.gstatic.com/s/inter/inter.ttf' } },
    { family: 'Only Bold', category: 'display', files: { '700': 'http://fonts.gstatic.com/s/ob/ob.ttf' } },
    { family: 42, category: 'serif', files: { regular: 'http://bad' } },
  ],
};

function memoryCache(initial: Record<string, unknown> = {}): KeyValueCache & { data: Map<string, unknown> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get: vi.fn(async (k: string) => data.get(k)),
    set: vi.fn(async (k: string, v: unknown) => void data.set(k, v)),
  };
}

function jsonFetch(body: unknown, ok = true) {
  return vi.fn(async (_url: string | URL | Request) =>
    new Response(JSON.stringify(body), { status: ok ? 200 : 503 }),
  );
}

const parsed: GoogleFont[] = [
  {
    family: 'ABeeZee',
    category: 'sans-serif',
    files: { regular: 'https://fonts.gstatic.com/s/abeezee/v22/abeezee.ttf', italic: 'https://x/i.ttf' },
  },
  {
    family: 'Lora',
    category: 'serif',
    files: {
      regular: 'https://x/lora-400.ttf',
      bold: 'https://x/lora-700.ttf',
      italic: 'https://x/lora-400i.ttf',
      boldItalic: 'https://x/lora-700i.ttf',
    },
  },
  { family: 'Inter', category: 'sans-serif', files: { regular: 'https://fonts.gstatic.com/s/inter/inter.ttf' } },
];

describe('parseGoogleCatalog', () => {
  it('keeps family, category, and https file URLs for regular, 700, italic, and 700italic', () => {
    expect(parseGoogleCatalog(fixture)).toEqual(parsed);
  });

  it('skips families without a regular file or with a bad family name', () => {
    const families = parseGoogleCatalog(fixture).map((f) => f.family);
    expect(families).not.toContain('Only Bold');
    expect(families).toHaveLength(3);
  });

  it('returns an empty list for malformed input', () => {
    expect(parseGoogleCatalog(null)).toEqual([]);
    expect(parseGoogleCatalog({ items: 'nope' })).toEqual([]);
  });
});

describe('fetchGoogleCatalog', () => {
  const now = 1_800_000_000_000;

  it('fetches with the key, parses, and caches with a timestamp', async () => {
    const fetchFn = jsonFetch(fixture);
    const cache = memoryCache();
    const items = await fetchGoogleCatalog({ apiKey: 'K&Y', fetchFn, cache, now });
    expect(items).toEqual(parsed);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const url = String(fetchFn.mock.calls[0][0]);
    expect(url).toBe('https://www.googleapis.com/webfonts/v1/webfonts?key=K%26Y&sort=alpha');
    expect(cache.data.get(GOOGLE_CATALOG_CACHE_KEY)).toEqual({ fetchedAt: now, items: parsed });
  });

  it('returns fresh cached data without fetching', async () => {
    const fetchFn = jsonFetch(fixture);
    const cache = memoryCache({
      [GOOGLE_CATALOG_CACHE_KEY]: { fetchedAt: now - GOOGLE_CATALOG_TTL_MS + 1000, items: parsed.slice(1) },
    });
    const items = await fetchGoogleCatalog({ apiKey: 'K', fetchFn, cache, now });
    expect(items).toEqual(parsed.slice(1));
    expect(fetchFn).not.toHaveBeenCalled();
  });

  /** A fresh cache entry in the format used before faces existed: one `fileUrl` per family. */
  const legacyCache = () => memoryCache({
    [GOOGLE_CATALOG_CACHE_KEY]: {
      fetchedAt: now - 1000,
      items: [{ family: 'Inter', category: 'sans-serif', fileUrl: 'https://x/inter.ttf' }],
    },
  });

  it('refetches a fresh cached catalog from before faces, so bold and italic files appear', async () => {
    const fetchFn = jsonFetch(fixture);
    const cache = legacyCache();
    const items = await fetchGoogleCatalog({ apiKey: 'K', fetchFn, cache, now });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(items).toEqual(parsed);
    expect(cache.data.get(GOOGLE_CATALOG_CACHE_KEY)).toEqual({ fetchedAt: now, items: parsed });
  });

  it('falls back to a catalog from before faces, regular only, when the API fails', async () => {
    const fetchFn = jsonFetch({}, false);
    const cache = legacyCache();
    const items = await fetchGoogleCatalog({ apiKey: 'K', fetchFn, cache, now });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(items).toEqual([{ family: 'Inter', category: 'sans-serif', files: { regular: 'https://x/inter.ttf' } }]);
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('refetches when the cached data is stale', async () => {
    const fetchFn = jsonFetch(fixture);
    const cache = memoryCache({
      [GOOGLE_CATALOG_CACHE_KEY]: { fetchedAt: now - GOOGLE_CATALOG_TTL_MS - 1, items: [] },
    });
    const items = await fetchGoogleCatalog({ apiKey: 'K', fetchFn, cache, now });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(items).toEqual(parsed);
  });

  it('falls back to stale cached data when the API fails', async () => {
    const fetchFn = jsonFetch({}, false);
    const cache = memoryCache({
      [GOOGLE_CATALOG_CACHE_KEY]: { fetchedAt: now - GOOGLE_CATALOG_TTL_MS * 2, items: parsed },
    });
    expect(await fetchGoogleCatalog({ apiKey: 'K', fetchFn, cache, now })).toEqual(parsed);
  });

  it('keeps a stale cache when the API returns an empty catalog', async () => {
    const stale = { fetchedAt: now - GOOGLE_CATALOG_TTL_MS * 2, items: parsed };
    const cache = memoryCache({ [GOOGLE_CATALOG_CACHE_KEY]: stale });
    expect(await fetchGoogleCatalog({ apiKey: 'K', fetchFn: jsonFetch({}), cache, now })).toEqual(parsed);
    expect(cache.set).not.toHaveBeenCalled();
    expect(cache.data.get(GOOGLE_CATALOG_CACHE_KEY)).toBe(stale);
  });

  it('throws a readable error for an empty catalog when nothing is cached', async () => {
    const cache = memoryCache();
    await expect(fetchGoogleCatalog({ apiKey: 'K', fetchFn: jsonFetch({}), cache, now }))
      .rejects.toThrow("Can't reach Google Fonts right now.");
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('throws a readable error when the API fails and nothing is cached', async () => {
    const fetchFn = jsonFetch({}, false);
    await expect(fetchGoogleCatalog({ apiKey: 'K', fetchFn, cache: memoryCache(), now }))
      .rejects.toThrow(/Google Fonts/);
  });

  it('throws when no API key is configured', async () => {
    await expect(fetchGoogleCatalog({ apiKey: '', fetchFn: jsonFetch(fixture), cache: memoryCache(), now }))
      .rejects.toThrow(/key/i);
  });

  it('ignores a cache that throws', async () => {
    const cache: KeyValueCache = {
      get: async () => { throw new Error('IDB blocked'); },
      set: async () => { throw new Error('IDB blocked'); },
    };
    expect(await fetchGoogleCatalog({ apiKey: 'K', fetchFn: jsonFetch(fixture), cache, now })).toEqual(parsed);
  });
});

describe('googleFontFileUrl', () => {
  const regular = { bold: false, italic: false };
  it('finds a family in the catalog', () => {
    expect(googleFontFileUrl('Inter', parsed, regular)).toBe('https://fonts.gstatic.com/s/inter/inter.ttf');
    expect(googleFontFileUrl('Inter', parsed)).toBe('https://fonts.gstatic.com/s/inter/inter.ttf');
    expect(googleFontFileUrl('Missing', parsed, regular)).toBeUndefined();
  });

  it('picks the file for each face', () => {
    expect(googleFontFileUrl('Lora', parsed, { bold: true, italic: false })).toBe('https://x/lora-700.ttf');
    expect(googleFontFileUrl('Lora', parsed, { bold: false, italic: true })).toBe('https://x/lora-400i.ttf');
    expect(googleFontFileUrl('Lora', parsed, { bold: true, italic: true })).toBe('https://x/lora-700i.ttf');
  });

  it('returns undefined for a face the family lacks', () => {
    expect(googleFontFileUrl('Inter', parsed, { bold: true, italic: false })).toBeUndefined();
    expect(googleFontFileUrl('ABeeZee', parsed, { bold: true, italic: true })).toBeUndefined();
  });
});

describe('loadGoogleCatalogOnce', () => {
  const now = 1_800_000_000_000;

  afterEach(() => vi.resetModules());

  async function freshModule() {
    vi.resetModules();
    return import('../../src/lib/fonts/google');
  }

  it('fetches once and shares the result', async () => {
    const { loadGoogleCatalogOnce } = await freshModule();
    const fetchFn = jsonFetch(fixture);
    const deps = { apiKey: 'K', fetchFn, cache: memoryCache(), now };
    expect(await loadGoogleCatalogOnce(deps)).toEqual(parsed);
    expect(await loadGoogleCatalogOnce(deps)).toEqual(parsed);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('resets on failure so the next call retries', async () => {
    const { loadGoogleCatalogOnce } = await freshModule();
    const cache = memoryCache();
    const failing = jsonFetch({}, false);
    await expect(loadGoogleCatalogOnce({ apiKey: 'K', fetchFn: failing, cache, now }))
      .rejects.toThrow("Can't reach Google Fonts right now.");

    const working = jsonFetch(fixture);
    expect(await loadGoogleCatalogOnce({ apiKey: 'K', fetchFn: working, cache, now })).toEqual(parsed);
    expect(working).toHaveBeenCalledTimes(1);

    // Kept after a success: later calls do not fetch again.
    expect(await loadGoogleCatalogOnce({ apiKey: 'K', fetchFn: working, cache, now })).toEqual(parsed);
    expect(working).toHaveBeenCalledTimes(1);
  });

  it('does not keep an empty catalog', async () => {
    const { loadGoogleCatalogOnce } = await freshModule();
    const fetchFn = jsonFetch(fixture);
    const empty = memoryCache({ [GOOGLE_CATALOG_CACHE_KEY]: { fetchedAt: now, items: [] } });
    expect(await loadGoogleCatalogOnce({ apiKey: 'K', fetchFn, cache: empty, now })).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();

    expect(await loadGoogleCatalogOnce({ apiKey: 'K', fetchFn, cache: memoryCache(), now })).toEqual(parsed);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
