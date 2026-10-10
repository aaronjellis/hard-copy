import { describe, it, expect } from 'vitest';
import { bundledPreviewFamily, ensurePreview, googlePreviewUrl, previewFamily } from '../../src/lib/fonts/preview';

describe('font previews', () => {
  it('gives each tier a CSS font-family value', () => {
    expect(previewFamily({ kind: 'standard', id: 'helvetica' })).toBe('Helvetica, Arial, sans-serif');
    expect(previewFamily({ kind: 'standard', id: 'times' })).toBe('"Times New Roman", Times, serif');
    expect(previewFamily({ kind: 'bundled', id: 'great-vibes', family: 'Great Vibes' }))
      .toBe('"hc-preview-great-vibes", var(--font-ui)');
    expect(previewFamily({ kind: 'google', family: 'Lobster Two' })).toBe('"Lobster Two", var(--font-ui)');
    expect(previewFamily({ kind: 'local', postscriptName: 'ArialMT', family: 'Arial' })).toBe('"Arial", var(--font-ui)');
  });

  it('escapes quotes in family names', () => {
    expect(previewFamily({ kind: 'local', postscriptName: 'x', family: 'My "Font"' })).toBe('"My \\"Font\\"", var(--font-ui)');
  });

  it('keeps bundled preview families under their own prefix', () => {
    expect(bundledPreviewFamily('noto-sans')).toBe('hc-preview-noto-sans');
  });

  it('subsets the Google stylesheet to the family name', () => {
    expect(googlePreviewUrl('Lobster Two'))
      .toBe('https://fonts.googleapis.com/css2?family=Lobster+Two&text=Lobster%20Two&display=swap');
  });

  it('does nothing without a document', () => {
    expect(typeof document).toBe('undefined');
    expect(() => {
      ensurePreview({ kind: 'bundled', id: 'lato', family: 'Lato' });
      ensurePreview({ kind: 'google', family: 'Lobster' });
      ensurePreview({ kind: 'standard', id: 'times' });
      ensurePreview({ kind: 'local', postscriptName: 'ArialMT', family: 'Arial' });
    }).not.toThrow();
  });
});
