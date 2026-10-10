import type { AvailableFaces, FaceStyle, FontProvider, FontRef, KeyValueCache } from './types';
import {
  FACE_LABELS, NO_FACES, faceFallbacks, faceKey, fontLabel, fontRefKey, hasFace, isRegularFace, pickFace, REGULAR_FACE,
} from './types';
import { bundledFaceFile, getBundledFont } from './catalog';
import {
  fetchGoogleCatalog, getGoogleFontsApiKey, googleFontFileUrl, loadGoogleCatalogOnce, type GoogleFont,
} from './google';
import { loadLocalFontsOnce, localFontBytes, type LocalFont } from './local';
import { defaultFontCache } from './cache';
import { errorMessage } from '../errors';

export { faceFallbacks, resolveFace } from './types';

export type FontLoaderDeps = {
  fetchFn?: typeof fetch;
  cache?: KeyValueCache;
  /** Base URL for bundled font files; defaults to `import.meta.env.BASE_URL`. */
  base?: string;
  /** Defaults to `getGoogleFontsApiKey()`. */
  googleApiKey?: string;
  /** Reads an installed font; defaults to `localFontBytes`. */
  localBytes?: (postscriptName: string) => Promise<Uint8Array>;
  /** Lists installed families with their faces; defaults to `loadLocalFontsOnce`. */
  localFonts?: () => Promise<LocalFont[]>;
  /**
   * Called by `createBrowserFontProvider` when a requested face fails to load and another face is
   * used instead. `requested` is the face the caller asked for; `error` is the first load failure.
   * Defaults to `console.warn` with the error's message.
   */
  onFaceFallback?: (info: { ref: FontRef; requested: FaceStyle; used: FaceStyle; error: unknown }) => void;
};

/**
 * IndexedDB key for cacheable fonts (bundled and Google); null for the rest. The regular face keeps
 * the key it had before faces existed (`font:bundled:lato`); other faces add theirs
 * (`font:bundled:lato:bold`).
 */
export function fontCacheKey(ref: FontRef, style: FaceStyle = REGULAR_FACE): string | null {
  if (ref.kind !== 'bundled' && ref.kind !== 'google') return null;
  return `font:${fontRefKey(ref, isRegularFace(style) ? undefined : style)}`;
}

const ALL_FACES: Readonly<AvailableFaces> = Object.freeze({ bold: true, italic: true, boldItalic: true });

function facesFrom(files: { bold?: string; italic?: string; boldItalic?: string }): AvailableFaces {
  return { bold: !!files.bold, italic: !!files.italic, boldItalic: !!files.boldItalic };
}

/**
 * The Google Fonts catalog. Without injected `fetchFn`, `cache`, or `googleApiKey`, it is the
 * session-wide `loadGoogleCatalogOnce`; with any of them, it is fetched with those.
 */
function googleCatalog(deps: FontLoaderDeps): Promise<GoogleFont[]> {
  if (deps.fetchFn === undefined && deps.cache === undefined && deps.googleApiKey === undefined) {
    return loadGoogleCatalogOnce();
  }
  return fetchGoogleCatalog({
    apiKey: deps.googleApiKey ?? getGoogleFontsApiKey(),
    fetchFn: deps.fetchFn ?? globalThis.fetch.bind(globalThis),
    cache: deps.cache ?? defaultFontCache(),
    now: Date.now(),
  });
}

function localListing(deps: FontLoaderDeps): Promise<LocalFont[]> {
  return (deps.localFonts ?? (() => loadLocalFontsOnce()))();
}

/** The listing entry for an installed font: by PostScript name, then by family. */
function findLocal(listing: readonly LocalFont[], ref: Extract<FontRef, { kind: 'local' }>): LocalFont | undefined {
  return listing.find((f) => f.postscriptName === ref.postscriptName) ?? listing.find((f) => f.family === ref.family);
}

/**
 * Which faces beyond regular a font has, like `availableFacesFor`, but throws when the Google
 * catalog or the installed-font listing cannot be obtained. An empty catalog or listing counts as
 * unavailable, since an empty listing can mean the permission was declined.
 */
