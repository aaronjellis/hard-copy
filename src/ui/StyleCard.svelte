<script lang="ts">
  import { SETUP_LIMITS, clampStep, type Borders, type CellPadding, type Setup, type StyleSetup } from '../lib/setup/setup';
  import { styleSummary } from '../lib/setup/summary';
  import SetupCard from './SetupCard.svelte';
  import FontPicker from './FontPicker.svelte';
  import ColorField from './ColorField.svelte';
  import Palette from '@lucide/svelte/icons/palette';

  /* The Style card: font and size, header row, lead column, zebra stripes, padding, and borders. */
  let { setup, onchange, open = true }: { setup: Setup; onchange: (s: Setup) => void; open?: boolean } = $props();

  const id = $props.id();
  const style = $derived(setup.style);

  const PADDINGS: { value: CellPadding; label: string }[] = [
    { value: 'compact', label: 'Compact' },
    { value: 'normal', label: 'Normal' },
    { value: 'relaxed', label: 'Relaxed' },
  ];
  const BORDERS: { value: Borders; label: string }[] = [
    { value: 'hairline', label: 'Hairline' },
    { value: 'none', label: 'None' },
  ];

  function set(patch: Partial<StyleSetup>) {
    onchange({ ...setup, style: { ...setup.style, ...patch } });
  }

  function onSize(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const raw = input.valueAsNumber;
    const next = clampStep(raw, SETUP_LIMITS.bodySizePt, 0.5, style.bodySize);
    input.value = String(next);
    if (next !== style.bodySize) set({ bodySize: next });
  }
</script>

<SetupCard title="Style" icon={Palette} summary={styleSummary(setup)} {open} rise={5}>
  <div class="font-row">
    <div class="field">
      <span class="field-label" aria-hidden="true">Font</span>
      <FontPicker compact label="Font" value={style.font} onchange={(font) => set({ font })} />
    </div>
    <div class="field size">
      <label for="{id}-size">Size</label>
      <span class="with-unit">
        <input id="{id}-size" type="number" inputmode="decimal" step="0.5"
          min={SETUP_LIMITS.bodySizePt[0]} max={SETUP_LIMITS.bodySizePt[1]} value={style.bodySize}
          aria-describedby="{id}-size-unit" onchange={onSize} />
        <span id="{id}-size-unit" class="unit">pt</span>
      </span>
    </div>
  </div>

  <div class="sub" role="group" aria-labelledby="{id}-header">
    <h3 id="{id}-header" class="sub-title">Header row</h3>
    <span class="toggle">
      <span id="{id}-hbold">Bold</span>
      <button type="button" class="switch" role="switch" aria-checked={style.header.bold} aria-labelledby="{id}-header {id}-hbold"
        onclick={() => set({ header: { ...style.header, bold: !style.header.bold } })}></button>
    </span>
    <div class="colors">
      <ColorField label="Fill" nullable value={style.header.fill}
        onchange={(fill) => set({ header: { ...style.header, fill } })} />
      <ColorField label="Text" nullable start="#000000" value={style.header.color}
        onchange={(color) => set({ header: { ...style.header, color } })} />
    </div>
  </div>

  <div class="sub" role="group" aria-labelledby="{id}-lead">
    <h3 id="{id}-lead" class="sub-title">Lead column</h3>
    <span class="toggle">
      <span id="{id}-lbold">Bold</span>
      <button type="button" class="switch" role="switch" aria-checked={style.leadColumn.bold} aria-labelledby="{id}-lead {id}-lbold"
        onclick={() => set({ leadColumn: { ...style.leadColumn, bold: !style.leadColumn.bold } })}></button>
    </span>
    <div class="colors">
      <ColorField label="Fill" nullable value={style.leadColumn.fill}
        onchange={(fill) => set({ leadColumn: { ...style.leadColumn, fill } })} />
    </div>
  </div>

  <div class="sub" role="group" aria-labelledby="{id}-zebra">
    <div class="toggle">
      <h3 id="{id}-zebra" class="sub-title">Zebra stripes</h3>
      <button type="button" class="switch" role="switch" aria-checked={style.zebra.on} aria-labelledby="{id}-zebra"
        onclick={() => set({ zebra: { ...style.zebra, on: !style.zebra.on } })}></button>
    </div>
    {#if style.zebra.on}
      <div class="colors">
        <ColorField label="Stripe" value={style.zebra.color}
          onchange={(color) => color && set({ zebra: { ...style.zebra, color } })} />
      </div>
    {/if}
  </div>

  <div class="sub">
    <div class="field">
      <span class="field-label" id="{id}-pad">Cell padding</span>
      <div class="segmented fill" role="group" aria-labelledby="{id}-pad">
        {#each PADDINGS as p (p.value)}
          <button type="button" aria-pressed={style.padding === p.value} onclick={() => set({ padding: p.value })}>{p.label}</button>
        {/each}
      </div>
    </div>
    <div class="field">
      <span class="field-label" id="{id}-borders">Borders</span>
      <div class="borders">
        <div class="segmented" role="group" aria-labelledby="{id}-borders">
          {#each BORDERS as b (b.value)}
            <button type="button" aria-pressed={style.borders === b.value} onclick={() => set({ borders: b.value })}>{b.label}</button>
          {/each}
        </div>
        {#if style.borders !== 'none'}
          <ColorField label="Color" value={style.borderColor}
            onchange={(borderColor) => borderColor && set({ borderColor })} />
        {/if}
      </div>
    </div>
  </div>
</SetupCard>

<style>
  /* The compact font panel spans this row (its nearest positioned ancestor) and floats below it. */
  .font-row { position: relative; display: flex; flex-wrap: wrap; align-items: end; gap: 12px 24px; min-width: 0; }
  .font-row > .field:first-child { flex: 0 1 auto; min-width: 0; }
  .font-row :global(.font-picker .trigger) { min-height: 48px; max-width: 100%; }
  .size { flex: none; }
  .with-unit { display: inline-flex; align-items: center; gap: 8px; }
  .size input[type='number'] { width: 88px; }
  .unit { font-size: 14px; color: var(--text-soft); }

  .colors { display: flex; flex-wrap: wrap; gap: 12px 24px; min-width: 0; }
  .sub-title { flex: 1 1 auto; }
  .borders { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 24px; min-width: 0; }
  .borders .segmented button { min-height: 40px; }
</style>
