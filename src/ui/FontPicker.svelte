<script lang="ts">
  import { tick } from 'svelte';
  import { errorMessage } from '../lib/errors';
  import { BUNDLED_FONTS, bundledFontRef, type BundledFontCategory } from '../lib/fonts/catalog';
  import { getGoogleFontsApiKey, loadGoogleCatalogOnce, type GoogleFont } from '../lib/fonts/google';
  import { isLocalFontsSupported, loadLocalFontsOnce, type LocalFont } from '../lib/fonts/local';
  import { loadFontBytes } from '../lib/fonts/loader';
  import { fontLabel, fontRefKey, STANDARD_FONTS, type FontRef } from '../lib/fonts/types';
  import Type from '@lucide/svelte/icons/type';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Square from '@lucide/svelte/icons/square';
  import Package from '@lucide/svelte/icons/package';
  import Globe from '@lucide/svelte/icons/globe';
  import MonitorSmartphone from '@lucide/svelte/icons/monitor-smartphone';
  import Search from '@lucide/svelte/icons/search';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import Check from '@lucide/svelte/icons/check';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import X from '@lucide/svelte/icons/x';

  let { value, onchange, label, compact = false }: {
    value: FontRef;
    onchange: (ref: FontRef) => void;
    label: string;
    /** Toolbar form: a small pill trigger, a visually hidden label, and the panel as a popover. */
    compact?: boolean;
  } = $props();

  const id = $props.id();
  const MAX_GOOGLE_RESULTS = 50;
  const googleEnabled = getGoogleFontsApiKey() !== '';
  const localSupported = isLocalFontsSupported();

  const CATEGORY_LABELS: Record<BundledFontCategory, string> = {
    sans: 'Sans serif',
    serif: 'Serif',
    display: 'Display',
    script: 'Script',
  };
  const bundledGroups = (Object.keys(CATEGORY_LABELS) as BundledFontCategory[])
    .map((category) => ({ category, fonts: BUNDLED_FONTS.filter((f) => f.category === category) }))
    .filter((g) => g.fonts.length > 0);

  let open = $state(false);
  let root = $state<HTMLDivElement>();
  let trigger = $state<HTMLButtonElement>();

  // Selection state: the font being loaded, and the last load error.
  let pending = $state<FontRef | null>(null);
  let selectError = $state('');
  let selectToken = 0;

  let googleQuery = $state('');
  let googleFonts = $state<GoogleFont[] | null>(null);
  let googleLoading = $state(false);
  let googleError = $state('');

  let localFonts = $state<LocalFont[] | null>(null);
  let localLoading = $state(false);
  let localError = $state('');

  const googleMatches = $derived.by(() => {
    if (!googleFonts) return [];
    const q = googleQuery.trim().toLowerCase();
    const matches = q === '' ? googleFonts : googleFonts.filter((f) => f.family.toLowerCase().includes(q));
    return matches.slice(0, MAX_GOOGLE_RESULTS);
  });

  function isCurrent(ref: FontRef): boolean {
    return fontRefKey(ref) === fontRefKey(value);
  }

  function toggle() {
    open = !open;
    if (open && googleEnabled && !googleFonts) void fetchGoogle();
  }

  /** Close the panel and return focus to the trigger; does nothing when already closed. */
  async function close() {
    if (!open) return;
    open = false;
    await tick();
    trigger?.focus();
  }

  function onWindowKeydown(e: KeyboardEvent) {
    if (!open || e.key !== 'Escape') return;
    if (root && e.target instanceof Node && root.contains(e.target)) {
      e.preventDefault();
      void close();
    }
  }

  /** True for a node outside the picker; null and non-nodes are not "outside". */
  function isOutside(target: EventTarget | null): boolean {
    return !!root && target instanceof Node && !root.contains(target);
  }

  // The compact popover closes when focus or a pointer press leaves it, without moving focus.
  function onFocusOut(e: FocusEvent) {
    if (compact && open && isOutside(e.relatedTarget)) open = false;
  }

  function onWindowPointerDown(e: PointerEvent) {
    if (compact && open && isOutside(e.target)) open = false;
  }

  /** Enter in the search field filters; it must not submit a surrounding form (which prints). */
  function onSearchKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') e.preventDefault();
  }

  async function fetchGoogle() {
    googleLoading = true;
    googleError = '';
    try {
      googleFonts = await loadGoogleCatalogOnce();
    } catch (err) {
      googleError = errorMessage(err);
    } finally {
      googleLoading = false;
    }
  }

  async function fetchLocal() {
    localLoading = true;
    localError = '';
    try {
      localFonts = await loadLocalFontsOnce();
    } catch (err) {
      localError = errorMessage(err);
    } finally {
      localLoading = false;
    }
  }

  /**
   * Load the font first so failures show here; on error the previous font stays selected
   * and focus stays on the chosen button. A load that finishes after the panel was closed
   * applies the font without moving focus.
   */
  async function select(ref: FontRef) {
    if (pending) return;
    const token = ++selectToken;
    pending = ref;
    selectError = '';
    try {
      await loadFontBytes(ref);
      if (token !== selectToken) return;
      onchange(ref);
      if (open) await close();
    } catch (err) {
      if (token !== selectToken) return;
      selectError = errorMessage(err);
    } finally {
      if (token === selectToken) pending = null;
    }
  }
