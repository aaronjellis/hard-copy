<script lang="ts">
  import { tick } from 'svelte';
  import { flip } from 'svelte/animate';
  import type { Dataset } from '../lib/sheet/import';
  import {
    defaultColumnSetup, SETUP_LIMITS, type ColumnAlign, type ColumnSetup, type Setup,
  } from '../lib/setup/setup';
  import {
    clampFixedWidth, moveColumn, parseRowLimit, reorderColumn, updateColumn, withColumnOrder,
  } from '../lib/setup/columns';
  import { columnsSummary } from '../lib/setup/summary';
  import SetupCard from './SetupCard.svelte';
  import Columns3 from '@lucide/svelte/icons/columns-3';
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import ChevronUp from '@lucide/svelte/icons/chevron-up';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import AlignLeft from '@lucide/svelte/icons/align-left';
  import AlignCenter from '@lucide/svelte/icons/align-center';
  import AlignRight from '@lucide/svelte/icons/align-right';
  import Table2 from '@lucide/svelte/icons/table-2';

  /* The Columns card: include, order, width, alignment, and wrap per column; then the row options. */
  let { setup, dataset, onchange, open = true }: {
    setup: Setup;
    dataset: Dataset | null;
    onchange: (s: Setup) => void;
    open?: boolean;
  } = $props();

  const id = $props.id();
  /** Inches a column starts at when switched to a fixed width. */
  const FIXED_START_IN = 1.5;
  const ALIGNS: { value: Exclude<ColumnAlign, 'auto'>; label: string; icon: typeof AlignLeft }[] = [
    { value: 'left', label: 'Left', icon: AlignLeft },
    { value: 'center', label: 'Center', icon: AlignCenter },
    { value: 'right', label: 'Right', icon: AlignRight },
  ];

  const names = $derived(dataset ? new Map(dataset.columns.map((c) => [c.id, c.name])) : null);
  /** The setup's order, limited to the loaded sheet's columns. */
  const order = $derived(names ? setup.columns.order.filter((cid) => names.has(cid)) : []);
  const summary = $derived(columnsSummary(setup, names ? [...names.keys()] : null));

  const columnOf = (cid: string): ColumnSetup =>
    Object.hasOwn(setup.columns.byId, cid) ? setup.columns.byId[cid] : defaultColumnSetup(cid);
  const nameOf = (cid: string) => names?.get(cid) ?? cid;

  function patch(cid: string, p: Partial<Omit<ColumnSetup, 'id'>>) {
    const next = updateColumn(setup, cid, p);
    if (next !== setup) onchange(next);
  }

  /** Set the full order: the visible ids in their new order, then any setup ids the sheet lacks. */
  function commitOrder(visible: readonly string[]) {
    const rest = setup.columns.order.filter((cid) => !names?.has(cid));
    onchange(withColumnOrder(setup, [...visible, ...rest]));
  }

  // --- Keyboard reorder: Move up / Move down, with focus kept on the moved row. ---
  let list = $state<HTMLOListElement>();
  let announcement = $state('');
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** Slide time for rows that change place; 0 while a drag commits, since the rows are already there. */
  let flipMs = $state(reducedMotion ? 0 : 160);

  async function move(cid: string, delta: number) {
    const next = moveColumn(order, cid, delta);
    if (next === order) return;
    commitOrder(next);
    const at = next.indexOf(cid);
    announcement = `Moved ${nameOf(cid)} to position ${at + 1} of ${next.length}.`;
    await tick();
    // Keep focus on the same button, or on the other one when the row reached an end.
    const row = list?.querySelector<HTMLElement>(`[data-col="${CSS.escape(cid)}"]`);
    const same = row?.querySelector<HTMLButtonElement>(delta < 0 ? '[data-move="up"]' : '[data-move="down"]');
    const other = row?.querySelector<HTMLButtonElement>(delta < 0 ? '[data-move="down"]' : '[data-move="up"]');
    (same && !same.disabled ? same : other)?.focus();
  }

  // --- Pointer reorder with the grip. The DOM stays put during the drag: the dragged row follows the
  // pointer and the rows it passes slide aside with transforms; the new order commits on release. ---
  type Drag = {
    id: string;
    from: number;
    to: number;
    startY: number;
    /** Row centers in page coordinates at the start. */
    centers: number[];
    /** How far a passed row slides: the dragged row's height plus the gap. */
    shift: number;
  };
  let drag = $state<Drag | null>(null);
  let dragDy = $state(0);

  function rowOffset(index: number): number {
    if (!drag) return 0;
    if (index === drag.from) return dragDy;
    if (drag.to > drag.from && index > drag.from && index <= drag.to) return -drag.shift;
    if (drag.to < drag.from && index >= drag.to && index < drag.from) return drag.shift;
    return 0;
  }

  function startDrag(e: PointerEvent, cid: string) {
    if (!e.isPrimary || e.button !== 0 || !list) return;
    e.preventDefault();
    const rows = [...list.children] as HTMLElement[];
    const rects = rows.map((r) => r.getBoundingClientRect());
    const from = order.indexOf(cid);
    if (from === -1 || rects.length !== order.length) return;
    const gap = rects.length > 1 ? rects[1].top - rects[0].bottom : 0;
    drag = {
      id: cid,
      from,
      to: from,
      startY: e.pageY,
      centers: rects.map((r) => r.top + window.scrollY + r.height / 2),
      shift: rects[from].height + gap,
    };
    dragDy = 0;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // A pointer that is no longer active cannot be captured; the drag still follows its events.
    }
  }

  function moveDrag(e: PointerEvent) {
    if (!drag) return;
    dragDy = e.pageY - drag.startY;
    const center = drag.centers[drag.from] + dragDy;
    let to = 0;
    drag.centers.forEach((c, i) => {
      if (i !== drag!.from && c < center) to++;
    });
    drag.to = to;
  }

  async function endDrag(commit: boolean) {
    if (!drag) return;
    const { id: cid, to } = drag;
    const next = commit ? reorderColumn(order, cid, to) : order;
    const restore = flipMs;
    flipMs = 0;
    drag = null;
    dragDy = 0;
    if (next !== order) {
      commitOrder(next);
      announcement = `Moved ${nameOf(cid)} to position ${next.indexOf(cid) + 1} of ${next.length}.`;
    }
    await tick();
    flipMs = restore;
  }

  // --- Width and rows: number fields clamp on change (blur or Enter). ---
  function chooseWidth(cid: string, mode: string) {
    const current = columnOf(cid).width;
    if (mode === current.mode) return;
    patch(cid, { width: mode === 'fixed' ? { mode: 'fixed', inches: FIXED_START_IN } : { mode: 'auto' } });
  }

  function onInches(cid: string, e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const current = columnOf(cid).width;
    const fallback = current.mode === 'fixed' ? current.inches : FIXED_START_IN;
    const next = clampFixedWidth(input.valueAsNumber) ?? fallback;
    input.value = String(next);
    patch(cid, { width: { mode: 'fixed', inches: next } });
  }

  function onLimit(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const limit = parseRowLimit(input.value);
    input.value = limit === null ? '' : String(limit);
    if (limit !== setup.rows.limit) onchange({ ...setup, rows: { ...setup.rows, limit } });
  }
