<script lang="ts">
  import { untrack } from 'svelte';
  import { includedCount, type Dataset } from '../lib/sheet/import';
  import type { Setup } from '../lib/setup/setup';
  import { resolvePaper } from '../lib/setup/paper';
  import type { FontProvider } from '../lib/fonts/types';
  import { buildTablePdf, type BuildInput, type TablePdf } from '../lib/table/build';
  import { renderPdfPageToCanvas, isRenderCancelled } from '../lib/pdf/preview';
  import {
    DEFAULT_PRINT_DPI, MAX_PRINT_PAGES, PrintTooLongError, fillPrintWindow, openPrintWindow, renderPdfPagesToDataUrls,
  } from '../lib/pdf/print-window';
  import { errorMessage } from '../lib/errors';
  import Eye from '@lucide/svelte/icons/eye';
  import FileText from '@lucide/svelte/icons/file-text';
  import Printer from '@lucide/svelte/icons/printer';
  import Download from '@lucide/svelte/icons/download';
  import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import LoaderCircle from '@lucide/svelte/icons/loader-circle';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Info from '@lucide/svelte/icons/info';

  let { dataset, setup, fonts }: {
    dataset: Dataset | null;
    setup: Setup;
    /** One provider for the session so fonts load once. */
    fonts: FontProvider;
  } = $props();

  /** Above this many rows, note that building may take a moment. */
  const LARGE_SHEET = 5000;

  // The latest preview build: the whole document, so stepping pages never rebuilds.
  let result = $state.raw<TablePdf | null>(null);
  /** Page the preview shows, from 0. */
  let current = $state(0);
  let error = $state('');
  /** Why Print took the share-sheet route on a phone; cleared on the next print. */
  let printNote = $state('');
  let building = $state(false);
  let rendering = $state(false);
  let exporting = $state(false);
  // True once the canvas holds a drawn page, so an empty canvas never shows.
  let drawn = $state(false);
  let stageWidth = $state(0);
  let panel = $state<HTMLDivElement>();
  let stage = $state<HTMLDivElement>();
  let canvas = $state<HTMLCanvasElement>();
  /** The inputs `result` was built from, so Print and Download reuse it only when nothing changed. Not reactive. */
  let builtFrom: { ds: Dataset; setup: string } | null = null;
  // Blob URLs handed to print tabs and downloads. Not reactive: only used for cleanup.
  let lastPrintUrl = '';
  const downloadUrls = new Set<string>();

  const pageCount = $derived(result?.pageCount ?? 0);
  const index = $derived(Math.min(current, Math.max(0, pageCount - 1)));
  const paper = $derived(resolvePaper(setup.page));
  const included = $derived(dataset ? includedCount(dataset) : 0);
  const info = $derived(result?.pages[index] ?? null);
  const caption = $derived.by(() => {
    if (!info) return '';
    const rows = info.rowEnd > info.rowStart
      ? info.rowEnd - info.rowStart === 1 ? `Row ${info.rowStart + 1}` : `Rows ${info.rowStart + 1}–${info.rowEnd}`
      : '';
    const part = (result?.bandCount ?? 1) > 1 ? `part ${info.band + 1}` : '';
    return [rows, part].filter(Boolean).join(', ');
  });
  /** Characters replaced with '?', as the pages they appear on and the characters themselves. */
  const replaced = $derived.by(() => {
    const warnings = result?.warnings ?? [];
    const chars = new Set<string>();
    for (const w of warnings) for (const c of w.replaced) chars.add(c);
    return { pages: warnings.map((w) => w.page), chars: [...chars] };
  });
  const canExport = $derived(!!dataset && !!result && !result.noRoom && !exporting);

  /** A file's name without its extension; '' for pasted cells. */
  function stem(ds: Dataset): string {
    if (ds.sourceName === 'Pasted cells') return '';
    return ds.sourceName.replace(/\.[^.]+$/, '');
  }

  function inputFor(ds: Dataset, s: Setup): BuildInput {
    return {
      columns: ds.columns,
      rows: ds.rows,
      included: ds.included,
      setup: s,
      ctx: { title: stem(ds), file: ds.sourceName, sheet: ds.activeSheet ?? '' },
    };
  }

  function fileName(ds: Dataset): string {
    const base = stem(ds) || 'spreadsheet';
    const sheet = ds.sheetNames && ds.sheetNames.length > 1 && ds.activeSheet ? ` (${ds.activeSheet})` : '';
    return `${base}${sheet}`.replace(/[\\/:*?"<>|]+/g, '-') + '.pdf';
  }

  // A different sheet starts on page 1; edits to the same sheet keep the page.
  let lastSource: unknown = null;
  $effect(() => {
    const source = dataset?.source ?? null;
    if (source !== lastSource) {
      lastSource = source;
      current = 0;
    }
  });

  // Debounced live preview. Only the synchronous reads (dataset, setup) are tracked; writes inside
  // the timeout do not re-trigger the effect. A build that finishes after its run was cleaned up is
  // discarded, so a slow, stale build can never overwrite a newer preview.
  $effect(() => {
    const ds = dataset;
    const s = $state.snapshot(setup) as Setup;
    if (!ds) {
      builtFrom = null;
      result = null;
      drawn = false;
      error = '';
      building = false;
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      error = '';
      building = true;
      try {
        const built = await buildTablePdf(inputFor(ds, s), fonts);
        if (cancelled) return;
        result = built;
        builtFrom = { ds, setup: JSON.stringify(s) };
      } catch (err) {
        if (!cancelled) error = errorMessage(err);
      } finally {
        if (!cancelled) building = false;
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  });

  // Track the stage width. The first measurement is immediate; later ones are debounced.
  $effect(() => {
    if (!panel || !stage) return;
    const el = stage;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const measure = () => {
      stageWidth = el.clientWidth;
    };
    const observer = new ResizeObserver(() => {
      if (untrack(() => stageWidth) === 0) return measure();
      clearTimeout(timer);
      timer = setTimeout(measure, 100);
    });
    observer.observe(panel);
    observer.observe(el);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  });

  // Draw the current page whenever the bytes, the page, or the width change. A newer render on the
  // same canvas cancels the older one inside renderPdfPageToCanvas, and a result for a cleaned-up
  // run is ignored, so stale bytes are never drawn.
  $effect(() => {
    const bytes = result?.bytes;
    const pageNumber = index + 1;
    const width = stageWidth;
    const el = canvas;
    if (!bytes || !el || width <= 0) {
      rendering = false;
      return;
    }
    let gone = false;
    rendering = true;
    // The canvas has a 1px border on each side.
    renderPdfPageToCanvas(bytes, el, { maxWidthPx: width - 2, page: pageNumber })
      .then(() => {
        if (!gone) drawn = true;
      })
      .catch((err) => {
        if (!gone && !isRenderCancelled(err)) error = errorMessage(err);
      })
      .finally(() => {
        if (!gone) rendering = false;
      });
    return () => {
      gone = true;
    };
  });

  // Release blob URLs when the component goes away.
  $effect(() => () => {
    if (lastPrintUrl) URL.revokeObjectURL(lastPrintUrl);
    for (const url of downloadUrls) URL.revokeObjectURL(url);
    downloadUrls.clear();
  });

  function step(delta: number) {
    if (pageCount === 0) return;
    current = Math.min(pageCount - 1, Math.max(0, index + delta));
  }

  /** Arrow keys, Home, and End step pages unless the user is typing somewhere or a dialog is open. */
  function onPageKeys(e: KeyboardEvent) {
    if (pageCount < 2 || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest('input, textarea, select, [contenteditable="true"], dialog[open], [role="listbox"]')) return;
    if (document.querySelector('dialog[open]')) return;
    let next: number;
    if (e.key === 'ArrowLeft') next = index - 1;
    else if (e.key === 'ArrowRight') next = index + 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = pageCount - 1;
    else return;
    e.preventDefault();
    current = Math.min(pageCount - 1, Math.max(0, next));
  }

  /** The PDF for the current inputs: the preview's when it is up to date, else a fresh build. */
  async function currentPdf(): Promise<TablePdf> {
    if (!dataset) throw new Error('Load a spreadsheet first.');
    const s = $state.snapshot(setup) as Setup;
    if (result && builtFrom && builtFrom.ds === dataset && builtFrom.setup === JSON.stringify(s)) return result;
    return buildTablePdf(inputFor(dataset, s), fonts);
  }

  function pdfUrl(bytes: Uint8Array): string {
    return URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  }

  async function download() {
    if (!canExport || !dataset) return;
    const name = fileName(dataset);
    exporting = true;
    error = '';
    let bytes: Uint8Array;
    try {
      bytes = (await currentPdf()).bytes;
    } catch (err) {
      error = errorMessage(err);
      return;
    } finally {
      exporting = false;
    }
    const url = pdfUrl(bytes);
    downloadUrls.add(url);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    // The browser reads the blob asynchronously; release it once the download has started.
    setTimeout(() => {
      URL.revokeObjectURL(url);
      downloadUrls.delete(url);
    }, 30_000);
  }

  /**
   * Phones and tablets have no print dialog for a PDF tab. There, Print draws the pages as images
   * in a new window and calls `window.print()`; the share sheet is the fallback for long sheets.
   */
  const touchDevice = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  function canShareFiles(file: File): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.share === 'function'
      && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  }
  function closeQuietly(win: Window) {
    try {
      win.close();
    } catch {
      // Already gone.
    }
  }
  const POPUP_BLOCKED = 'Your browser blocked the new tab. Allow pop-ups for this site and try again.';

  async function print() {
    if (!canExport || !dataset) return;
    const name = fileName(dataset);
    if (lastPrintUrl) {
      URL.revokeObjectURL(lastPrintUrl);
      lastPrintUrl = '';
    }
    error = '';
    printNote = '';
    // The print window must open now, inside the click, before anything awaits.
    const imagePrint = touchDevice && pageCount <= MAX_PRINT_PAGES;
    const printWin = imagePrint ? openPrintWindow() : null;
    if (imagePrint && !printWin) {
      error = POPUP_BLOCKED;
      return;
    }
    exporting = true;
    try {
      const bytes = (await currentPdf()).bytes;
      if (printWin) {
        try {
          const pages = await renderPdfPagesToDataUrls(bytes, { dpi: DEFAULT_PRINT_DPI, maxPages: MAX_PRINT_PAGES });
          fillPrintWindow(printWin, pages);
          return;
        } catch (err) {
          closeQuietly(printWin);
          if (!(err instanceof PrintTooLongError)) throw err;
        }
      }
      if (touchDevice) {
        printNote = `Sheets over ${MAX_PRINT_PAGES} pages print through the share sheet. Choose Print there, or use Download.`;
        const file = new File([bytes as BlobPart], name, { type: 'application/pdf' });
        if (canShareFiles(file)) {
          try {
            await navigator.share({ files: [file], title: name.replace(/\.pdf$/, '') });
          } catch (err) {
            // The user closed the sheet; that is not an error.
            if (!(err instanceof DOMException && err.name === 'AbortError')) throw err;
          }
          return;
        }
      }
      const url = pdfUrl(bytes);
      const win = window.open(url, '_blank');
      if (!win) {
        URL.revokeObjectURL(url);
        error = POPUP_BLOCKED;
      } else {
        // The new tab still needs the URL; it is revoked on the next print or on unmount.
        lastPrintUrl = url;
      }
    } catch (err) {
      error = errorMessage(err);
    } finally {
      exporting = false;
    }
  }

  const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
  const printLabel = $derived(pageCount > 0 ? `Print ${plural(pageCount, 'page', 'pages')}` : 'Print');
</script>

<svelte:window onkeydown={onPageKeys} />

<div class="preview rise" style="--i: 2" bind:this={panel}>
  <div class="preview-head">
    <div class="title-line">
      <Eye size={20} aria-hidden="true" />
      <h2 class="card-title">Preview</h2>
    </div>
    {#if building || rendering}
      <p class="updating" aria-live="polite"><LoaderCircle class="spin" size={18} aria-hidden="true" /><span class="updating-label">Updating preview…</span></p>
    {/if}
    {#if dataset && pageCount > 0}
      <span class="page-caption" title={caption || undefined}>
        {#if caption}<span class="caption-name muted">{caption}</span>{/if}
        <span class="caption-pos" aria-live="polite"><span class="sr-only">Page </span>{index + 1} of {pageCount}</span>
      </span>
    {/if}
  </div>

  <!-- The stage reserves the page's shape so the panel does not jump between renders. -->
  <!-- With several pages the preview is a keyboard-navigable carousel (arrow keys), so it takes focus. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="stage" bind:this={stage} style:aspect-ratio={`${paper.widthPt} / ${paper.heightPt}`}
    style:--page-ratio={paper.widthPt / paper.heightPt}
    role={pageCount > 1 ? 'region' : undefined}
    aria-roledescription={pageCount > 1 ? 'carousel' : undefined}
    tabindex={pageCount > 1 ? 0 : undefined}
    aria-label={pageCount > 1 ? 'Page preview. Use the left and right arrow keys to move through pages.' : undefined}>
    {#if dataset && result}
      <!-- ARIA allows any role on <canvas>; Svelte's rule treats it as interactive, which it is not here. -->
      <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
      <canvas bind:this={canvas} class:drawn role="img" aria-label="Page {index + 1} of {pageCount}"></canvas>
    {/if}
    <!-- The placeholder covers the stage until the first page is drawn (pdf.js loads on first use). -->
    {#if !(dataset && result && drawn)}
      <div class="blank">
        {#if dataset}
          <LoaderCircle class="spin blank-icon" size={40} strokeWidth={1.5} aria-hidden="true" />
          <p>Laying out your pages…</p>
        {:else}
          <FileText class="blank-icon" size={48} strokeWidth={1.25} aria-hidden="true" />
          <p>Load a spreadsheet to see your pages.</p>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Action bar: messages above, the page stepper at the left, Download then Print at the right. -->
  <div class="action-bar">
    {#if error}<p class="error message status-line" role="alert"><CircleAlert size={18} aria-hidden="true" /><span>{error}</span></p>{/if}
    {#if dataset && result}
      {#if result.noRoom}
        <p class="muted message status-line" aria-live="polite"><TriangleAlert size={18} aria-hidden="true" /><span>Margins leave no room to print.</span></p>
      {:else if result.tooSmall}
        <p class="muted message status-line" aria-live="polite"><TriangleAlert size={18} aria-hidden="true" /><span>This sheet needs more pages wide at the smallest readable size.</span></p>
      {/if}
      {#if replaced.pages.length > 0}
        <p class="muted message status-line" aria-live="polite"><TriangleAlert size={18} aria-hidden="true" /><span>Some characters are not in this font and were replaced with "?" on {replaced.pages.length === 1 ? 'page' : 'pages'} {replaced.pages.join(', ')}: {replaced.chars.join(' ')}</span></p>
      {/if}
    {/if}
    {#if dataset && included === 0}
      <p class="muted message status-line"><Info size={18} aria-hidden="true" /><span>No rows included. Choose rows with Edit.</span></p>
    {:else if dataset && included > LARGE_SHEET}
      <p class="muted message status-line"><Info size={18} aria-hidden="true" /><span>{plural(included, 'row', 'rows')}. Laying out the pages may take a moment.</span></p>
    {/if}
    {#if touchDevice && dataset}
      <p class="muted message status-line"><Info size={18} aria-hidden="true" /><span>On a phone or tablet, <strong>Print</strong> opens your device's print screen. For the PDF, use Download.</span></p>
    {/if}
    {#if printNote}
      <p class="muted message status-line" aria-live="polite"><Info size={18} aria-hidden="true" /><span>{printNote}</span></p>
    {/if}
    <div class="actions">
      {#if pageCount > 1}
        <div class="stepper" role="group" aria-label="Preview page">
          <button type="button" class="step" aria-label="Previous page" title="Previous page (←)" disabled={index === 0}
            onclick={() => step(-1)}><ChevronLeft size={18} aria-hidden="true" /></button>
          <button type="button" class="step" aria-label="Next page" title="Next page (→)" disabled={index >= pageCount - 1}
            onclick={() => step(1)}><ChevronRight size={18} aria-hidden="true" /></button>
        </div>
      {/if}
      <button class="btn btn-secondary btn-download" type="button" aria-label="Download PDF" disabled={!canExport} onclick={download}>
        <Download size={20} aria-hidden="true" />
        <span class="btn-label">Download PDF</span>
      </button>
      <button class="btn btn-primary" type="button" aria-label={printLabel} disabled={!canExport} onclick={print}>
        {#if exporting}<LoaderCircle class="spin" size={20} aria-hidden="true" />{:else}<Printer size={20} aria-hidden="true" />{/if}
        <span class="btn-label">{printLabel}</span>
        <span class="btn-label-short" aria-hidden="true">{pageCount > 0 ? `Print ${pageCount}` : 'Print'}</span>
      </button>
    </div>
  </div>
</div>

<style>
  .preview {
    --pad: 20px;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 16px;
    min-width: 0;
    overflow: hidden;
    padding: var(--pad);
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-float);
  }
  /* One row, always: the updating note comes and goes on every change, so the header never wraps. */
  .preview-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 24px; min-width: 0; }
  .preview-head > .title-line { flex: none; }
  .updating { flex: none; margin: 0; display: inline-flex; align-items: center; gap: 8px; font-size: 14px; color: var(--muted); }
  .page-caption { margin-left: auto; display: inline-flex; align-items: baseline; gap: 10px; min-width: 0; max-width: 300px; font-size: 14px; white-space: nowrap; }
  .caption-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .caption-pos { flex: none; font-weight: 600; font-variant-numeric: tabular-nums; }

  /* The page scales with the card but stops at a height that keeps the whole card on screen. */
  .stage {
    --stage-h: min(70vh, 640px);
    display: grid;
    place-items: center;
    width: 100%;
    justify-self: center;
    min-width: 0;
    max-width: min(100%, calc(var(--page-ratio, 0.77) * var(--stage-h)));
  }
  .stage:focus-visible { outline: 2px solid var(--text); outline-offset: 4px; border-radius: 6px; }
  /* Canvas and placeholder share the stage's one cell, so the placeholder can sit over a canvas still drawing. */
  .stage > * { grid-area: 1 / 1; }
  canvas, .blank {
    border: 1px solid var(--divider);
    border-radius: var(--radius-sm);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  }
  canvas {
    display: block;
    /* The inline size set by the renderer is the bitmap's CSS size; the border sits outside it. */
    box-sizing: content-box;
    max-width: calc(100% - 2px);
    /* Follow the bitmap's aspect when the stage narrows before the next render. */
    height: auto !important;
    background: white;
    visibility: hidden;
  }
  canvas.drawn { visibility: visible; }
  .blank {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 24px;
    background: var(--subtle);
  }
  .blank :global(.blank-icon) { color: var(--muted); opacity: 0.7; }
  .blank p { margin: 0; max-width: 28ch; text-align: center; font-size: 15px; color: var(--muted); }

  .action-bar { display: grid; gap: 12px; padding-top: 4px; }
  .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 12px; }
  .btn-label-short { display: none; }
  /* Page stepper at the bottom left, opposite the actions. */
  .actions .stepper { margin-right: auto; }
  .stepper { display: inline-flex; align-items: center; gap: 4px; flex: none; }
  .step { width: 40px; min-height: 40px; padding: 0; }
  .message { margin: 0; font-size: 14px; }
  .message strong { font-weight: 600; color: var(--text); }
  .message :global(.lucide-triangle-alert) { color: #b4690e; }
  :global(:root[data-theme='dark']) .message :global(.lucide-triangle-alert) { color: #f5b25b; }
  .message :global(.lucide-info) { color: var(--muted); }

  @media (min-width: 1180px) {
    .preview { --pad: 24px; }
    /* Wide: the sticky card must fit the window, so the page gives up height first. */
    .stage { --stage-h: min(max(320px, calc(100vh - 300px)), 760px); }
  }
  @media (max-width: 759px) {
    /* Phone: one row of buttons. Download is icon-only; Print takes the rest and may truncate. */
    .actions { flex-wrap: nowrap; gap: 8px; min-width: 0; }
    .actions > * { min-width: 0; }
    .actions .stepper { flex: none; margin-right: auto; }
    .actions .btn-download { flex: none; width: 48px; padding: 0; justify-content: center; }
    .actions .btn-download .btn-label { display: none; }
    .actions .btn-primary { flex: 1 1 0; min-width: 0; padding: 0 16px; }
    .actions .btn-primary .btn-label { display: none; }
    .actions .btn-primary .btn-label-short { display: inline; white-space: nowrap; }
  }
  @media (max-width: 480px) {
    /* Phone: the updating note is just the spinner; screen readers still hear the text. */
    .updating-label { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    .page-caption .caption-name { display: none; }
  }
</style>
