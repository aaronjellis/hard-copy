export type ThemePreference = 'system' | 'light' | 'dark';

export const PROFILE_VERSION = 1;

/** Settings kept on this device and in exported setup files. Print settings join in a later version. */
export type Profile = {
  version: typeof PROFILE_VERSION;
  theme: ThemePreference;
};

export const PROFILE_KEY = 'hardcopy.profile';

export const FONT_SIZE_MIN = 6;
export const FONT_SIZE_MAX = 72;

const NOT_A_SETUP_FILE = 'That is not a setup file exported by Hard Copy.';

/** Clamp a font size into [FONT_SIZE_MIN, FONT_SIZE_MAX]; non-finite or non-number values yield `fallback`. */
export function clampFontSize(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, value));
}

export function defaultProfile(): Profile {
  return { version: PROFILE_VERSION, theme: 'system' };
}

export function loadProfile(storage?: Storage): Profile {
  try {
    const store = storage ?? globalThis.localStorage;
    const raw = store.getItem(PROFILE_KEY);
    if (raw === null) return defaultProfile();
    return parseProfile(raw);
  } catch {
    // Storage can throw (for example SecurityError when site data is blocked), and stored data can be corrupt.
    return defaultProfile();
  }
}

export function saveProfile(profile: Profile, storage?: Storage): void {
  try {
    (storage ?? globalThis.localStorage).setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Persistence is best-effort: blocked or full storage must not break the app.
  }
}

export function serializeProfile(profile: Profile): string {
  return JSON.stringify(profile, null, 2);
}

/**
 * Parse a setup file (or stored profile). Missing or invalid fields fall back to defaults one at a time.
 * @throws Error with a message ready to show the user when the text isn't a setup file or has an unsupported version.
 */
export function parseProfile(text: string): Profile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(NOT_A_SETUP_FILE);
  }
  if (!isObj(data)) throw new Error(NOT_A_SETUP_FILE);
  if (data.version !== PROFILE_VERSION) {
    throw new Error(`Unsupported setup file version: ${String(data.version)}`);
  }
  return {
    version: PROFILE_VERSION,
    theme: data.theme === 'light' || data.theme === 'dark' ? data.theme : 'system',
  };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
