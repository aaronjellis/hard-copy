/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { BUNDLED_FONTS, getBundledFont, bundledFontRef, bundledFaceFile } from '../../src/lib/fonts/catalog';
import { fontLabel } from '../../src/lib/fonts/types';

const fontsDir = resolve(__dirname, '../../public/fonts');

describe('bundled font catalog', () => {
  it('lists the eight text families with unique ids', () => {
    const ids = BUNDLED_FONTS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      'noto-sans', 'noto-serif', 'open-sans', 'lato', 'roboto', 'source-sans-3', 'merriweather', 'lora',
    ]);
  });

  it('points every entry at a font file and license on disk', () => {
    for (const f of BUNDLED_FONTS) {
      const path = resolve(fontsDir, f.id, f.file);
      expect(existsSync(path), path).toBe(true);
      expect(statSync(path).size).toBeGreaterThan(10_000);
      expect(existsSync(resolve(fontsDir, f.id, 'OFL.txt')), `${f.id} license`).toBe(true);
    }
  });

  it('lists Bold, Italic, and BoldItalic faces for every family', () => {
    for (const f of BUNDLED_FONTS) {
      const stem = f.file.replace(/-Regular\.ttf$/, '');
      expect(f.faces, f.id).toEqual({
        bold: `${stem}-Bold.ttf`,
        italic: `${stem}-Italic.ttf`,
        boldItalic: `${stem}-BoldItalic.ttf`,
      });
    }
  });

  it('points every listed face at a font file on disk', () => {
    for (const f of BUNDLED_FONTS) {
      for (const file of Object.values(f.faces)) {
        const path = resolve(fontsDir, f.id, file);
        expect(existsSync(path), path).toBe(true);
        expect(statSync(path).size, path).toBeGreaterThan(50_000);
      }
    }
  });

  it('finds the file for each face, or undefined when the face is missing', () => {
    const lato = getBundledFont('lato')!;
    expect(bundledFaceFile(lato, { bold: false, italic: false })).toBe('Lato-Regular.ttf');
    expect(bundledFaceFile(lato, { bold: true, italic: false })).toBe('Lato-Bold.ttf');
    expect(bundledFaceFile(lato, { bold: false, italic: true })).toBe('Lato-Italic.ttf');
    expect(bundledFaceFile(lato, { bold: true, italic: true })).toBe('Lato-BoldItalic.ttf');
    expect(bundledFaceFile({ ...lato, faces: {} }, { bold: true, italic: false })).toBeUndefined();
  });

  it('uses a known category for every entry', () => {
    for (const f of BUNDLED_FONTS) {
      expect(['sans', 'serif']).toContain(f.category);
    }
  });

  it('looks fonts up by id', () => {
    expect(getBundledFont('lato')?.family).toBe('Lato');
    expect(getBundledFont('nope')).toBeUndefined();
  });

  it('builds a font reference that carries the family', () => {
    const lora = getBundledFont('lora')!;
    expect(bundledFontRef(lora)).toEqual({ kind: 'bundled', id: 'lora', family: 'Lora' });
  });
});

describe('fontLabel for each kind', () => {
  it('labels standard, bundled, Google, and local fonts', () => {
    expect(fontLabel({ kind: 'standard', id: 'helvetica' })).toBe('Helvetica');
    expect(fontLabel({ kind: 'standard', id: 'times' })).toBe('Times');
    expect(fontLabel(bundledFontRef(getBundledFont('source-sans-3')!))).toBe('Source Sans 3');
    expect(fontLabel({ kind: 'google', family: 'Inter' })).toBe('Inter');
    expect(fontLabel({ kind: 'local', postscriptName: 'Arial-Regular', family: 'Arial' })).toBe('Arial');
  });
});
