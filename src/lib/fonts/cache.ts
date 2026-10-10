import type { KeyValueCache } from './types';

let idbCache: KeyValueCache | null = null;

/** An idb-keyval backed cache, imported lazily so modules using it stay usable outside the browser. */
export function defaultFontCache(): KeyValueCache {
  idbCache ??= {
    get: async (key) => (await import('idb-keyval')).get(key),
    set: async (key, value) => (await import('idb-keyval')).set(key, value),
  };
  return idbCache;
}
