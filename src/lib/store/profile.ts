import { defaultSetup, parseSetup, type Setup } from '../setup/setup';

export type ThemePreference = 'system' | 'light' | 'dark';

export const PROFILE_VERSION = 1;

/** Settings kept on this device and in exported setup files: the print setup and the theme. */
export type Profile = {
  version: typeof PROFILE_VERSION;
  setup: Setup;
  theme: ThemePreference;
};

export const PROFILE_KEY = 'hardcopy.profile';

const NOT_A_SETUP_FILE = 'That is not a setup file exported by Hard Copy.';

export function defaultProfile(): Profile {
  return { version: PROFILE_VERSION, setup: defaultSetup(), theme: 'system' };
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
  const version = own(data, 'version');
  if (version !== PROFILE_VERSION) {
    throw new Error(`Unsupported setup file version: ${String(version)}`);
  }
  const theme = own(data, 'theme');
  return {
    version: PROFILE_VERSION,
    setup: parseSetup(own(data, 'setup')),
    theme: theme === 'light' || theme === 'dark' ? theme : 'system',
  };
}

/** An own property only, so inherited members never leak in. */
function own(o: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(o, key) ? o[key] : undefined;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
