<script lang="ts" module>
  type Sheet = { name: string; cells: string[][] };

  /**
   * Every sheet of a loaded workbook, keyed by each sheet's cells (which a dataset keeps as
   * `source`). Lives outside the component so a remount of the panel doesn't lose the other
   * sheets.
   */
  const workbookSheets = new WeakMap<object, Sheet[]>();

  const ACCEPT = '.csv,.tsv,.txt,.xlsx,.xls';
  const WORKBOOK_RE = /\.(xlsx|xls)$/i;
  const TEXT_RE = /\.(csv|tsv|txt)$/i;
  /** Rows drawn in the table; inclusion controls still cover every row. */
  const MAX_SHOWN = 200;
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import {
    ImportError, UNREADABLE_FILE, buildDataset, detectHeaderRow, parseDelimited, parseWorkbook,
    renameColumn, setAllIncluded, setHeaderRow, setIncluded, setTransposed, type Dataset,
  } from '../lib/sheet/import';
  import { errorMessage } from '../lib/errors';
  import Upload from '@lucide/svelte/icons/upload';
  import ClipboardPaste from '@lucide/svelte/icons/clipboard-paste';
  import FileSpreadsheet from '@lucide/svelte/icons/file-spreadsheet';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import X from '@lucide/svelte/icons/x';

  let { dataset, onchange }: {
    dataset: Dataset | null;
    onchange: (ds: Dataset | null) => void;
  } = $props();

  const id = $props.id();
  let root = $state<HTMLDivElement>();
  let fileInput = $state<HTMLInputElement>();
  let loading = $state(false);
  let error = $state('');
  let dragging = $state(false);
  let pasteOpen = $state(false);
  let pasteText = $state('');
  let pasteArea = $state<HTMLTextAreaElement>();
  /** True while a loaded sheet shows the loader again (Replace); the old sheet stays until a new one loads. */
  let replacing = $state(false);
  /**
   * Bumped by Cancel and by every new load or removal. A file load that finishes under an older
   * number was cancelled or superseded, so its result is dropped.
   */
  let loadSeq = 0;

  // Header rename in place.
  let editingId = $state<string | null>(null);
  let draft = $state('');
  let headerInput = $state<HTMLInputElement>();

  const sheets = $derived(dataset ? workbookSheets.get(dataset.source) ?? null : null);
  const shownRows = $derived(dataset ? dataset.rows.slice(0, MAX_SHOWN) : []);
  const showLoader = $derived(!dataset || replacing);

  function finishLoad(ds: Dataset) {
    error = '';
    replacing = false;
    pasteOpen = false;
    pasteText = '';
    editingId = null;
    onchange(ds);
  }

  function fromCells(cells: string[][], sourceName: string, extra: { sheetNames?: string[]; activeSheet?: string } = {}): Dataset {
    const ds = buildDataset(cells, { sourceName, headerRow: detectHeaderRow(cells), transposed: false, ...extra });
    if (ds.rows.length === 0 && ds.columns.length === 0) throw new ImportError('That file has no rows.');
    return ds;
  }

  /**
   * Load a file (from the picker, a drop here, or a drop on the spreadsheet bar). Resolves with the
   * error message shown, or '' when it loaded or was superseded.
   */
  export async function loadFile(file: File): Promise<string> {
    const seq = ++loadSeq;
    loading = true;
    error = '';
    try {
      if (WORKBOOK_RE.test(file.name)) {
        const bytes = await file.arrayBuffer();
        if (seq !== loadSeq) return '';
        // Only legacy .xls needs SheetJS's codepage tables.
        const { sheets: all } = await parseWorkbook(bytes, { legacy: file.name.toLowerCase().endsWith('.xls') });
        if (seq !== loadSeq) return '';
        for (const s of all) workbookSheets.set(s.cells, all);
        const first = all[0];
        finishLoad(fromCells(first.cells, file.name, { sheetNames: all.map((s) => s.name), activeSheet: first.name }));
      } else if (TEXT_RE.test(file.name) || file.type.startsWith('text/')) {
        const text = await file.text();
        if (seq !== loadSeq) return '';
        finishLoad(fromCells(parseDelimited(text), file.name));
      } else {
        throw new ImportError(UNREADABLE_FILE);
      }
    } catch (err) {
      if (seq === loadSeq) error = err instanceof ImportError ? err.message : errorMessage(err);
    } finally {
      if (seq === loadSeq) loading = false;
    }
    return seq === loadSeq ? error : '';
  }

  /** Leave Replace, dropping any load still in flight; the current list stays. */
  function cancelReplace() {
    loadSeq++;
    loading = false;
    replacing = false;
    error = '';
  }

  function onFilePicked(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    // Clear so picking the same file again still fires change.
    input.value = '';
    if (file) void loadFile(file);
  }

  function onDragOver(e: DragEvent) {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    dragging = true;
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    const file = e.dataTransfer?.files[0];
    if (file) void loadFile(file);
  }

  /** Show the paste box and focus it (the bar's Paste cells opens the dialog straight to it). */
  export async function openPaste() {
    if (dataset) replacing = true;
    pasteOpen = true;
    await tick();
    pasteArea?.focus();
  }

  async function togglePaste() {
    pasteOpen = !pasteOpen;
    if (pasteOpen) {
      await tick();
      pasteArea?.focus();
    }
  }

  function usePasted() {
    if (pasteText.trim() === '') {
      error = 'Paste cells from a spreadsheet first.';
      return;
    }
    try {
      const ds = fromCells(parseDelimited(pasteText), 'Pasted cells');
      // A file still loading must not replace the pasted cells when it finishes.
      loadSeq++;
      loading = false;
      finishLoad(ds);
    } catch (err) {
      error = err instanceof ImportError ? err.message : errorMessage(err);
    }
  }

  /** Switch to another sheet of the loaded workbook. */
  export function chooseSheet(name: string) {
    if (!dataset || !sheets) return;
    const sheet = sheets.find((s) => s.name === name);
    if (!sheet) return;
    finishLoad(fromCells(sheet.cells, dataset.sourceName, { sheetNames: dataset.sheetNames, activeSheet: name }));
  }

  /** Drop the spreadsheet. Also cancels any load in flight, so a late file can't bring one back. */
  export function remove() {
    loadSeq++;
    loading = false;
    error = '';
    replacing = false;
    editingId = null;
    onchange(null);
  }

  /**
   * Called when the dialog closes: leave an idle Replace so Edit reopens on the table.
   * A file still loading keeps going and lands when it finishes.
   */
  export function settle() {
    if (loading) return;
    replacing = false;
    error = '';
  }

  async function startEdit(colId: string, name: string) {
    editingId = colId;
    draft = name;
    await tick();
    headerInput?.focus();
    headerInput?.select();
  }

  function commitEdit() {
    const colId = editingId;
    if (!colId || !dataset) return;
    editingId = null;
    onchange(renameColumn(dataset, colId, draft));
  }

  /** Put focus back on a column's header button once the input has gone. */
  async function focusHeader(colId: string) {
    await tick();
    root?.querySelector<HTMLButtonElement>(`.header-btn[data-col="${colId}"]`)?.focus();
  }

  // A blur from clicking elsewhere commits without moving focus; only Enter and Escape restore it.
  function onHeaderKeydown(e: KeyboardEvent) {
    const colId = editingId;
    if (!colId) return;
    if (e.key === 'Enter') {
      // Commit and keep focus in the table.
      e.preventDefault();
      commitEdit();
      void focusHeader(colId);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      editingId = null;
      void focusHeader(colId);
    }
  }