</script>

<SetupCard title="Columns" icon={Columns3} {summary} {open} rise={4}>
  {#if !dataset}
    <p class="empty muted"><Table2 size={18} aria-hidden="true" />Load a spreadsheet to choose columns.</p>
  {:else}
    <ol class="columns" class:sorting={drag !== null} bind:this={list} aria-label="Columns, in print order">
      {#each order as cid, i (cid)}
        {@const col = columnOf(cid)}
        {@const name = nameOf(cid)}
        <li class="col" class:excluded={!col.include} class:dragging={drag?.id === cid} data-col={cid}
          style:transform={drag ? `translateY(${rowOffset(i)}px)` : undefined}
          animate:flip={{ duration: flipMs }}>
          <div class="col-head">
            <span class="grip" aria-hidden="true" title="Drag to reorder"
              onpointerdown={(e) => startDrag(e, cid)} onpointermove={moveDrag}
              onpointerup={() => endDrag(true)} onpointercancel={() => endDrag(false)}
              onlostpointercapture={() => endDrag(true)}>
              <GripVertical size={18} />
            </span>
            <input id="{id}-inc-{i}" type="checkbox" checked={col.include} aria-label="Include {name}"
              onchange={(e) => patch(cid, { include: e.currentTarget.checked })} />
            <label class="col-name" for="{id}-inc-{i}" title={name}>{name}</label>
            <span class="move">
              <button type="button" class="icon-btn" data-move="up" aria-label="Move {name} up" disabled={i === 0}
                onclick={() => move(cid, -1)}><ChevronUp size={18} aria-hidden="true" /></button>
              <button type="button" class="icon-btn" data-move="down" aria-label="Move {name} down"
                disabled={i === order.length - 1} onclick={() => move(cid, 1)}><ChevronDown size={18} aria-hidden="true" /></button>
            </span>
          </div>

          {#if col.include}
            <div class="col-opts">
              <span class="width">
                <select aria-label="Width of {name}" value={col.width.mode}
                  onchange={(e) => chooseWidth(cid, e.currentTarget.value)}>
                  <option value="auto">Auto width</option>
                  <option value="fixed">Fixed width</option>
                </select>
                {#if col.width.mode === 'fixed'}
                  <input type="number" class="inches" inputmode="decimal" step="0.1"
                    min={SETUP_LIMITS.fixedWidthIn[0]} max={SETUP_LIMITS.fixedWidthIn[1]} value={col.width.inches}
                    aria-label="Width of {name} in inches" onchange={(e) => onInches(cid, e)} />
                  <span class="unit" aria-hidden="true">in</span>
                {/if}
              </span>
              <span class="segmented align" role="group" aria-label="Alignment of {name}">
                <button type="button" aria-pressed={col.align === 'auto'} title="Auto: numbers and dates right, text left"
                  onclick={() => patch(cid, { align: 'auto' })}>Auto</button>
                {#each ALIGNS as a (a.value)}
                  <button type="button" class="icon-only" aria-pressed={col.align === a.value} aria-label={a.label} title={a.label}
                    onclick={() => patch(cid, { align: a.value })}><a.icon size={16} aria-hidden="true" /></button>
                {/each}
              </span>
              <span class="wrap">
                <span aria-hidden="true">Wrap</span>
                <button type="button" class="switch" role="switch" aria-checked={col.wrap} aria-label="Wrap text in {name}"
                  onclick={() => patch(cid, { wrap: !col.wrap })}></button>
              </span>
            </div>
          {/if}
        </li>
      {/each}
    </ol>
    <p class="sr-only" aria-live="polite">{announcement}</p>
  {/if}

  <div class="sub" role="group" aria-labelledby="{id}-rows">
    <h3 id="{id}-rows" class="sub-title">Rows</h3>
    <div class="field">
      <label for="{id}-limit">Print the first N rows</label>
      <input id="{id}-limit" class="limit" type="number" inputmode="numeric" min="1" step="1" placeholder="All rows"
        value={setup.rows.limit ?? ''} aria-describedby="{id}-limit-hint" onchange={onLimit} />
      <p id="{id}-limit-hint" class="muted hint">Leave empty to print every row.</p>
    </div>
    <span class="toggle">
      <span id="{id}-blank">Include blank rows</span>
      <button type="button" class="switch" role="switch" aria-checked={setup.rows.includeBlank} aria-labelledby="{id}-blank"
        onclick={() => onchange({ ...setup, rows: { ...setup.rows, includeBlank: !setup.rows.includeBlank } })}></button>
    </span>
  </div>
</SetupCard>

<style>
  .empty { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 15px; }

  .columns { position: relative; display: grid; gap: 8px; min-width: 0; margin: 0; padding: 0; list-style: none; }
  .col {
    display: grid;
    gap: 10px;
    min-width: 0;
    padding: 8px 10px 10px 4px;
    background: var(--surface);
    border: 1px solid var(--divider);
    border-radius: var(--radius);
    /* The options row below lays out by the row's own width (narrow on phones and in the wide tier's left column). */
    container-type: inline-size;
  }
  .col.excluded { padding-bottom: 8px; background: var(--subtle); }
  .col.excluded .col-name { color: var(--muted); }
  /* While sorting, passed rows slide aside; the dragged row follows the pointer without easing. */
  .sorting .col { transition: transform 160ms var(--ease); }
  .sorting .col.dragging {
    position: relative;
    z-index: 2;
    transition: none;
    box-shadow: var(--shadow-float);
    border-color: var(--line-control);
  }

  .col-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .grip {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 40px;
    border-radius: var(--radius-sm);
    color: var(--muted);
    cursor: grab;
    touch-action: none;
  }
  .grip:hover { background: var(--hover); color: var(--text); }
  .dragging .grip { cursor: grabbing; }
  .col-name {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
    overflow: hidden;
    font-size: 15px;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }
  .move { display: inline-flex; flex: none; gap: 2px; }
  .icon-btn {
    width: 36px;
    min-height: 36px;
    height: 36px;
    padding: 0;
    border-color: transparent;
    background: transparent;
    color: var(--text-soft);
  }
  .icon-btn:hover:not(:disabled) { background: var(--hover); border-color: transparent; }
  .icon-btn:disabled { opacity: 0.3; }

  /* Options sit under the name row: one line when the row is wide, Wrap pushed to the end. */
  .col-opts { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; min-width: 0; padding-left: 6px; }
  .width { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
  .col-opts select { min-height: 40px; padding: 6px 30px 6px 12px; font-size: 14px; background-position: calc(100% - 17px) 52%, calc(100% - 12px) 52%; }
  .col-opts input[type='number'].inches { width: 76px; min-height: 40px; padding: 6px 10px; font-size: 14px; }
  .unit { font-size: 14px; color: var(--text-soft); }
  .align { gap: 2px; padding: 2px; }
  .align button { min-height: 34px; padding: 0 9px; font-size: 13px; }
  .align .icon-only { width: 32px; padding: 0; }
  .wrap { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; font-size: 14px; color: var(--text-soft); }

  /*
   * Narrow rows: the width control and the alignment track stretch to fill their line (one line when
   * both fit, else one each), and Wrap is a full-width switch row like the cards' other switches.
   * Nothing is left stranded at the start of a line.
   */
  @container (max-width: 479px) {
    .width { flex: 1 1 auto; }
    .width select { flex: 1 1 auto; min-width: 0; }
    .align { flex: 1 1 auto; }
    .align button { flex: 1 1 auto; }
    .wrap { flex: 1 1 100%; justify-content: space-between; min-height: 32px; margin-left: 0; }
  }

  .limit { max-width: 160px; }

</style>
