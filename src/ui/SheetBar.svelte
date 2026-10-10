<script lang="ts">
  import { includedCount, type Dataset } from '../lib/sheet/import';
  import ListDialog from './ListDialog.svelte';
  import Table from '@lucide/svelte/icons/table';
  import Upload from '@lucide/svelte/icons/upload';
  import ClipboardPaste from '@lucide/svelte/icons/clipboard-paste';
  import FileSpreadsheet from '@lucide/svelte/icons/file-spreadsheet';
  import Pencil from '@lucide/svelte/icons/pencil';
  import X from '@lucide/svelte/icons/x';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';

  /*
   * The full-width Spreadsheet bar. Empty: Load spreadsheet and Paste cells open the import dialog;
   * a file dropped anywhere on the bar loads straight away. Loaded: a summary pill, the sheet picker
   * for workbooks with several sheets, Edit (the dialog) and remove. The dataset itself lives in App.
   */
  let { dataset, onchange }: {
    dataset: Dataset | null;
    onchange: (ds: Dataset | null) => void;
  } = $props();

  const id = $props.id();
  let listDialog = $state<ReturnType<typeof ListDialog>>();
  let loadButton = $state<HTMLButtonElement>();
  let dragging = $state(false);
  /** Name of a file dropped on the bar while it loads. */
  let dropping = $state('');
  let dropError = $state('');

  const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
  const summary = $derived.by(() => {
    if (!dataset) return '';
    const total = dataset.rows.length;
    const kept = includedCount(dataset);
    const rows = kept === total ? plural(total, 'row', 'rows') : `${kept.toLocaleString()} of ${plural(total, 'row', 'rows')}`;
    return `${rows} · ${plural(dataset.columns.length, 'column', 'columns')}`;
  });
  const multiSheet = $derived(!!dataset?.sheetNames && dataset.sheetNames.length > 1);

  function onDragOver(e: DragEvent) {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    dragging = true;
  }

  function onDragLeave(e: DragEvent) {
    // Only when the pointer leaves the bar itself, not when it crosses a child.
    const to = e.relatedTarget as Node | null;
    if (!to || !(e.currentTarget as HTMLElement).contains(to)) dragging = false;
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    const file = e.dataTransfer?.files[0];
    if (!file || !listDialog) return;
    dropError = '';
    dropping = file.name;
    try {
      dropError = await listDialog.loadFile(file);
    } finally {
      dropping = '';
    }
  }

  function remove() {
    dropError = '';
    listDialog?.remove();
  }

  // After removing, the bar's buttons change; keep focus in the bar on Load spreadsheet.
  let hadDataset = false;
  $effect(() => {
    const has = !!dataset;
    if (hadDataset && !has && document.activeElement === document.body) loadButton?.focus();
    hadDataset = has;
  });
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section class="sheet-bar rise" class:dragging style="--i: 1" aria-labelledby="{id}-title"
  ondragover={onDragOver} ondragenter={onDragOver} ondragleave={onDragLeave} ondrop={onDrop}>
  <div class="title-line">
    <Table size={20} aria-hidden="true" />
    <h2 id="{id}-title" class="card-title">Spreadsheet</h2>
  </div>

  <div class="controls">
    {#if dropping}
      <span class="pill" aria-live="polite">
        <LoaderCircle class="spin" size={16} aria-hidden="true" />
        <span class="pill-name">Reading {dropping}…</span>
      </span>
    {:else if dataset}
      <span class="pill" title={dataset.sourceName}>
        <FileSpreadsheet size={16} aria-hidden="true" />
        <span class="pill-name">{dataset.sourceName}</span>
        <span class="pill-count"><span aria-hidden="true">·</span><span class="sr-only">,</span> {summary}</span>
      </span>
      {#if multiSheet && dataset.sheetNames}
        <label class="sr-only" for="{id}-sheet">Sheet</label>
        <select id="{id}-sheet" class="sheet" value={dataset.activeSheet}
          onchange={(e) => listDialog?.chooseSheet(e.currentTarget.value)}>
          {#each dataset.sheetNames as name (name)}<option value={name}>{name}</option>{/each}
        </select>
      {/if}
      <div class="loaded-actions">
        <button type="button" class="edit" aria-haspopup="dialog" onclick={(e) => listDialog?.open(e.currentTarget)}>
          <Pencil size={16} aria-hidden="true" />Edit
        </button>
        <button type="button" class="remove" aria-label="Remove spreadsheet" title="Remove spreadsheet" onclick={remove}>
          <X size={18} aria-hidden="true" />
        </button>
      </div>
    {:else}
      <button type="button" class="load" bind:this={loadButton} aria-haspopup="dialog" aria-describedby="{id}-hint"
        onclick={(e) => listDialog?.open(e.currentTarget)}>
        <Upload size={18} aria-hidden="true" />Load spreadsheet
      </button>
      <button type="button" class="paste" aria-haspopup="dialog" onclick={(e) => listDialog?.open(e.currentTarget, { paste: true })}>
        <ClipboardPaste size={18} aria-hidden="true" />Paste cells
      </button>
      <span id="{id}-hint" class="hint">or drop a CSV, TSV, or Excel file here</span>
    {/if}
  </div>

  {#if dropError}
    <p class="error status-line" role="alert"><CircleAlert size={18} aria-hidden="true" /><span>{dropError}</span></p>
  {/if}
</section>

<ListDialog bind:this={listDialog} {dataset} {onchange} />

<style>
  .sheet-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 24px;
    min-width: 0;
    margin-bottom: 24px;
    padding: 16px 20px;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    box-shadow: var(--shadow-card);
    transition: box-shadow 120ms ease, border-color 120ms ease;
  }
  .sheet-bar:hover { box-shadow: var(--shadow-card-hover); }
  /* A file dragged over the bar: the whole bar is the drop target. */
  .sheet-bar.dragging { border: 1px dashed var(--text); box-shadow: inset 0 0 0 1px var(--text); }
  .title-line { flex: none; }

  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 12px;
    flex: 1 1 320px;
    justify-content: flex-end;
    min-width: 0;
  }

  /* Empty: a dashed pill (the drop target's look) and Paste cells beside it. */
  .load { border-style: dashed; }
  .load, .paste { min-height: 40px; }
  .hint { font-size: 13px; color: var(--muted); }

  /* Loaded: one summary pill that truncates the file name first. */
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    max-width: 100%;
    min-height: 40px;
    padding: 0 14px 0 12px;
    border-radius: 999px;
    background: var(--subtle);
    font-size: 14px;
    font-weight: 500;
    flex: 0 1 auto;
  }
  .pill > :global(.lucide) { color: var(--muted); }
  .pill-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
  .pill-count { flex: none; white-space: nowrap; color: var(--muted); }
  .sheet { min-height: 40px; padding: 4px 36px 4px 14px; font-size: 14px; border-radius: 9999px; max-width: 220px; min-width: 0; }
  .loaded-actions { display: inline-flex; align-items: center; gap: 4px; flex: none; }
  .remove {
    width: 40px;
    padding: 0;
    border-color: transparent;
    background: transparent;
    color: var(--muted);
  }
  .remove:hover:not(:disabled) { background: var(--hover); border-color: transparent; color: var(--text); }

  .error { flex-basis: 100%; margin: 0; font-size: 14px; }

  @media (max-width: 759px) {
    .sheet-bar { margin-bottom: 20px; padding: 16px; }
    .controls { flex-basis: 100%; justify-content: flex-start; }
    .hint { flex-basis: 100%; }
    /* Phone: the pill takes the row; the sheet picker and the actions share the next one. */
    .pill { flex: 1 1 100%; }
    .sheet { flex: 1 1 auto; max-width: none; }
    .loaded-actions { margin-left: auto; }
  }
  @media (max-width: 480px) {
    .load, .paste { flex: 1 1 0; padding: 0 12px; }
  }
</style>
