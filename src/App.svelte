<script lang="ts">
  import { onMount } from 'svelte';
  import { loadProfile, saveProfile, type Profile } from './lib/store/profile';
  import { applyTheme, watchSystemTheme } from './lib/store/theme';
  import { reconcileColumns, type Setup } from './lib/setup/setup';
  import { createBrowserFontProvider } from './lib/fonts/loader';
  import type { Dataset } from './lib/sheet/import';
  import SheetBar from './ui/SheetBar.svelte';
  import PageCard from './ui/PageCard.svelte';
  import PreviewPane from './ui/PreviewPane.svelte';
  import ThemeToggle from './ui/ThemeToggle.svelte';
  import SettingsBackup from './ui/SettingsBackup.svelte';
  import AboutDialog from './ui/AboutDialog.svelte';
  import Coffee from '@lucide/svelte/icons/coffee';
  import Mail from '@lucide/svelte/icons/mail';
  import ArrowRight from '@lucide/svelte/icons/arrow-right';
  import Info from '@lucide/svelte/icons/info';

  let profile = $state<Profile>(loadProfile());
  // The spreadsheet lives only for this session (spec: the data never persists).
  let dataset = $state.raw<Dataset | null>(null);
  // One provider for the session so fonts load once.
  const fonts = createBrowserFontProvider();
  let about = $state<ReturnType<typeof AboutDialog>>();
  const openAbout = (e: MouseEvent) => about?.open(e.currentTarget as HTMLElement);

  $effect(() => {
    saveProfile(profile);
    applyTheme(profile.theme);
  });

  onMount(() => watchSystemTheme(() => profile.theme));

  function setSetup(setup: Setup) {
    profile = { ...profile, setup };
  }

  /** A new or edited spreadsheet: fit the column setups to its columns (unknown ids drop, new ones get defaults). */
  function onDataset(ds: Dataset | null) {
    dataset = ds;
    if (!ds) return;
    const next = reconcileColumns(profile.setup, ds.columns);
    if (next !== profile.setup) setSetup(next);
  }
</script>

<main>
  <header class="masthead rise" style="--i: 0">
    <div class="brand">
      <!-- Placeholder monogram: a printed sheet with a coral header row. -->
      <svg class="monogram" viewBox="0 0 44 44" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linejoin="round" aria-hidden="true">
        <rect x="8" y="4" width="28" height="36" rx="3" />
        <path class="accent" d="M13 12h18" />
        <path d="M13 19h18M13 25h18M13 31h18M20 16v18" />
      </svg>
      <div class="brand-text">
        <h1>Hard Copy</h1>
        <p class="tagline">Print spreadsheets the way you want them.</p>
      </div>
    </div>
    <div class="tools">
      <button type="button" class="about-btn" aria-label="About" onclick={openAbout}>
        <Info size={18} aria-hidden="true" /><span class="label">About</span>
      </button>
      <SettingsBackup {profile} onimport={(p) => (profile = p)} />
      <ThemeToggle pref={profile.theme} onchange={(t) => (profile = { ...profile, theme: t })} />
    </div>
  </header>

  <SheetBar {dataset} onchange={onDataset} />

  <!-- DOM order is preview, then settings: the visual order at medium and narrow widths. -->
  <section class="workspace" aria-label="Print setup and preview">
    <PreviewPane {dataset} setup={profile.setup} {fonts} />
    <div class="settings">
      <PageCard setup={profile.setup} onchange={setSetup} />
    </div>
  </section>

  <footer class="footnote">
    <div class="footnote-links">
      <button type="button" class="text-link" onclick={openAbout}>About Hard Copy</button>
      <a class="coffee" href="https://buymeacoffee.com/madebyaaron" target="_blank" rel="noopener">
        <Coffee size={18} aria-hidden="true" />
        Support my experiments
      </a>
    </div>
    <!-- Cross-promo for the sibling tool. Shared .promo-card styles live in app.css. -->
    <a class="promo-card" href="https://labs.aaronjellis.com/letter-rip/">
      <span class="promo-icon"><Mail size={18} aria-hidden="true" /></span>
      <span class="promo-text">
        <span class="promo-title">Need to print envelopes?</span>
        <span class="promo-sub">Try Letter Rip, my envelope printing utility.</span>
      </span>
      <ArrowRight size={18} aria-hidden="true" class="promo-arrow" />
    </a>
  </footer>

  <AboutDialog bind:this={about} />
