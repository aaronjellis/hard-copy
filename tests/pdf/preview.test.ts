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
