<script lang="ts">
  import type { ThemePreference } from '../lib/store/profile';
  import { nextThemePreference, themeLabel } from '../lib/store/theme';
  import Monitor from '@lucide/svelte/icons/monitor';
  import Sun from '@lucide/svelte/icons/sun';
  import Moon from '@lucide/svelte/icons/moon';

  let { pref, onchange }: { pref: ThemePreference; onchange: (p: ThemePreference) => void } = $props();
</script>

<button type="button" class="theme" onclick={() => onchange(nextThemePreference(pref))}
  aria-label={themeLabel(pref)} title="{themeLabel(pref)}. Click to switch.">
  {#if pref === 'light'}<Sun size={20} aria-hidden="true" />{:else if pref === 'dark'}<Moon size={20} aria-hidden="true" />{:else}<Monitor size={20} aria-hidden="true" />{/if}
  <span class="sr-only">{themeLabel(pref)}</span>
</button>

<style>
  .theme { width: 40px; min-height: 40px; padding: 0; border-radius: 50%; border-color: var(--divider); }
  .theme:hover:not(:disabled) { border-color: var(--text); }
</style>
