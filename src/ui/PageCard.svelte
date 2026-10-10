<script lang="ts">
  import {
    CUSTOM_PAPER_MAX_IN, CUSTOM_PAPER_MIN_IN, PAPER_IDS, PAPER_SIZES, clampCustomInches, marginPresetOf, marginsForPreset,
    type Margins, type MarginPreset, type PaperId,
  } from '../lib/setup/paper';
  import { SETUP_LIMITS, type PageOrder, type PageSetup, type Scale, type Setup } from '../lib/setup/setup';
  import FileText from '@lucide/svelte/icons/file-text';
  import RectangleVertical from '@lucide/svelte/icons/rectangle-vertical';
  import RectangleHorizontal from '@lucide/svelte/icons/rectangle-horizontal';
  import Ruler from '@lucide/svelte/icons/ruler';

  /* The Page card: paper, orientation, margins, scale, header repeat, gridlines, page order. */
  let { setup, onchange }: { setup: Setup; onchange: (s: Setup) => void } = $props();

  const id = $props.id();
  const page = $derived(setup.page);

  const MM_PER_IN = 25.4;
  const METRIC: ReadonlySet<PaperId> = new Set(['a4', 'a3']);
  const fmt = (n: number) => String(Number(n.toFixed(2)));

  function paperLabel(pid: PaperId): string {
    if (pid === 'custom') return 'Custom…';
    const s = PAPER_SIZES[pid];
    const dims = METRIC.has(pid)
      ? `${Math.round(s.widthIn * MM_PER_IN)} × ${Math.round(s.heightIn * MM_PER_IN)} mm`
      : `${fmt(s.widthIn)} × ${fmt(s.heightIn)} in`;
    return `${s.label} · ${dims}`;
  }

  function set(patch: Partial<PageSetup>) {
    onchange({ ...setup, page: { ...setup.page, ...patch } });
  }

  // --- Custom paper: entry unit only; the setup always stores inches. ---
  let unit = $state<'in' | 'mm'>('in');
  const toDisplay = (inches: number) =>
    unit === 'mm' ? Math.round(inches * MM_PER_IN * 10) / 10 : Math.round(inches * 1000) / 1000;
  const toInches = (value: number) => (unit === 'mm' ? value / MM_PER_IN : value);
  const paperHint = $derived(
    unit === 'in'
      ? `${CUSTOM_PAPER_MIN_IN}–${CUSTOM_PAPER_MAX_IN} in`
      : `${toDisplay(CUSTOM_PAPER_MIN_IN)}–${toDisplay(CUSTOM_PAPER_MAX_IN)} mm`,
  );

  // `change` on a number input fires on blur or Enter, so clamping happens there.
  function onPaperSide(key: 'customWidthIn' | 'customHeightIn', e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const raw = input.valueAsNumber;
    const next = Number.isFinite(raw) ? clampCustomInches(toInches(raw)) : page[key];
    // Show the clamped value even when the setting does not change (no re-render then).
    input.value = String(toDisplay(next));
    set({ [key]: next });
  }

  // --- Margins: a preset, or four custom values. Custom stays chosen even when the values match a preset. ---
  let customChosen = $state(false);
  const presetNow = $derived(marginPresetOf(page.margins));
  const marginMode = $derived<MarginPreset | 'custom'>(customChosen ? 'custom' : presetNow);
  const MARGIN_CHOICES: { value: MarginPreset | 'custom'; label: string }[] = [
    { value: 'narrow', label: 'Narrow' },
    { value: 'normal', label: 'Normal' },
    { value: 'wide', label: 'Wide' },
    { value: 'custom', label: 'Custom' },
  ];
  const SIDES: { key: keyof Margins; label: string }[] = [
    { key: 'top', label: 'Top' },
    { key: 'right', label: 'Right' },
    { key: 'bottom', label: 'Bottom' },
    { key: 'left', label: 'Left' },
  ];

  function chooseMargins(value: MarginPreset | 'custom') {
    if (value === 'custom') {
      customChosen = true;
      return;
    }
    customChosen = false;
    set({ margins: marginsForPreset(value) });
  }

  function clamp(v: number, [min, max]: readonly [number, number]) {
    return Math.min(max, Math.max(min, v));
  }

  function onMargin(side: keyof Margins, e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const raw = input.valueAsNumber;
    const next = Number.isFinite(raw) ? Math.round(clamp(raw, SETUP_LIMITS.marginIn) * 100) / 100 : page.margins[side];
    input.value = String(next);
    set({ margins: { ...page.margins, [side]: next } });
  }

  // --- Scale: remember the last pages and percent so switching modes back and forth keeps them. ---
  let lastPages = $state({ wide: 1, tall: 1 });
  let lastPercent = $state(100);
  $effect(() => {
    const s = page.scale;
    if (s.mode === 'fitPages') lastPages = { wide: s.wide, tall: s.tall };
    else if (s.mode === 'percent') lastPercent = s.value;
  });
  const SCALE_CHOICES: { value: Scale['mode']; label: string }[] = [
    { value: 'fitWidth', label: 'Fit to width' },
    { value: 'fitPages', label: 'Fit to pages' },
    { value: 'percent', label: 'Scale %' },
  ];

  function chooseScale(mode: Scale['mode']) {
    if (mode === page.scale.mode) return;
    if (mode === 'fitWidth') set({ scale: { mode } });
    else if (mode === 'fitPages') set({ scale: { mode, ...lastPages } });
    else set({ scale: { mode, value: lastPercent } });
  }

  function onPages(key: 'wide' | 'tall', e: Event) {
    if (page.scale.mode !== 'fitPages') return;
    const input = e.currentTarget as HTMLInputElement;
    const raw = input.valueAsNumber;
    const next = Number.isFinite(raw) ? Math.round(clamp(raw, SETUP_LIMITS.fitPages)) : page.scale[key];
    input.value = String(next);
    set({ scale: { ...page.scale, [key]: next } });
  }

  function onPercent(e: Event) {
    if (page.scale.mode !== 'percent') return;
    const input = e.currentTarget as HTMLInputElement;
    const raw = input.valueAsNumber;
    const next = Number.isFinite(raw) ? Math.round(clamp(raw, SETUP_LIMITS.scalePercent)) : page.scale.value;
    input.value = String(next);
    set({ scale: { mode: 'percent', value: next } });
  }
