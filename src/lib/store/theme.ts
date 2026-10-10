import type { ThemePreference } from './profile';

export type ResolvedTheme = 'light' | 'dark';

export function resolveTheme(pref: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (pref === 'system') return systemPrefersDark ? 'dark' : 'light';
  return pref;
}

export function nextThemePreference(pref: ThemePreference): ThemePreference {
  return pref === 'system' ? 'light' : pref === 'light' ? 'dark' : 'system';
}

export function themeLabel(pref: ThemePreference): string {
  return `Theme: ${pref === 'system' ? 'System' : pref === 'light' ? 'Light' : 'Dark'}`;
}

/** Browser-only: set data-theme on <html>. */
export function applyTheme(pref: ThemePreference): void {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = resolveTheme(pref, dark);
}

/** Browser-only: re-apply when the OS preference changes while pref is 'system'. Returns an unsubscribe. */
export function watchSystemTheme(getPref: () => ThemePreference): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => applyTheme(getPref());
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}