</main>

<style>
  .masthead {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px 24px;
    flex-wrap: wrap;
    margin-bottom: 32px;
  }
  .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .brand-text { display: grid; gap: 2px; min-width: 0; }
  .tagline { margin: 0; font-size: 13px; line-height: 1.3; color: var(--muted); }
  /* Two-color line sheet: page and grid in ink, the header row in coral. */
  .monogram { flex: none; width: 44px; height: 44px; color: var(--text); }
  .monogram .accent { stroke: var(--coral-icon); stroke-width: 3; }
  /* Wordmark: Clash Display 600. */
  h1 { margin: 0; font-size: 28px; font-weight: 600; line-height: 1.1; letter-spacing: -0.01em; }
  .tools { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

  /* Header actions: quiet ghost pills. */
  .about-btn,
  .tools :global(.backup button) {
    min-height: 40px;
    padding: 0 14px;
    background: transparent;
    border-color: transparent;
    color: var(--text);
  }
  .about-btn:hover:not(:disabled),
  .tools :global(.backup button:hover:not(:disabled)) { background: var(--subtle); border-color: transparent; }
  :global(:root[data-theme='dark']) .about-btn:hover:not(:disabled),
  :global(:root[data-theme='dark']) .tools :global(.backup button:hover:not(:disabled)) { background: var(--hover); }

  /*
   * Three tiers. Medium and narrow: the preview full width on top, the settings cards below.
   * Wide: settings left (5fr), a sticky preview right (7fr); reading-flow (in app.css) makes focus
   * follow the columns.
   */
  .workspace { display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; align-items: start; min-width: 0; }
  .settings { display: grid; gap: 20px; min-width: 0; align-content: start; }
  @media (min-width: 1180px) {
    .workspace { grid-template-columns: minmax(380px, 5fr) minmax(520px, 7fr); gap: 32px; }
    .workspace > :global(.preview) { grid-column: 2; grid-row: 1; position: sticky; top: 24px; }
    .settings { grid-column: 1; grid-row: 1; --pad: 24px; }
  }

  .footnote {
    margin-top: 48px;
    padding-top: 24px;
    border-top: 1px solid var(--divider);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 16px;
  }
  /* Support link: quiet outlined pill in the app's own system, no third-party script. */
  .coffee {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    padding: 0 16px;
    border: 1px solid color-mix(in srgb, var(--text) 25%, transparent);
    border-radius: 999px;
    color: var(--text);
    font-size: 14px;
    font-weight: 500;
    text-decoration: none;
    transition: background 120ms ease, border-color 120ms ease;
  }
  .coffee:hover { background: var(--subtle); }
  .coffee:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
  .coffee :global(.lucide) { color: var(--coral-icon); }
  .footnote-links { display: flex; align-items: center; gap: 8px 16px; flex-wrap: wrap; }
  /* Opens the About dialog: a plain text link, not another pill. */
  .text-link {
    min-height: 40px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted);
    font-size: 14px;
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .text-link:hover:not(:disabled) { background: none; color: var(--text); }

  @media (max-width: 760px) {
    .masthead { margin-bottom: 24px; }
    h1 { font-size: 24px; }
    .monogram { width: 36px; height: 36px; }
    .tools { width: calc(100% + 16px); margin: 0 -8px; gap: 0; }
    .tools :global(.backup) { gap: 0; }
    .about-btn,
    .tools :global(.backup button) { padding: 0 8px; }
  }
  @media (max-width: 480px) {
    .about-btn { width: 40px; padding: 0; }
    .about-btn .label { display: none; }
  }
</style>