</script>

<!-- Rendered in ListDialog, outside any form, so Enter here never submits. -->
<div class="data-panel" bind:this={root}>
  <input bind:this={fileInput} id="{id}-file" class="sr-only" type="file" accept={ACCEPT} onchange={onFilePicked}
    tabindex="-1" aria-hidden="true" />

  {#if showLoader}
    <div class="loader">
      <!-- The zone is a big button: click or Enter opens the picker; files can also be dropped on it. -->
      <button type="button" class="drop" class:dragging disabled={loading}
        onclick={() => fileInput?.click()} ondragover={onDragOver} ondragenter={onDragOver}
        ondragleave={() => (dragging = false)} ondrop={onDrop}>
        {#if loading}<LoaderCircle class="spin" size={24} aria-hidden="true" />{:else}<Upload size={24} aria-hidden="true" />{/if}
        <span class="drop-title">{loading ? 'Reading your spreadsheet…' : 'Drop a spreadsheet here, or choose a file'}</span>
        <span class="drop-hint">CSV, TSV, or Excel (.xlsx, .xls)</span>
      </button>
      <div class="loader-actions">
        <button type="button" aria-expanded={pasteOpen} aria-controls="{id}-paste" onclick={togglePaste}>
          <ClipboardPaste size={18} aria-hidden="true" />Paste cells
        </button>
        {#if replacing}
          <button type="button" class="quiet" onclick={cancelReplace}>
            <X size={18} aria-hidden="true" />Cancel
          </button>
        {/if}
      </div>
      {#if pasteOpen}
        <div class="paste" id="{id}-paste">
          <label for="{id}-paste-text">Cells copied from a spreadsheet</label>
          <textarea id="{id}-paste-text" bind:this={pasteArea} bind:value={pasteText} rows="5"
            placeholder={'Name\tStreet\tCity\nAda Lovelace\t12 St James Sq\tLondon'}></textarea>
          <button type="button" class="use-paste" onclick={usePasted}>Use pasted cells</button>
        </div>
      {/if}
    </div>
  {/if}

  {#if error}<p class="error status-line" role="alert"><CircleAlert size={18} aria-hidden="true" /><span>{error}</span></p>{/if}

  {#if dataset && !replacing}
    <div class="source">
      <FileSpreadsheet size={18} aria-hidden="true" />
      <span class="source-name" title={dataset.sourceName}>{dataset.sourceName}</span>
      {#if sheets && dataset.sheetNames && dataset.sheetNames.length > 1}
        <label class="sr-only" for="{id}-sheet">Sheet</label>
        <select id="{id}-sheet" class="sheet" value={dataset.activeSheet}
          onchange={(e) => chooseSheet(e.currentTarget.value)}>
          {#each dataset.sheetNames as name (name)}<option value={name}>{name}</option>{/each}
        </select>
      {/if}
    </div>

    <div class="controls">
      <span class="toggle">
        <button type="button" class="switch" role="switch" aria-checked={dataset.headerRow} aria-labelledby="{id}-hdr"
          onclick={() => dataset && onchange(setHeaderRow(dataset, !dataset.headerRow))}></button>
        <span id="{id}-hdr">First row is headers</span>
      </span>
      <span class="toggle">
        <button type="button" class="switch" role="switch" aria-checked={dataset.transposed} aria-labelledby="{id}-tr"
          onclick={() => dataset && onchange(setTransposed(dataset, !dataset.transposed))}></button>
        <span id="{id}-tr">Headers run down the first column</span>
      </span>
    </div>

    <div class="controls">
      <div class="segmented" role="group" aria-label="Row selection">
        <button type="button" onclick={() => dataset && onchange(setAllIncluded(dataset, true))}>Select all</button>
        <button type="button" onclick={() => dataset && onchange(setAllIncluded(dataset, false))}>Clear</button>
      </div>
      <div class="list-actions">
        <button type="button" class="quiet" onclick={() => { replacing = true; error = ''; }}>
          <RefreshCw size={16} aria-hidden="true" />Replace spreadsheet
        </button>
        <button type="button" class="quiet" onclick={remove}>
          <Trash2 size={16} aria-hidden="true" />Remove spreadsheet
        </button>
      </div>
    </div>

    <div class="table-wrap" role="region" aria-label="Spreadsheet rows" tabindex="-1">
      <table>
        <thead>
          <tr>
            <th class="pick" scope="col"><span class="sr-only">Include</span></th>
            {#each dataset.columns as col (col.id)}
              {@const renamed = col.name !== col.originalName}
              <th scope="col" title={renamed ? `Original name: ${col.originalName}` : undefined}>
                {#if editingId === col.id}
                  <input bind:this={headerInput} class="header-input" bind:value={draft}
                    aria-label="Column name" onkeydown={onHeaderKeydown} onblur={commitEdit} />
                {:else}
                  <button type="button" class="header-btn" class:renamed data-col={col.id}
                    aria-label="Rename column {col.name}" onclick={() => startEdit(col.id, col.name)}>{col.name}</button>
                {/if}
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each shownRows as row, r (r)}
            <tr class:excluded={!dataset.included[r]}>
              <td class="pick">
                <label class="row-pick">
                  <input type="checkbox" checked={dataset.included[r]} aria-label="Include row {r + 1}"
                    onchange={(e) => dataset && onchange(setIncluded(dataset, r, e.currentTarget.checked))} />
                  <span class="row-num" aria-hidden="true">{r + 1}</span>
                </label>
              </td>
              {#each row as cell, c (c)}<td>{cell}</td>{/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if dataset.rows.length > MAX_SHOWN}
      <p class="muted note">Showing {MAX_SHOWN} of {dataset.rows.length} rows. Select all and Clear apply to every row.</p>
    {/if}
  {/if}
</div>

<style>
  /* A column that fills the dialog body; only the table shrinks when the dialog is short. */
  .data-panel { display: flex; flex-direction: column; flex: 1 1 auto; gap: 12px; min-width: 0; min-height: 0; }
  .data-panel > * { flex: none; }
  .loader { display: grid; gap: 10px; }

  .drop {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    min-height: 132px;
    padding: 20px;
    background: var(--subtle);
    border: 1px dashed var(--line-control);
    border-radius: var(--radius);
    color: var(--text);
    text-align: center;
    white-space: normal;
  }
  .drop:hover:not(:disabled), .drop.dragging { background: var(--hover); border-color: var(--text); }
  .drop.dragging { border-style: solid; box-shadow: inset 0 0 0 1px var(--text); }
  .drop :global(.lucide) { color: var(--muted); }
  .drop-title { font-size: 15px; font-weight: 600; }
  .drop-hint { font-size: 13px; font-weight: 400; color: var(--muted); }

  .loader-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .paste { display: grid; gap: 8px; }
  .paste label { margin: 0; }
  .paste textarea { width: 100%; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
  .use-paste { justify-self: start; }
  .quiet { border-color: transparent; background: transparent; }
  .quiet:hover:not(:disabled) { background: var(--subtle); border-color: transparent; }

  .error { margin: 0; font-size: 14px; }
  .note { margin: 0; font-size: 13px; }

  .source { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
  .source :global(.lucide) { color: var(--muted); }
  .source-name { min-width: 0; flex: 1 1 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 600; }
  .sheet { min-height: 36px; padding: 4px 36px 4px 12px; font-size: 14px; border-radius: 9999px; max-width: 100%; }

  .controls { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; }
  .toggle { display: inline-flex; align-items: center; gap: 10px; font-size: 14px; color: var(--text-soft); }
  .controls .segmented button { min-height: 30px; padding: 0 12px; font-size: 13px; }
  .list-actions { display: flex; gap: 4px; margin-left: auto; }
  .list-actions button { min-height: 36px; padding: 0 10px; font-size: 13px; }

  /* Same switch as the card headers' Print toggle. */
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

  /* The table scrolls inside its own frame in both directions; the dialog body never has to. */
  /* In a short dialog the table gives up height first, down to the header and a few rows. */
  .data-panel > .table-wrap { flex: 0 1 auto; min-height: 140px; }
  .table-wrap {
    max-height: 50vh;
    overflow: auto;
    min-width: 0;
    border: 1px solid var(--divider);
    border-radius: var(--radius-sm);
    background: var(--surface);
  }
  table { border-collapse: separate; border-spacing: 0; width: max-content; min-width: 100%; font-size: 13px; line-height: 1.35; }
  th, td {
    padding: 6px 10px;
    text-align: left;
    white-space: nowrap;
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
    border-bottom: 1px solid var(--divider);
    border-right: 1px solid var(--divider);
  }
  th:last-child, td:last-child { border-right: 0; }
  tbody tr:last-child td { border-bottom: 0; }
  thead th {
    position: sticky;
    top: 0;
    z-index: 2;
    padding: 2px 4px;
    background: var(--subtle);
    font-weight: 600;
  }
  tbody tr:nth-child(even) td { background: color-mix(in srgb, var(--subtle) 60%, var(--surface)); }
  tbody tr.excluded td:not(.pick) { color: var(--muted); text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--muted) 60%, transparent); }

  /* The include column stays in view while the table scrolls sideways. */
  .pick { position: sticky; left: 0; z-index: 1; width: 1%; padding: 0 8px; background: var(--surface); }
  thead .pick { z-index: 3; background: var(--subtle); }
  .row-pick { display: inline-flex; align-items: center; gap: 6px; margin: 0; min-height: 30px; font-size: 12px; font-weight: 400; cursor: pointer; }
  .row-pick input[type='checkbox'] { width: 16px; height: 16px; }
  .row-num { min-width: 2ch; color: var(--muted); font-variant-numeric: tabular-nums; }

  .header-btn {
    width: 100%;
    min-height: 30px;
    justify-content: flex-start;
    padding: 0 6px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    font-size: 13px;
    font-weight: 600;
    max-width: 232px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    display: block;
    text-align: left;
    cursor: text;
  }
  .header-btn:hover:not(:disabled) { background: var(--hover); border: 0; }
  .header-btn.renamed { text-decoration: underline dotted var(--muted); text-underline-offset: 3px; }
  .header-input.header-input {
    width: 160px;
    min-height: 30px;
    padding: 2px 6px;
    font-size: 13px;
    font-weight: 600;
    border-radius: 6px;
  }

  @media (max-width: 480px) {
    .list-actions { margin-left: 0; }
  }
</style>
