import { describe, it, expect } from 'vitest';
import { createPreviewController } from '../src/lib/preview-controller';

type In = { id: string };
type Prepared = { from: string; n: number };

/** A fake prepare whose calls stay pending until the test resolves them, in order. */
function harness(opts: { maxPages?: number } = {}) {
  const calls: { input: In; resolve(): void; reject(err: Error): void }[] = [];
  const draws: { from: string; pages: number[] | 'all' }[] = [];
  let made = 0;
  let active = 0;
  let maxActive = 0;
  const controller = createPreviewController<In, Prepared, string>({
    prepare: (input) => {
      active++;
      maxActive = Math.max(maxActive, active);
      return new Promise<Prepared>((resolve, reject) => {
        calls.push({
          input,
          resolve: () => {
            active--;
            resolve({ from: input.id, n: ++made });
          },
          reject: (err) => {
            active--;
            reject(err);
          },
        });
      });
    },
    draw: async (p, pages) => {
      draws.push({ from: p.from, pages });
      return `${p.from}:${pages === 'all' ? 'all' : pages.join(',')}`;
    },
    same: (a, b) => a.id === b.id,
    maxPages: opts.maxPages,
  });
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  return { controller, calls, draws, flush, maxActive: () => maxActive };
}

describe('preview controller: single flight', () => {
  it('never overlaps layouts, and runs only the latest request once after the current one', async () => {
    const h = harness();
    const first = h.controller.request({ id: 'a' });
    await h.flush();
    const b = h.controller.request({ id: 'b' });
    const c = h.controller.request({ id: 'c' });
    await h.flush();
    expect(h.calls.map((x) => x.input.id)).toEqual(['a']);
    expect(h.controller.state().busy).toBe(true);

    h.calls[0].resolve();
    await h.flush();
    // 'b' was superseded by 'c' before it started.
    expect(h.calls.map((x) => x.input.id)).toEqual(['a', 'c']);
    expect(h.maxActive()).toBe(1);

    h.calls[1].resolve();
    const results = await Promise.all([first, b, c]);
    // Everyone waiting gets the latest layout.
    expect(results.map((r) => r?.from)).toEqual(['c', 'c', 'c']);
    expect(h.controller.state()).toMatchObject({ busy: false, input: { id: 'c' }, error: null });
  });

  it('does not rerun when the request in flight is asked for again', async () => {
    const h = harness();
    const one = h.controller.request({ id: 'a' });
    await h.flush();
    const two = h.controller.request({ id: 'a' });
    h.calls[0].resolve();
    expect((await one)?.n).toBe(1);
    expect((await two)?.n).toBe(1);
    expect(h.calls).toHaveLength(1);
  });

  it('skips a queued request that came back to the layout just prepared', async () => {
    const h = harness();
    void h.controller.request({ id: 'a' });
    await h.flush();
    void h.controller.request({ id: 'b' });
    const last = h.controller.request({ id: 'a' });
    h.calls[0].resolve();
    expect((await last)?.from).toBe('a');
    expect(h.calls).toHaveLength(1);
  });

  it('reports a failure, rejects its waiters, and retries the same input on the next request', async () => {
    const h = harness();
    const p = h.controller.request({ id: 'a' });
    await h.flush();
    h.calls[0].reject(new Error('boom'));
    await expect(p).rejects.toThrow('boom');
    expect(h.controller.state().error).toBeInstanceOf(Error);

    const retry = h.controller.request({ id: 'a' });
    await h.flush();
    expect(h.calls).toHaveLength(2);
    h.calls[1].resolve();
    expect((await retry)?.from).toBe('a');
    expect(h.controller.state().error).toBeNull();
  });

  it('discards a layout that finishes after clear()', async () => {
    const h = harness();
    const p = h.controller.request({ id: 'a' });
    await h.flush();
    h.controller.clear();
    h.calls[0].resolve();
    expect(await p).toBeNull();
    expect(h.controller.state().prepared).toBeNull();
  });

  it('runs nothing after dispose()', async () => {
    const h = harness();
    h.controller.dispose();
    expect(await h.controller.request({ id: 'a' })).toBeNull();
    expect(h.calls).toHaveLength(0);
  });

  it('notifies subscribers of each change', async () => {
    const h = harness();
    const seen: boolean[] = [];
    h.controller.subscribe((s) => seen.push(s.busy));
    const p = h.controller.request({ id: 'a' });
    await h.flush();
    h.calls[0].resolve();
    await p;
    expect(seen[0]).toBe(true);
    expect(seen[seen.length - 1]).toBe(false);
  });
});

describe('preview controller: cache', () => {
  it('returns the prepared layout without preparing again when nothing changed', async () => {
    const h = harness();
    const p = h.controller.request({ id: 'a' });
    await h.flush();
    h.calls[0].resolve();
    const first = await p;
    const again = await h.controller.request({ id: 'a' });
    expect(again).toBe(first);
    expect(h.calls).toHaveLength(1);
  });

  it('draws each page once per layout, and the whole document once', async () => {
    const h = harness();
    const p = h.controller.request({ id: 'a' });
    await h.flush();
    h.calls[0].resolve();
    const prepared = (await p)!;
    expect(await h.controller.page(prepared, 2)).toBe('a:2');
    expect(await h.controller.page(prepared, 2)).toBe('a:2');
    expect(await h.controller.page(prepared, 3)).toBe('a:3');
    expect(await h.controller.all(prepared)).toBe('a:all');
    expect(await h.controller.all(prepared)).toBe('a:all');
    expect(h.draws).toEqual([
      { from: 'a', pages: [2] },
      { from: 'a', pages: [3] },
      { from: 'a', pages: 'all' },
    ]);
  });

  it('keeps only the most recently used pages', async () => {
    const h = harness({ maxPages: 2 });
    const p = h.controller.request({ id: 'a' });
    await h.flush();
    h.calls[0].resolve();
    const prepared = (await p)!;
    await h.controller.page(prepared, 0);
    await h.controller.page(prepared, 1);
    await h.controller.page(prepared, 0);
    await h.controller.page(prepared, 2); // evicts page 1
    await h.controller.page(prepared, 0);
    await h.controller.page(prepared, 1);
    expect(h.draws.map((d) => d.pages)).toEqual([[0], [1], [2], [1]]);
  });
});
