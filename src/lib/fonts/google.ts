import { pickFace, REGULAR_FACE, type FaceStyle, type KeyValueCache } from './types';
import { defaultFontCache } from './cache';

/** TTF URLs per face; only `regular` is guaranteed. */
export type GoogleFontFiles = { regular: string; bold?: string; italic?: string; boldItalic?: string };

export type GoogleFont = { family: string; category: string; files: GoogleFontFiles };

export const GOOGLE_CATALOG_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const GOOGLE_CATALOG_CACHE_KEY = 'google-fonts:catalog';
const API_URL = 'https://www.googleapis.com/webfonts/v1/webfonts';

type CatalogCacheEntry = { fetchedAt: number; items: GoogleFont[] };

/** The build-time API key, or an empty string when the Google tier is disabled. */
export function getGoogleFontsApiKey(): string {
  return (import.meta.env.VITE_GOOGLE_FONTS_API_KEY ?? '').trim();
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const https = (url: string) => url.replace(/^http:\/\//, 'https://');

const isUrl = (v: unknown): v is string => typeof v === 'string' && v !== '';

/** API variant names for each face beyond regular. */
const VARIANTS = { bold: '700', italic: 'italic', boldItalic: '700italic' } as const;

/**
 * Turn a Google Fonts developer API response into `{ family, category, files }` entries, taking
 * the `regular`, `700`, `italic`, and `700italic` files. Families without a regular file are
 * skipped; `http://` file URLs are rewritten to `https://`.
 */
export function parseGoogleCatalog(json: unknown): GoogleFont[] {
  if (!isObj(json) || !Array.isArray(json.items)) return [];
  const out: GoogleFont[] = [];
  for (const item of json.items) {
    if (!isObj(item) || typeof item.family !== 'string' || !isObj(item.files)) continue;
    const regular = item.files.regular;
    if (!isUrl(regular)) continue;
    const files: GoogleFontFiles = { regular: https(regular) };
    for (const face of ['bold', 'italic', 'boldItalic'] as const) {
      const url = item.files[VARIANTS[face]];
      if (isUrl(url)) files[face] = https(url);
    }
    out.push({ family: item.family, category: typeof item.category === 'string' ? item.category : '', files });
  }
  return out;
}

/**
 * A cached catalog entry, or null when it is malformed. Entries cached before faces existed
 * have a single `fileUrl`, which becomes the regular file; those are flagged `legacy`.
 */
function readCachedFont(v: unknown): { font: GoogleFont; legacy: boolean } | null {
  if (!isObj(v) || typeof v.family !== 'string' || typeof v.category !== 'string') return null;
  if (isUrl(v.fileUrl)) {
    return { font: { family: v.family, category: v.category, files: { regular: v.fileUrl } }, legacy: true };
  }
  if (!isObj(v.files) || !isUrl(v.files.regular)) return null;
  const files: GoogleFontFiles = { regular: v.files.regular };
  for (const face of ['bold', 'italic', 'boldItalic'] as const) {
    if (v.files[face] !== undefined && !isUrl(v.files[face])) return null;
    if (isUrl(v.files[face])) files[face] = v.files[face];
  }
  return { font: { family: v.family, category: v.category, files }, legacy: false };
}

/**
 * The cached catalog, or null when there is none or it is malformed. `legacy` is true when it was
 * cached before faces existed, so it lists regular files only and should be refreshed.
 */
async function readCache(cache: KeyValueCache): Promise<(CatalogCacheEntry & { legacy: boolean }) | null> {
  try {
    const v = await cache.get(GOOGLE_CATALOG_CACHE_KEY);
    if (isObj(v) && typeof v.fetchedAt === 'number' && Array.isArray(v.items)) {
      const read = v.items.map(readCachedFont);
      if (read.every((r): r is NonNullable<typeof r> => r !== null)) {
        return { fetchedAt: v.fetchedAt, items: read.map((r) => r.font), legacy: read.some((r) => r.legacy) };
      }
    }
  } catch {
    // A blocked or broken cache is treated as empty.
  }
  return null;
}

/**
 * The Google Fonts catalog, served from the cache when it is under 7 days old. A catalog cached
 * before faces existed is treated as stale. When the API fails, stale cached data is returned if
 * any exists (for a pre-faces catalog, regular files only).
 */
export async function fetchGoogleCatalog(opts: {
  apiKey: string;
  fetchFn: typeof fetch;
  cache: KeyValueCache;
  now: number;
}): Promise<GoogleFont[]> {
  const { apiKey, fetchFn, cache, now } = opts;
  if (apiKey === '') throw new Error('No Google Fonts API key is configured.');

  const cached = await readCache(cache);
  if (cached && !cached.legacy && now >= cached.fetchedAt && now - cached.fetchedAt < GOOGLE_CATALOG_TTL_MS) {
    return cached.items;
  }

  let items: GoogleFont[];
  try {
    const res = await fetchFn(`${API_URL}?key=${encodeURIComponent(apiKey)}&sort=alpha`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    items = parseGoogleCatalog(await res.json());
    if (items.length === 0) throw new Error('empty catalog');
  } catch {
    if (cached) return cached.items;
    throw new Error("Can't reach Google Fonts right now.");
  }

  try {
    await cache.set(GOOGLE_CATALOG_CACHE_KEY, { fetchedAt: now, items } satisfies CatalogCacheEntry);
  } catch {
    // Caching is best-effort.
  }
  return items;
}

/**
 * The TTF URL for a face of a family (regular when no style is given), or undefined when the
 * catalog lacks the family or the family lacks the face.
 */
export function googleFontFileUrl(
  family: string,
  catalog: readonly GoogleFont[],
  style: FaceStyle = REGULAR_FACE,
): string | undefined {
  const files = catalog.find((f) => f.family === family)?.files;
  return files && pickFace(files, style);
}

let catalogOnce: Promise<GoogleFont[]> | null = null;

/**
 * The Google Fonts catalog, loaded once per session and shared by every caller.
 * A failed or empty result is not kept, so the next call tries again.
 * Defaults to the build-time API key, `fetch`, the IndexedDB cache, and the current time.
 */
export function loadGoogleCatalogOnce({
  apiKey = getGoogleFontsApiKey(),
  fetchFn = globalThis.fetch.bind(globalThis),
  cache = defaultFontCache(),
  now = Date.now(),
}: Partial<Parameters<typeof fetchGoogleCatalog>[0]> = {}): Promise<GoogleFont[]> {
  if (catalogOnce) return catalogOnce;
  const p: Promise<GoogleFont[]> = fetchGoogleCatalog({ apiKey, fetchFn, cache, now }).then((items) => {
    if (items.length === 0 && catalogOnce === p) catalogOnce = null;
    return items;
  });
  catalogOnce = p;
  p.catch(() => {
    if (catalogOnce === p) catalogOnce = null;
  });
  return p;
}
