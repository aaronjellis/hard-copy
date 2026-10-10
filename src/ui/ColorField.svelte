<script lang="ts">
  import X from '@lucide/svelte/icons/x';

  /*
   * A color setting: a round swatch that is a native color input (so the system picker opens), the
   * label with the hex value as a caption, and a small × to clear when the setting can be empty.
   * Values are `#rrggbb` in lowercase; null means no color.
   */
  let { value, nullable = false, label, start = '#fefefe', onchange }: {
    value: string | null;
    nullable?: boolean;
    label: string;
    /**
     * What the system picker starts from when there is no color yet. The native input only fires
     * `input` when the value changes, so the default is a near-white nobody picks on purpose: choosing
     * pure white right after a clear still registers. Text colors pass black.
     */
    start?: string;
    onchange: (v: string | null) => void;
  } = $props();

  const id = $props.id();
  const HEX = /^#[0-9a-f]{6}$/i;
  let input = $state<HTMLInputElement>();

  function oninput(e: Event) {
    const v = (e.currentTarget as HTMLInputElement).value.toLowerCase();
    if (HEX.test(v) && v !== value) onchange(v);
  }
</script>

<div class="color-field">
  <span class="swatch" class:empty={value === null} style:--swatch={value ?? 'transparent'}>
    <input bind:this={input} id="{id}-input" type="color" value={value ?? start} aria-describedby="{id}-value" {oninput} />
  </span>
  <span class="text">
    <label for="{id}-input" class="name">{label}</label>
    <span id="{id}-value" class="value muted">{value ?? 'None'}</span>
  </span>
  {#if nullable && value !== null}
    <button type="button" class="clear" aria-label="Clear {label.toLowerCase()} color" onclick={() => { onchange(null); input?.focus(); }}>
      <X size={14} aria-hidden="true" />
    </button>
  {/if}
</div>

<style>
  .color-field { display: inline-flex; align-items: center; gap: 10px; min-width: 0; }
  .swatch {
    position: relative;
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background: var(--swatch);
    /* An inner ring keeps white and near-surface colors visible against the card. */
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 22%, transparent);
    transition: box-shadow 120ms ease;
  }
  .swatch:hover { box-shadow: inset 0 0 0 1px var(--text); }
  /* No color: a diagonal slash across an empty circle. */
  .swatch.empty {
    background:
      linear-gradient(to top right, transparent calc(50% - 1px), var(--muted) calc(50% - 1px), var(--muted) calc(50% + 1px), transparent calc(50% + 1px)),
      var(--surface);
  }
  .swatch:has(input:focus-visible) { outline: 2px solid var(--text); outline-offset: 2px; }
  /* The native input covers the swatch, invisible, so a click or Enter opens the system picker. */
  .swatch input[type='color'] {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    min-height: 0;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 50%;
    opacity: 0;
    cursor: pointer;
  }
  .text { display: grid; min-width: 0; line-height: 1.25; }
  .name { margin: 0; font-size: 14px; font-weight: 500; color: var(--text); cursor: pointer; white-space: nowrap; }
  .value { font-size: 13px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .clear {
    width: 28px;
    min-height: 28px;
    height: 28px;
    padding: 0;
    border-color: transparent;
    background: transparent;
    color: var(--muted);
  }
  .clear:hover:not(:disabled) { background: var(--hover); border-color: transparent; color: var(--text); }
</style>
