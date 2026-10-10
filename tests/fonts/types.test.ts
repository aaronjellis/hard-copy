import { describe, it, expect } from 'vitest';
import {
  FACE_LABELS, NO_FACES, STANDARD_FONTS, faceKey, fontLabel, fontRefKey, hasFace, pickFace,
} from '../../src/lib/fonts/types';

describe('fontLabel', () => {
  it('names standard fonts', () => {
    expect(fontLabel({ kind: 'standard', id: 'helvetica' })).toBe('Helvetica');
    expect(fontLabel({ kind: 'standard', id: 'times' })).toBe('Times');
  });

  it('uses the family for bundled fonts, falling back to the id', () => {
    expect(fontLabel({ kind: 'bundled', id: 'lora', family: 'Lora' })).toBe('Lora');
    expect(fontLabel({ kind: 'bundled', id: 'lora' })).toBe('lora');
  });

  it('uses the family for Google and local fonts', () => {
    expect(fontLabel({ kind: 'google', family: 'Inter' })).toBe('Inter');
    expect(fontLabel({ kind: 'local', postscriptName: 'Arial-Regular', family: 'Arial' })).toBe('Arial');
  });

  it('lists the standard fonts with their labels', () => {
    expect(STANDARD_FONTS).toEqual([
      { id: 'helvetica', label: 'Helvetica' },
      { id: 'times', label: 'Times' },
    ]);
  });
});

describe('fontRefKey', () => {
  it('builds a distinct key per kind', () => {
    expect(fontRefKey({ kind: 'standard', id: 'helvetica' })).toBe('standard:helvetica');
    expect(fontRefKey({ kind: 'bundled', id: 'lato' })).toBe('bundled:lato');
    expect(fontRefKey({ kind: 'google', family: 'Lora' })).toBe('google:Lora');
    expect(fontRefKey({ kind: 'local', postscriptName: 'ArialMT', family: 'Arial' })).toBe('local:ArialMT');
  });
});

describe('faceKey', () => {
  it('names each face', () => {
    expect(faceKey({ bold: false, italic: false })).toBe('regular');
    expect(faceKey({ bold: true, italic: false })).toBe('bold');
    expect(faceKey({ bold: false, italic: true })).toBe('italic');
    expect(faceKey({ bold: true, italic: true })).toBe('bolditalic');
  });
});

describe('fontRefKey with a face', () => {
  it('appends the face when a style is given', () => {
    expect(fontRefKey({ kind: 'bundled', id: 'lato' }, { bold: true, italic: false })).toBe('bundled:lato:bold');
    expect(fontRefKey({ kind: 'google', family: 'Lora' }, { bold: false, italic: true })).toBe('google:Lora:italic');
    expect(fontRefKey({ kind: 'standard', id: 'times' }, { bold: true, italic: true })).toBe('standard:times:bolditalic');
    expect(fontRefKey({ kind: 'local', postscriptName: 'ArialMT', family: 'Arial' }, { bold: false, italic: false }))
      .toBe('local:ArialMT:regular');
  });

  it('leaves the key unchanged without a style', () => {
    expect(fontRefKey({ kind: 'bundled', id: 'lato' }, undefined)).toBe('bundled:lato');
  });
});

describe('pickFace', () => {
  const faces = { regular: 'r', bold: 'b', italic: 'i', boldItalic: 'bi' };

  it('picks the entry for each face', () => {
    expect(pickFace(faces, { bold: false, italic: false })).toBe('r');
    expect(pickFace(faces, { bold: true, italic: false })).toBe('b');
    expect(pickFace(faces, { bold: false, italic: true })).toBe('i');
    expect(pickFace(faces, { bold: true, italic: true })).toBe('bi');
  });

  it('returns undefined for a face that is missing, without falling back', () => {
    expect(pickFace({ regular: 'r' }, { bold: true, italic: false })).toBeUndefined();
    expect(pickFace({ regular: 'r', bold: 'b' }, { bold: true, italic: true })).toBeUndefined();
  });
});

describe('hasFace', () => {
  it('always has regular and otherwise follows the flags', () => {
    expect(hasFace(NO_FACES, { bold: false, italic: false })).toBe(true);
    expect(hasFace(NO_FACES, { bold: true, italic: false })).toBe(false);
    const some = { bold: true, italic: false, boldItalic: true };
    expect(hasFace(some, { bold: true, italic: false })).toBe(true);
    expect(hasFace(some, { bold: false, italic: true })).toBe(false);
    expect(hasFace(some, { bold: true, italic: true })).toBe(true);
  });
});

describe('face constants', () => {
  it('labels each face', () => {
    expect(FACE_LABELS).toEqual({ regular: 'Regular', bold: 'Bold', italic: 'Italic', bolditalic: 'Bold Italic' });
  });

  it('reports no faces beyond regular and cannot be changed', () => {
    expect(NO_FACES).toEqual({ bold: false, italic: false, boldItalic: false });
    expect(Object.isFrozen(NO_FACES)).toBe(true);
  });
});