async function availableFacesOrThrow(ref: FontRef, deps: FontLoaderDeps): Promise<AvailableFaces> {
  switch (ref.kind) {
    case 'standard':
      return { ...ALL_FACES };
    case 'bundled': {
      const font = getBundledFont(ref.id);
      return font ? facesFrom(font.faces) : { ...NO_FACES };
    }
    case 'google': {
      const catalog = await googleCatalog(deps);
      if (catalog.length === 0) throw new Error('The Google Fonts catalog is empty.');
      const files = catalog.find((f) => f.family === ref.family)?.files;
      return files ? facesFrom(files) : { ...NO_FACES };
    }
    case 'local': {
      const listing = await localListing(deps);
      if (listing.length === 0) throw new Error('No installed fonts are listed.');
      const found = findLocal(listing, ref);
      return found ? facesFrom(found.faces) : { ...NO_FACES };
    }
  }
}

/**
 * Which faces beyond regular a font has. Standard fonts have all of them; bundled fonts follow the
 * catalog; Google fonts follow the catalog's files; installed fonts follow the device's listing.
 * Never throws: when the Google catalog or the listing is unavailable, only regular is reported.
 */
export function availableFacesFor(ref: FontRef, deps: FontLoaderDeps = {}): Promise<AvailableFaces> {
  return availableFacesOrThrow(ref, deps).catch(() => ({ ...NO_FACES }));
}

/** True when the bytes start with a TrueType, OpenType, or TrueType Collection signature. */
export function isSfnt(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const [a, b, c, d] = bytes;
  if (a === 0 && b === 1 && c === 0 && d === 0) return true;
  const tag = String.fromCharCode(a, b, c, d);
  return tag === 'true' || tag === 'OTTO' || tag === 'ttcf';
}

function familyOf(ref: FontRef): string {
  if (ref.kind === 'bundled') return getBundledFont(ref.id)?.family ?? fontLabel(ref);
  return fontLabel(ref);
}

function toBytes(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  return null;
}

async function cacheGet(cache: KeyValueCache, key: string): Promise<Uint8Array | null> {
  try {
    const bytes = toBytes(await cache.get(key));
    return bytes && isSfnt(bytes) ? bytes : null;
  } catch {
    return null;
  }
}

async function cacheSet(cache: KeyValueCache, key: string, bytes: Uint8Array): Promise<void> {
  try {
    await cache.set(key, bytes);
  } catch {
    // Caching is best-effort.
  }
}

class NotAFontError extends Error {}

async function download(fetchFn: typeof fetch, url: string, family: string): Promise<Uint8Array> {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!isSfnt(bytes)) throw new NotAFontError(`The download for ${family} was not a font file.`);
  return bytes;
}

function withBase(base: string, path: string): string {
  return `${base.endsWith('/') ? base : `${base}/`}${path}`;
}

/**
 * Font file bytes for one face of a reference; null for standard fonts. Defaults to the regular face.
 * Bundled and Google fonts are cached under `fontCacheKey(ref, style)`; local fonts are not cached.
 * Failures, including a face the font lacks, throw an Error whose message names the font and face.
 * This does not fall back to another face; see `createBrowserFontProvider` for that.
 */
