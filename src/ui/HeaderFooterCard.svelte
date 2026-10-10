<script lang="ts">
  import { SLOT_KINDS, SLOT_LABELS, type Slot, type SlotKind } from '../lib/setup/hf';
  import { SETUP_LIMITS, clampStep, type HeaderFooterSetup, type Setup } from '../lib/setup/setup';
  import { headerFooterSummary } from '../lib/setup/summary';
  import SetupCard from './SetupCard.svelte';
  import PanelTop from '@lucide/svelte/icons/panel-top';

  /* The Headers and footers card: a title, three slots each for the header and footer, and a size. */
  let { setup, onchange, open = true }: { setup: Setup; onchange: (s: Setup) => void; open?: boolean } = $props();

  const id = $props.id();
  const hf = $derived(setup.hf);
  type Band = 'header' | 'footer';
  const BANDS: { key: Band; label: string }[] = [
    { key: 'header', label: 'Header' },
    { key: 'footer', label: 'Footer' },
  ];
  const POSITIONS = ['Left', 'Center', 'Right'] as const;

  function set(patch: Partial<HeaderFooterSetup>) {
    onchange({ ...setup, hf: { ...setup.hf, ...patch } });
  }

  function setSlot(band: Band, index: number, slot: Slot) {
    const slots = [...hf[band]] as [Slot, Slot, Slot];
    slots[index] = slot;
    set({ [band]: slots });
  }

  function chooseKind(band: Band, index: number, kind: SlotKind) {
    setSlot(band, index, kind === 'text' ? { kind, text: hf[band][index].text ?? '' } : { kind });
  }

  function onSize(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const raw = input.valueAsNumber;
    const next = clampStep(raw, SETUP_LIMITS.hfSizePt, 0.5, hf.size);
    input.value = String(next);
    if (next !== hf.size) set({ size: next });
  }
</script>

<SetupCard title="Headers and footers" icon={PanelTop} summary={headerFooterSummary(setup)} {open} rise={6}>
  <div class="field">
    <label for="{id}-title">Title</label>
    <input id="{id}-title" type="text" maxlength={SETUP_LIMITS.textMax} placeholder="The file name" value={hf.title}
      autocomplete="off" aria-describedby="{id}-title-hint" oninput={(e) => set({ title: e.currentTarget.value })} />
    <p id="{id}-title-hint" class="muted hint">Printed where a slot shows the title. Leave empty to use the file name.</p>
  </div>

  {#each BANDS as band (band.key)}
    <div class="sub" role="group" aria-labelledby="{id}-{band.key}">
      <h3 id="{id}-{band.key}" class="sub-title">{band.label}</h3>
      <div class="slots-wrap"><div class="slots">
        {#each POSITIONS as pos, i (pos)}
          {@const slot = hf[band.key][i]}
          <div class="slot">
            <label for="{id}-{band.key}-{i}">{pos}</label>
            <div class="slot-controls">
              <select id="{id}-{band.key}-{i}" value={slot.kind} aria-label="{band.label} {pos.toLowerCase()}"
                onchange={(e) => chooseKind(band.key, i, e.currentTarget.value as SlotKind)}>
                {#each SLOT_KINDS as kind (kind)}<option value={kind}>{SLOT_LABELS[kind]}</option>{/each}
              </select>
              {#if slot.kind === 'text'}
                <input type="text" maxlength={SETUP_LIMITS.textMax} value={slot.text ?? ''} placeholder="Text"
                  autocomplete="off" aria-label="{band.label} {pos.toLowerCase()} text"
                  oninput={(e) => setSlot(band.key, i, { kind: 'text', text: e.currentTarget.value })} />
              {/if}
            </div>
          </div>
        {/each}
      </div></div>
    </div>
  {/each}

  <div class="sub">
    <div class="field">
      <label for="{id}-size">Size</label>
      <span class="with-unit">
        <input id="{id}-size" type="number" inputmode="decimal" step="0.5"
          min={SETUP_LIMITS.hfSizePt[0]} max={SETUP_LIMITS.hfSizePt[1]} value={hf.size}
          aria-describedby="{id}-size-unit" onchange={onSize} />
        <span id="{id}-size-unit" class="unit">pt</span>
      </span>
    </div>
  </div>
</SetupCard>

<style>
  /* Three slots side by side when the card is wide enough, else one per line with the label beside it. */
  .slots-wrap { container-type: inline-size; min-width: 0; }
  .slots { display: grid; gap: 10px; min-width: 0; }
  .slot { display: grid; grid-template-columns: 60px minmax(0, 1fr); align-items: start; gap: 8px; min-width: 0; }
  .slot label { margin: 0; padding-top: 11px; font-size: 14px; font-weight: 500; color: var(--text-soft); }
  .slot-controls { display: grid; gap: 8px; min-width: 0; }
  .slot select, .slot input[type='text'] { width: 100%; min-width: 0; min-height: 44px; padding-top: 8px; padding-bottom: 8px; font-size: 14px; }
  .slot select { padding-left: 12px; padding-right: 32px; background-position: calc(100% - 18px) 52%, calc(100% - 13px) 52%; }
  @container (min-width: 400px) {
    .slots { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .slot { grid-template-columns: minmax(0, 1fr); gap: 6px; }
    .slot label { padding-top: 0; }
  }

  .with-unit { display: inline-flex; align-items: center; gap: 8px; }
  .with-unit input[type='number'] { width: 88px; }
  .unit { font-size: 14px; color: var(--text-soft); }
</style>