</script>

<svelte:window onkeydown={onWindowKeydown} onpointerdown={onWindowPointerDown} />

<div class="font-picker" class:compact bind:this={root} onfocusout={onFocusOut}>
  {#if compact}
    <span class="sr-only" id="{id}-label">{label}</span>
  {:else}
    <span class="label" id="{id}-label"><Type size={16} aria-hidden="true" />{label}</span>
  {/if}
  <button type="button" class="trigger" bind:this={trigger}
    aria-expanded={open} aria-controls="{id}-panel" aria-labelledby="{id}-label {id}-value"
    title={compact ? label : undefined} onclick={toggle}>
    {#if compact}<Type size={16} aria-hidden="true" />{/if}
    <span class="value" id="{id}-value">{fontLabel(value)}</span>
    <span class="caret" class:open>
      {#if compact && pending}<LoaderCircle class="spin" size={16} aria-hidden="true" />{:else}<ChevronDown size={compact ? 16 : 20} aria-hidden="true" />{/if}
    </span>
  </button>

  <!-- In the compact form the spinner in the trigger shows progress; the text is for screen readers. -->
  <div class="status" class:sr-only={compact} aria-live="polite">
    {#if pending}
      <p class="muted status-line"><LoaderCircle class="spin" size={16} aria-hidden="true" />Loading {fontLabel(pending)}…</p>
    {/if}
  </div>
  {#if selectError && !(compact && open)}<p class="error status-line" role="alert"><CircleAlert size={16} aria-hidden="true" /><span>{selectError}</span></p>{/if}

  {#if open}
    <div class="panel" id="{id}-panel" role="group" aria-labelledby="{id}-label">
      {#if compact && selectError}<p class="error status-line panel-error" role="alert"><CircleAlert size={16} aria-hidden="true" /><span>{selectError}</span></p>{/if}
      <section>
        <h4><Square size={14} aria-hidden="true" />Standard</h4>
        <ul>
          {#each STANDARD_FONTS as f (f.id)}
            {@const ref: FontRef = { kind: 'standard', id: f.id }}
            <li><button type="button" aria-current={isCurrent(ref)} aria-disabled={pending !== null}
              onclick={() => select(ref)}><span>{f.label}</span>{#if isCurrent(ref)}<Check class="check" size={18} aria-hidden="true" />{/if}</button></li>
          {/each}
        </ul>
      </section>

      <section>
        <h4><Package size={14} aria-hidden="true" />Bundled</h4>
        {#each bundledGroups as g (g.category)}
          <h5>{CATEGORY_LABELS[g.category]}</h5>
          <ul>
            {#each g.fonts as f (f.id)}
              {@const ref = bundledFontRef(f)}
              <li><button type="button" aria-current={isCurrent(ref)} aria-disabled={pending !== null}
                onclick={() => select(ref)}><span>{f.family}</span>{#if isCurrent(ref)}<Check class="check" size={18} aria-hidden="true" />{/if}</button></li>
            {/each}
          </ul>
        {/each}
      </section>

      {#if googleEnabled}
        <section>
          <h4><Globe size={14} aria-hidden="true" />Google Fonts</h4>
          <label class="sr-only" for="{id}-google">Search Google Fonts</label>
          <div class="search">
            <Search size={18} aria-hidden="true" />
            <input id="{id}-google" type="search" placeholder="Search Google Fonts"
              bind:value={googleQuery} autocomplete="off" onkeydown={onSearchKeydown} />
          </div>
          {#if googleLoading}
            <p class="muted status-line"><LoaderCircle class="spin" size={16} aria-hidden="true" />Loading Google Fonts…</p>
          {:else if googleError}
            <p class="error status-line"><CircleAlert size={16} aria-hidden="true" /><span>{googleError}</span></p>
            <button type="button" onclick={fetchGoogle}><RotateCcw size={18} aria-hidden="true" />Try again</button>
          {:else if googleFonts}
            {#if googleMatches.length === 0}
              <p class="muted">No matching fonts.</p>
            {:else}
              <ul class="scroll">
                {#each googleMatches as f (f.family)}
                  {@const ref: FontRef = { kind: 'google', family: f.family }}
                  <li><button type="button" aria-current={isCurrent(ref)} aria-disabled={pending !== null}
                    onclick={() => select(ref)}><span>{f.family}</span>{#if isCurrent(ref)}<Check class="check" size={18} aria-hidden="true" />{/if}</button></li>
                {/each}
              </ul>
            {/if}
          {/if}
        </section>
      {/if}

      {#if localSupported}
        <section>
          <h4><MonitorSmartphone size={14} aria-hidden="true" />Installed on this device</h4>
          {#if localFonts === null || localFonts.length === 0}
            {#if localFonts?.length === 0 && !localLoading}
              <p class="muted">No installed fonts were found. If you declined the permission prompt, allow font access for this site and try again.</p>
            {/if}
            <button type="button" onclick={fetchLocal} disabled={localLoading}>
              {#if localLoading}<LoaderCircle class="spin" size={18} aria-hidden="true" />{:else}<MonitorSmartphone size={18} aria-hidden="true" />{/if}
              {localLoading ? 'Loading installed fonts…' : localFonts === null ? 'Load installed fonts' : 'Try again'}
            </button>
          {:else}
            <ul class="scroll">
              {#each localFonts as f (f.postscriptName)}
                {@const ref: FontRef = { kind: 'local', postscriptName: f.postscriptName, family: f.family }}
                <li><button type="button" aria-current={isCurrent(ref)} aria-disabled={pending !== null}
                  onclick={() => select(ref)}><span>{f.family}</span>{#if isCurrent(ref)}<Check class="check" size={18} aria-hidden="true" />{/if}</button></li>
              {/each}
            </ul>
          {/if}
          {#if localError}<p class="error status-line"><CircleAlert size={16} aria-hidden="true" /><span>{localError}</span></p>{/if}
        </section>
      {/if}

      <button type="button" class="close" onclick={close}><X size={18} aria-hidden="true" />Close</button>
    </div>
  {/if}
</div>

<style>
  .label { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; font-size: 14px; font-weight: 500; }
  .label :global(.lucide) { color: var(--muted); }
  .trigger {
    width: 100%;
    min-height: 48px;
    justify-content: space-between;
    gap: 8px;
    padding: 0 14px;
    font-size: 15px;
    font-weight: 400;
    text-align: left;
    background: var(--field);
    border-radius: var(--radius);
  }
  .trigger[aria-expanded='true'] { border-color: var(--text); box-shadow: inset 0 0 0 1px var(--text); }
  .caret { display: inline-flex; flex: none; transition: transform 120ms ease; }
  .caret.open { transform: rotate(180deg); }
  .status p, .error { margin: 6px 0 0; font-size: 14px; }
  .panel {
    margin-top: 8px;
    padding: 8px;
    max-height: 420px;
    overflow-y: auto;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    box-shadow: var(--shadow-float);
  }
  section { padding: 0 4px; }
  section + section { border-top: 1px solid var(--divider); margin-top: 8px; padding-top: 4px; }
  h4 {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 12px 8px 6px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  h5 { margin: 10px 8px 4px; font-size: 13px; font-weight: 500; color: var(--muted); }
  ul { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 2px; }
  ul.scroll { max-height: 200px; overflow-y: auto; margin-top: 8px; }
  li button {
    width: 100%;
    min-height: 40px;
    justify-content: flex-start;
    padding: 0 12px;
    text-align: left;
    font-size: 15px;
    font-weight: 400;
    border-color: transparent;
    border-radius: var(--radius-sm);
    background: transparent;
  }
  li button:hover:not([aria-disabled='true']) { border-color: transparent; background: var(--hover); }
  li button[aria-disabled='true'] { opacity: 0.5; cursor: not-allowed; }
  li button span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  li button :global(.check) { margin-left: auto; color: var(--coral-icon); }
  li button[aria-current='true'],
  li button[aria-current='true']:hover:not([aria-disabled='true']) {
    background: var(--coral-wash);
    font-weight: 600;
  }
  .search { position: relative; }

  /* Compact (toolbar) form. The panel is positioned against the nearest positioned ancestor,
     the toolbar, so it spans the toolbar's width and floats over the content below. */
  .compact { min-width: 0; }
  .compact .trigger {
    width: auto;
    max-width: 200px;
    min-height: 38px;
    gap: 6px;
    padding: 0 10px 0 12px;
    font-size: 14px;
    font-weight: 500;
    border-radius: 9999px;
  }
  .compact .trigger :global(.lucide-type) { color: var(--muted); }
  .compact .value { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .compact .panel { position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 20; margin: 0; }
  .compact > .error { margin: 6px 0 0; max-width: 240px; }
  .panel-error { margin: 8px 8px 4px; }
  .search :global(.lucide-search) { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--muted); pointer-events: none; }
  input[type='search'] { width: 100%; padding-left: 42px; }
  .close { margin: 12px 4px 4px; }
</style>
