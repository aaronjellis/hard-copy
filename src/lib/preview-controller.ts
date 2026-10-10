/**
 * Orchestrates the live preview: lays out (prepares) at most one table at a time, remembers the
 * last layout, and draws pages from it on demand.
 *
 * - Single flight: a request that arrives while a layout runs is queued; when several arrive, only
 *   the latest runs, once, after the current one finishes.
 * - No rebuild without change: a request equal to the last prepared one (see `same`) is a cache hit.
 * - Drawn pages are cached per prepared layout, so stepping back to a page or exporting twice
 *   draws nothing new.
 *
 * Generic over the input, the prepared layout, and the drawn document so tests can use fakes.
 */

export type ControllerDeps<In, P, D> = {
  prepare(input: In): Promise<P>;
  draw(prepared: P, pages: number[] | 'all'): Promise<D>;
  /** True when two inputs would prepare the same layout. */
  same(a: In, b: In): boolean;
  /** Single pages kept drawn per layout; defaults to 8. */
  maxPages?: number;
};

export type ControllerState<In, P> = {
  /** The latest prepared layout, and the input it came from. */
  prepared: P | null;
  input: In | null;
  /** A layout is running or queued. */
  busy: boolean;
  /** Why the latest layout failed; null after a success. */
  error: unknown;
};

export type PreviewController<In, P, D> = {
  /**
   * Ask for a layout of `input`. Resolves with the layout once the controller goes idle: this
   * input's, or a newer request's that superseded it (the latest wins). Rejects when that latest
   * layout failed. Resolves null after `clear` or `dispose`.
   */
  request(input: In): Promise<P | null>;
  /** The current state. */
  state(): ControllerState<In, P>;
  /** Called with the new state on every change. Returns an unsubscribe function. */
  subscribe(fn: (state: ControllerState<In, P>) => void): () => void;
  /** One page (from 0) of a layout, drawn alone; cached per layout. */
  page(prepared: P, index: number): Promise<D>;
  /** Every page of a layout; cached per layout. */
  all(prepared: P): Promise<D>;
  /** Forget the current layout and any queued request; a layout still running is discarded. */
  clear(): void;
  /** Stop: like `clear`, and no more requests run. */
  dispose(): void;
};

type Waiter<P> = { resolve(p: P | null): void; reject(err: unknown): void };

export function createPreviewController<In, P, D>(deps: ControllerDeps<In, P, D>): PreviewController<In, P, D> {
  const maxPages = deps.maxPages ?? 8;
  let state: ControllerState<In, P> = { prepared: null, input: null, busy: false, error: null };
  const listeners = new Set<(s: ControllerState<In, P>) => void>();
  let running = false;
  /** The input being prepared now, and the latest one waiting its turn (the dirty flag). */
  let inflight: In | null = null;
  let queued: In | null = null;
  /** The input whose layout last failed; asking for it again retries. */
  let failed: In | null = null;
  let waiters: Waiter<P>[] = [];
  /** Bumped by clear(): a layout started before it is discarded. */
  let generation = 0;
  let disposed = false;
  const pageCache = new WeakMap<object, Map<number, Promise<D>>>();
  const allCache = new WeakMap<object, Promise<D>>();

  function set(patch: Partial<ControllerState<In, P>>) {
    state = { ...state, ...patch };
    for (const fn of listeners) fn(state);
  }

  function settle() {
    const list = waiters;
    waiters = [];
    for (const w of list) {
      if (state.error !== null && failed !== null) w.reject(state.error);
      else w.resolve(state.prepared);
    }
  }

  async function run() {
    running = true;
    set({ busy: true });
    while (queued !== null && !disposed) {
      const input = queued;
      queued = null;
      // A request that came back to the current layout needs no work.
      if (state.input !== null && state.prepared !== null && failed === null && deps.same(state.input, input)) continue;
      inflight = input;
      const gen = generation;
      try {
        const prepared = await deps.prepare(input);
        if (gen === generation && !disposed) {
          failed = null;
          set({ prepared, input, error: null });
        }
      } catch (err) {
        if (gen === generation && !disposed) {
          failed = input;
          set({ error: err });
        }
      } finally {
        inflight = null;
      }
    }
    running = false;
    if (!disposed) set({ busy: false });
    settle();
  }

  function request(input: In): Promise<P | null> {
    if (disposed) return Promise.resolve(null);
    const isCurrent = state.prepared !== null && state.input !== null && failed === null && deps.same(state.input, input);
    // Idle and already prepared: a cache hit.
    if (!running && isCurrent) return Promise.resolve(state.prepared);
    const promise = new Promise<P | null>((resolve, reject) => waiters.push({ resolve, reject }));
    if (queued !== null || inflight === null || !deps.same(inflight, input)) {
      // The latest request replaces any queued one. A run already preparing this input needs no rerun,
      // unless something else was queued after it.
      queued = input;
    }
    if (!running) void run();
    return promise;
  }

  function cachedPage(prepared: P, index: number): Promise<D> {
    const key = prepared as unknown as object;
    let pages = pageCache.get(key);
    if (!pages) {
      pages = new Map();
      pageCache.set(key, pages);
    }
    let p = pages.get(index);
    if (p) {
      // Most recently used last.
      pages.delete(index);
      pages.set(index, p);
      return p;
    }
    p = deps.draw(prepared, [index]);
    pages.set(index, p);
    const map = pages;
    p.catch(() => {
      if (map.get(index) === p) map.delete(index);
    });
    while (pages.size > maxPages) pages.delete(pages.keys().next().value as number);
    return p;
  }

  function cachedAll(prepared: P): Promise<D> {
    const key = prepared as unknown as object;
    let p = allCache.get(key);
    if (!p) {
      p = deps.draw(prepared, 'all');
      allCache.set(key, p);
      const mine = p;
      p.catch(() => {
        if (allCache.get(key) === mine) allCache.delete(key);
      });
    }
    return p;
  }

  function clear() {
    generation++;
    queued = null;
    failed = null;
    set({ prepared: null, input: null, error: null, busy: running });
    if (!running) settle();
  }

  return {
    request,
    state: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    page: cachedPage,
    all: cachedAll,
    clear,
    dispose() {
      clear();
      disposed = true;
      listeners.clear();
      settle();
    },
  };
}