export async function loadFontBytes(
  ref: FontRef,
  style: FaceStyle = REGULAR_FACE,
  deps: FontLoaderDeps = {},
): Promise<Uint8Array | null> {
  if (ref.kind === 'standard') return null;
  const family = familyOf(ref);
  const regular = isRegularFace(style);
  const name = regular ? family : `${family} ${FACE_LABELS[faceKey(style)]}`;
  const missing = () => new Error(`${family} has no ${FACE_LABELS[faceKey(style)].toLowerCase()} face.`);

  if (ref.kind === 'local') {
    const read = deps.localBytes ?? localFontBytes;
    let postscriptName: string | undefined = ref.postscriptName;
    try {
      if (!regular) {
        const found = findLocal(await localListing(deps), ref);
        postscriptName = found && pickFace(found.faces, style);
      }
    } catch (err) {
      throw new Error(`Couldn't load the installed font ${name}: ${errorMessage(err)}`);
    }
    if (!postscriptName) throw missing();
    try {
      return await read(postscriptName);
    } catch (err) {
      throw new Error(`Couldn't load the installed font ${name}: ${errorMessage(err)}`);
    }
  }

  const fetchFn = deps.fetchFn ?? globalThis.fetch.bind(globalThis);
  const cache = deps.cache ?? defaultFontCache();
  const key = fontCacheKey(ref, style)!;

  let bundledFile: string | undefined;
  if (ref.kind === 'bundled') {
    const font = getBundledFont(ref.id);
    if (!font) throw new Error(`Unknown bundled font: ${ref.id}`);
    bundledFile = bundledFaceFile(font, style);
    if (!bundledFile) throw missing();
  }

  const cached = await cacheGet(cache, key);
  if (cached) return cached;

  let url: string;
  if (ref.kind === 'bundled') {
    url = withBase(deps.base ?? import.meta.env.BASE_URL, `fonts/${ref.id}/${bundledFile}`);
  } else {
    let catalog: GoogleFont[];
    try {
      catalog = await googleCatalog(deps);
    } catch (err) {
      throw new Error(`Couldn't load the Google font ${name}: ${errorMessage(err)}`);
    }
    if (!catalog.some((f) => f.family === ref.family)) {
      throw new Error(`The Google font ${family} is not in the Google Fonts catalog.`);
    }
    const found = googleFontFileUrl(ref.family, catalog, style);
    if (!found) throw missing();
    url = found;
  }

  let bytes: Uint8Array;
  try {
    bytes = await download(fetchFn, url, name);
  } catch (err) {
    if (err instanceof NotAFontError) throw new Error(err.message);
    throw new Error(`Couldn't download the font ${name}. Check your connection and try again.`);
  }
  await cacheSet(cache, key, bytes);
  return bytes;
}

/**
 * A FontProvider for the browser: IndexedDB cache, `fetch`, and the app's base URL.
 * `getBytes` resolves the nearest available face (see `resolveFace`) and, when a face fails to
 * load, tries the next one in the chain and reports it through `deps.onFaceFallback`; only a
 * failure of the regular face throws. Bytes and face lists are kept in memory for the session;
 * failed loads and face lists that could not be obtained are retried on the next call.
 */
export function createBrowserFontProvider(deps: FontLoaderDeps = {}): FontProvider {
  const memo = new Map<string, Promise<Uint8Array | null>>();
  const facesMemo = new Map<string, Promise<AvailableFaces>>();
  const onFaceFallback = deps.onFaceFallback ?? (({ error }) => console.warn(errorMessage(error)));

  /** `fn()` for key `k`, shared while pending and kept on success; a rejection is evicted. */
  function remember<T>(map: Map<string, Promise<T>>, k: string, fn: () => Promise<T>): Promise<T> {
    let p = map.get(k);
    if (!p) {
      const attempt = fn();
      map.set(k, attempt);
      attempt.catch(() => {
        if (map.get(k) === attempt) map.delete(k);
      });
      p = attempt;
    }
    return p;
  }

  const load = (ref: FontRef, style: FaceStyle) =>
    remember(memo, fontRefKey(ref, style), () => loadFontBytes(ref, style, deps));

  function availableFaces(ref: FontRef): Promise<AvailableFaces> {
    return remember(facesMemo, fontRefKey(ref), () => availableFacesOrThrow(ref, deps))
      .catch(() => ({ ...NO_FACES }));
  }

  return {
    availableFaces,
    async getBytes(ref, style) {
      if (ref.kind === 'standard') return null;
      const available = isRegularFace(style) ? NO_FACES : await availableFaces(ref);
      let firstError: { error: unknown } | null = null;
      // Regular always exists, so the chain ends with it.
      for (const face of faceFallbacks(style).filter((f) => hasFace(available, f))) {
        try {
          const bytes = await load(ref, face);
          if (firstError) onFaceFallback({ ref, requested: style, used: face, error: firstError.error });
          return bytes;
        } catch (err) {
          if (isRegularFace(face)) throw err;
          firstError ??= { error: err };
        }
      }
      return load(ref, REGULAR_FACE);
    },
  };
}