</script>

<section class="card page-card rise" style="--i: 3" aria-labelledby="{id}-title">
  <div class="title-line">
    <FileText size={20} aria-hidden="true" />
    <h2 id="{id}-title" class="card-title">Page</h2>
  </div>

  <div class="field paper">
    <label for="{id}-paper">Paper</label>
    <select id="{id}-paper" value={page.paper} onchange={(e) => set({ paper: e.currentTarget.value as PaperId })}>
      {#each PAPER_IDS as pid (pid)}<option value={pid}>{paperLabel(pid)}</option>{/each}
    </select>
  </div>

  {#if page.paper === 'custom'}
    <div class="custom-paper">
      <div class="field">
        <label for="{id}-pw">Width ({unit})</label>
        <input id="{id}-pw" type="number" inputmode="decimal" step="any"
          min={toDisplay(CUSTOM_PAPER_MIN_IN)} max={toDisplay(CUSTOM_PAPER_MAX_IN)}
          value={toDisplay(page.customWidthIn)} aria-describedby="{id}-paper-hint"
          onchange={(e) => onPaperSide('customWidthIn', e)} />
      </div>
      <div class="field">
        <label for="{id}-ph">Height ({unit})</label>
        <input id="{id}-ph" type="number" inputmode="decimal" step="any"
          min={toDisplay(CUSTOM_PAPER_MIN_IN)} max={toDisplay(CUSTOM_PAPER_MAX_IN)}
          value={toDisplay(page.customHeightIn)} aria-describedby="{id}-paper-hint"
          onchange={(e) => onPaperSide('customHeightIn', e)} />
      </div>
      <div class="segmented units" role="group" aria-label="Units">
        <button type="button" aria-pressed={unit === 'in'} onclick={() => (unit = 'in')}>in</button>
        <button type="button" aria-pressed={unit === 'mm'} onclick={() => (unit = 'mm')}>mm</button>
      </div>
      <p id="{id}-paper-hint" class="muted hint"><Ruler size={16} aria-hidden="true" />Each side {paperHint}, before turning.</p>
    </div>
  {/if}

  <div class="field">
    <span class="field-label" id="{id}-orient">Orientation</span>
    <div class="segmented fill" role="group" aria-labelledby="{id}-orient">
      <button type="button" aria-pressed={!page.landscape} onclick={() => set({ landscape: false })}>
        <RectangleVertical size={16} aria-hidden="true" />Portrait
      </button>
      <button type="button" aria-pressed={page.landscape} onclick={() => set({ landscape: true })}>
        <RectangleHorizontal size={16} aria-hidden="true" />Landscape
      </button>
    </div>
  </div>

  <div class="field">
    <span class="field-label" id="{id}-margins">Margins</span>
    <div class="segmented fill four" role="group" aria-labelledby="{id}-margins">
      {#each MARGIN_CHOICES as m (m.value)}
        <button type="button" aria-pressed={marginMode === m.value} onclick={() => chooseMargins(m.value)}>{m.label}</button>
      {/each}
    </div>
    {#if marginMode === 'custom'}
      <div class="sides">
        {#each SIDES as side (side.key)}
          <div class="field">
            <label for="{id}-m-{side.key}">{side.label} (in)</label>
            <input id="{id}-m-{side.key}" type="number" inputmode="decimal" step="0.05"
              min={SETUP_LIMITS.marginIn[0]} max={SETUP_LIMITS.marginIn[1]} value={page.margins[side.key]}
              onchange={(e) => onMargin(side.key, e)} />
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <div class="field">
    <span class="field-label" id="{id}-scale">Scale</span>
    <div class="segmented fill" role="group" aria-labelledby="{id}-scale">
      {#each SCALE_CHOICES as c (c.value)}
        <button type="button" aria-pressed={page.scale.mode === c.value} onclick={() => chooseScale(c.value)}>{c.label}</button>
      {/each}
    </div>
    {#if page.scale.mode === 'fitWidth'}
      <p class="muted hint">Shrinks the columns to fit across one page, never enlarges.</p>
    {:else if page.scale.mode === 'fitPages'}
      <div class="inline-fields">
        <input id="{id}-wide" class="small" type="number" inputmode="numeric" step="1"
          min={SETUP_LIMITS.fitPages[0]} max={SETUP_LIMITS.fitPages[1]} value={page.scale.wide}
          aria-label="Pages wide" onchange={(e) => onPages('wide', e)} />
        <span aria-hidden="true">wide ×</span>
        <input id="{id}-tall" class="small" type="number" inputmode="numeric" step="1"
          min={SETUP_LIMITS.fitPages[0]} max={SETUP_LIMITS.fitPages[1]} value={page.scale.tall}
          aria-label="Pages tall" onchange={(e) => onPages('tall', e)} />
        <span aria-hidden="true">tall</span>
      </div>
    {:else}
      <div class="inline-fields">
        <input id="{id}-pct" class="small" type="number" inputmode="numeric" step="5"
          min={SETUP_LIMITS.scalePercent[0]} max={SETUP_LIMITS.scalePercent[1]} value={page.scale.value}
          aria-label="Scale percent" aria-describedby="{id}-pct-hint" onchange={onPercent} />
        <span aria-hidden="true">%</span>
        <span id="{id}-pct-hint" class="muted range">{SETUP_LIMITS.scalePercent[0]}–{SETUP_LIMITS.scalePercent[1]}%</span>
      </div>
    {/if}
  </div>

  <div class="switches">
    <span class="toggle">
      <span id="{id}-repeat">Repeat header row on every page</span>
      <button type="button" class="switch" role="switch" aria-checked={page.repeatHeader} aria-labelledby="{id}-repeat"
        onclick={() => set({ repeatHeader: !page.repeatHeader })}></button>
    </span>
    <span class="toggle">
      <span id="{id}-grid">Gridlines</span>
      <button type="button" class="switch" role="switch" aria-checked={page.gridlines} aria-labelledby="{id}-grid"
        onclick={() => set({ gridlines: !page.gridlines })}></button>
    </span>
  </div>

  <div class="field order">
    <label for="{id}-order">Page order</label>
    <select id="{id}-order" value={page.order} aria-describedby="{id}-order-hint"
      onchange={(e) => set({ order: e.currentTarget.value as PageOrder })}>
      <option value="downThenOver">Down, then over</option>
      <option value="overThenDown">Over, then down</option>
    </select>
    <p id="{id}-order-hint" class="muted hint">When the sheet is more than one page wide.</p>
  </div>
</section>

<style>
  .card {
    display: grid;
    gap: 20px;
    min-width: 0;
    padding: var(--pad, 20px);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    box-shadow: var(--shadow-card);
    transition: box-shadow 120ms ease;
  }
  .card:hover { box-shadow: var(--shadow-card-hover); }

  .field { display: grid; gap: 8px; min-width: 0; align-content: start; }
  .field label, .field-label { display: block; margin: 0; font-size: 14px; font-weight: 500; color: var(--text); }
  select, input { width: 100%; min-width: 0; }

  .custom-paper { display: grid; grid-template-columns: 1fr 1fr auto; gap: 12px; align-items: end; }
  .custom-paper .units { height: 48px; align-items: center; }
  .custom-paper .hint { grid-column: 1 / -1; }
  .hint { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 14px; }

  /* A segmented row that spans the card; each choice takes an equal share. */
  .segmented.fill { display: flex; width: 100%; }
  .segmented.fill button { flex: 1 1 0; gap: 6px; min-width: 0; min-height: 40px; padding: 0 8px; white-space: nowrap; }

  .sides { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-top: 4px; }
  .sides input { padding: 12px 10px; }

  .inline-fields { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 10px; font-size: 14px; color: var(--text-soft); }
  .inline-fields input.small { width: 88px; }
  .range { font-size: 14px; }

  .switches { display: grid; gap: 4px; padding-top: 16px; border-top: 1px solid var(--divider); }
  .toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: 40px;
    font-size: 15px;
    color: var(--text);
  }

  .switch {
    position: relative;
    flex: none;
    width: 44px;
    min-height: 0;
    height: 26px;
    padding: 0;
    border: 0;
    border-radius: 9999px;
    background: var(--line-control);
    transition: background-color 120ms ease;
  }
  .switch:hover:not(:disabled) { background: var(--muted); border: 0; }
  .switch::after {
    content: '';
    position: absolute;
    top: 2px;
    left: 2px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #ffffff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
    transition: transform 120ms ease;
  }
  .switch[aria-checked='true'],
  .switch[aria-checked='true']:hover:not(:disabled) { background: var(--coral); }
  .switch[aria-checked='true']::after { transform: translateX(18px); }

  @media (max-width: 480px) {
    .custom-paper { grid-template-columns: 1fr 1fr; }
    .custom-paper .units { grid-column: 1 / -1; justify-self: start; }
    .sides { grid-template-columns: 1fr 1fr; }
  }
</style>
