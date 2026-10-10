import { describe, it, expect } from 'vitest';
import {
  defaultProfile, loadProfile, saveProfile, serializeProfile, parseProfile, PROFILE_KEY,
  clampFontSize, FONT_SIZE_MIN, FONT_SIZE_MAX,
  type Profile,
} from '../../src/lib/store/profile';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

describe('profile store', () => {
  it('uses its own storage key', () => {
    expect(PROFILE_KEY).toBe('hardcopy.profile');
  });

  it('loads defaults when nothing is stored', () => {
    const p = loadProfile(memoryStorage());
    expect(p).toEqual(defaultProfile());
    expect(p).toEqual({ version: 1, theme: 'system' });
  });

  it('round-trips through save and load', () => {
    const s = memoryStorage();
    const p: Profile = { ...defaultProfile(), theme: 'dark' };
    saveProfile(p, s);
    expect(s.getItem(PROFILE_KEY)).not.toBeNull();
    expect(loadProfile(s)).toEqual(p);
  });

  it('falls back to defaults on corrupt storage', () => {
    const s = memoryStorage();
    s.setItem(PROFILE_KEY, '{not json');
    expect(loadProfile(s)).toEqual(defaultProfile());
  });

  it('falls back to defaults when the stored version is unsupported', () => {
    const s = memoryStorage();
    s.setItem(PROFILE_KEY, JSON.stringify({ version: 99, theme: 'dark' }));
    expect(loadProfile(s)).toEqual(defaultProfile());
  });

  it('serializes to pretty JSON and parses back', () => {
    const p: Profile = { ...defaultProfile(), theme: 'light' };
    const text = serializeProfile(p);
    expect(text).toContain('\n');
    expect(parseProfile(text)).toEqual(p);
  });

  it('fills missing fields with defaults when parsing a partial file', () => {
    expect(parseProfile(JSON.stringify({ version: 1 }))).toEqual(defaultProfile());
  });

  it('falls back to system for an invalid theme', () => {
    expect(parseProfile(JSON.stringify({ version: 1, theme: 'sepia' })).theme).toBe('system');
    expect(parseProfile(JSON.stringify({ version: 1, theme: 1 })).theme).toBe('system');
  });

  it('drops unknown fields', () => {
    expect(parseProfile(JSON.stringify({ version: 1, theme: 'dark', extra: true }))).toEqual({ version: 1, theme: 'dark' });
  });

  it('rejects files with the wrong version or shape', () => {
    expect(() => parseProfile(JSON.stringify({ version: 2 }))).toThrow(/version/i);
    expect(() => parseProfile(JSON.stringify({ version: 0 }))).toThrow(/version/i);
    expect(() => parseProfile(JSON.stringify({}))).toThrow(/version/i);
    expect(() => parseProfile('[]')).toThrow(/setup file/i);
    expect(() => parseProfile('null')).toThrow(/setup file/i);
    expect(() => parseProfile('nope')).toThrow(/setup file/i);
  });

  it('clamps font sizes into the supported range', () => {
    expect(clampFontSize(NaN, 12)).toBe(12);
    expect(clampFontSize('14', 12)).toBe(12);
    expect(clampFontSize(1, 12)).toBe(FONT_SIZE_MIN);
    expect(clampFontSize(400, 12)).toBe(FONT_SIZE_MAX);
    expect(clampFontSize(18, 12)).toBe(18);
  });

  it('returns defaults when reading storage throws', () => {
    const s = { ...memoryStorage(), getItem: () => { throw new Error('SecurityError'); } } as Storage;
    expect(loadProfile(s)).toEqual(defaultProfile());
  });

  it('returns defaults when localStorage itself is unavailable', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('SecurityError'); } });
    try {
      expect(loadProfile()).toEqual(defaultProfile());
      expect(() => saveProfile(defaultProfile())).not.toThrow();
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
      else delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  });

  it('does not propagate errors from setItem', () => {
    const s = { ...memoryStorage(), setItem: () => { throw new Error('QuotaExceeded'); } } as Storage;
    expect(() => saveProfile(defaultProfile(), s)).not.toThrow();
  });
});
