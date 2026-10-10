import { describe, it, expect } from 'vitest';

describe('pdf preview module', () => {
  it('imports in Node without touching the DOM', async () => {
    expect(typeof document).toBe('undefined');
    const mod = await import('../../src/lib/pdf/preview');
    expect(typeof mod.renderPdfPageToCanvas).toBe('function');
    expect(mod.isRenderCancelled(new mod.RenderCancelledError())).toBe(true);
    expect(mod.isRenderCancelled(new Error('boom'))).toBe(false);
  });
});

describe('openPdf', () => {
  it('is exported for page-by-page rendering', async () => {
    const mod = await import('../../src/lib/pdf/preview');
    expect(typeof mod.openPdf).toBe('function');
  });
});

describe('createDocCache', () => {
  async function setup(max = 2) {
    const { createDocCache } = await import('../../src/lib/pdf/preview');
    const opened: Uint8Array[] = [];
    const destroyed: Uint8Array[] = [];
    const cache = createDocCache((bytes) => {
      opened.push(bytes);
      return { promise: Promise.resolve({ bytes }), destroy: () => void destroyed.push(bytes) };
    }, max);
    const flush = () => new Promise((r) => setTimeout(r, 0));
    return { cache, opened, destroyed, flush };
  }

  it('opens each bytes identity once while it stays cached', async () => {
    const { cache, opened } = await setup();
    const a = new Uint8Array([1]);
    (await cache.acquire(a)).release();
    (await cache.acquire(a)).release();
    expect(opened).toEqual([a]);
    // Equal contents but a different identity is a different document.
    (await cache.acquire(new Uint8Array([1]))).release();
    expect(opened).toHaveLength(2);
  });

  it('evicts the least recently used document past the limit', async () => {
    const { cache, destroyed, flush } = await setup(2);
    const [a, b, c] = [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])];
    (await cache.acquire(a)).release();
    (await cache.acquire(b)).release();
    (await cache.acquire(a)).release(); // a is now the most recent
    (await cache.acquire(c)).release();
    await flush();
    expect(destroyed).toEqual([b]);
    expect(cache.size).toBe(2);
  });

  it('waits for a document in use before destroying it', async () => {
    const { cache, destroyed, flush } = await setup();
    const a = new Uint8Array([1]);
    const held = await cache.acquire(a);
    cache.clear();
    await flush();
    expect(destroyed).toEqual([]);
    expect(cache.size).toBe(0);
    held.release();
    held.release();
    await flush();
    expect(destroyed).toEqual([a]);
  });
});
