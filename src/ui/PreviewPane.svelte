<script lang="ts">
  import { untrack } from 'svelte';
  import { includedCount, type Dataset } from '../lib/sheet/import';
  import type { Setup } from '../lib/setup/setup';
  import { resolvePaper } from '../lib/setup/paper';
  import type { FontProvider } from '../lib/fonts/types';
  import { drawPages, prepareTable, type BuildInput, type PreparedTable, type TablePdf } from '../lib/table/build';
  import { createPreviewController } from '../lib/preview-controller';
  import { closePreviewDocuments, renderPdfPageToCanvas, isRenderCancelled } from '../lib/pdf/preview';
  import {
    PrintTooLongError, fillPrintWindow, maxImagePrintPages, openPrintWindow, renderPdfPagesToImages,
  } from '../lib/pdf/print-window';
  import {
    POPUP_BLOCKED, closeQuietly, downloadPdf, openPdfTab, pdfBlobUrl, pdfFileName, sharePdf, showPdfInTab, sourceStem,
  } from '../lib/export';
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
  const DEBOUNCE_MS = 300;

  /** What a layout depends on: the dataset (by identity) and the setup (by its JSON). */
  type Request = { ds: Dataset; setup: Setup; key: string };

  function inputFor(ds: Dataset, s: Setup): BuildInput {
    return {
      columns: ds.columns,
      rows: ds.rows,
      included: ds.included,
      setup: s,
      ctx: { title: sourceStem(ds), file: ds.sourceName, sheet: ds.activeSheet ?? '' },
    };
  }

  function requestFor(ds: Dataset, s: Setup): Request {
    const snap = $state.snapshot(s) as Setup;
    return { ds, setup: snap, key: JSON.stringify(snap) };
  }

  // Lays out once per (dataset, setup), one layout at a time; pages are drawn from the cached layout.
  const controller = createPreviewController<Request, PreparedTable, TablePdf>({
    prepare: (r) => prepareTable(inputFor(r.ds, r.setup), fonts),
    draw: drawPages,
    same: (a, b) => a.ds === b.ds && a.key === b.key,
  });
  let cstate = $state.raw(controller.state());
  const unsubscribe = controller.subscribe((s) => (cstate = s));

  /** Page the preview shows, from 0. */
  let current = $state(0);
  /** Export and render failures; layout failures come from the controller. */
  let error = $state('');
  /** Why Print took the share-sheet route on a phone; cleared on the next print. */
  let printNote = $state('');
  let rendering = $state(false);
  let exporting = $state<'print' | 'download' | null>(null);
  // True once the canvas holds a drawn page, so an empty canvas never shows.
  let drawn = $state(false);
  let stageWidth = $state(0);
  let panel = $state<HTMLDivElement>();
  let stage = $state<HTMLDivElement>();
  let canvas = $state<HTMLCanvasElement>();
  // The blob URL handed to the last print tab. Not reactive: only used for cleanup.
  let lastPrintUrl = '';

  /** The latest layout, only while it belongs to the loaded sheet; a new sheet shows the placeholder. */
  const prepared = $derived(
    dataset && cstate.prepared && cstate.input?.ds.source === dataset.source ? cstate.prepared : null,
  );
  const building = $derived(cstate.busy);
  const shownError = $derived(error || (cstate.error ? errorMessage(cstate.error) : ''));
  const pageCount = $derived(prepared?.pageCount ?? 0);
  const index = $derived(Math.min(current, Math.max(0, pageCount - 1)));
  const paper = $derived(resolvePaper(setup.page));
  const included = $derived(dataset ? includedCount(dataset) : 0);
  const info = $derived(prepared?.pages[index] ?? null);
  const caption = $derived.by(() => {
    if (!info) return '';
    const rows = info.rowEnd > info.rowStart
      ? info.rowEnd - info.rowStart === 1 ? `Printed row ${info.rowStart + 1}` : `Printed rows ${info.rowStart + 1}–${info.rowEnd}`
      : '';
    const part = (prepared?.bandCount ?? 1) > 1 ? `part ${info.band + 1}` : '';
    return [rows, part].filter(Boolean).join(', ');
  });
  /** Characters replaced with '?', as the pages they appear on and the characters themselves. */
  const replaced = $derived.by(() => {
    const warnings = prepared?.warnings ?? [];
    const chars = new Set<string>();
    for (const w of warnings) for (const c of w.replaced) chars.add(c);
    return { pages: warnings.map((w) => w.page), chars: [...chars] };
  });
  /** Why the sheet could not shrink to fit: how many pages it needs at the smallest readable size. */
  const tooSmallNote = $derived.by(() => {
    if (!prepared?.tooSmall) return '';
    const { bandCount, pagesTall } = prepared;
    const scale = prepared.input.setup.page.scale;
    const pages = (n: number) => plural(n, 'page', 'pages');
    const lead = 'At the smallest readable size, this sheet needs';
    if (scale.mode === 'fitPages') {
      const wide = bandCount > scale.wide;
      const tall = pagesTall > scale.tall;
      if (wide && tall) return `${lead} ${pages(bandCount)} wide by ${pagesTall.toLocaleString()} tall.`;
      if (tall) return `${lead} ${pages(pagesTall)} tall.`;
    }
    return `${lead} ${pages(bandCount)} wide.`;
  });
  const canExport = $derived(!!dataset && !!prepared && !prepared.noRoom && exporting === null);

  // A different sheet starts on page 1 with the placeholder; edits to the same sheet keep the page.
  let lastSource: unknown = null;
  $effect(() => {
    const source = dataset?.source ?? null;
    if (source !== lastSource) {
      lastSource = source;
      current = 0;
      drawn = false;
    }
  });

  // Debounced live preview. Only the synchronous reads (dataset, setup) are tracked. The controller
  // skips unchanged requests and never runs two layouts at once.
  $effect(() => {
    const ds = dataset;
    if (!ds) {
      controller.clear();
      error = '';
      return;
    }
    const req = requestFor(ds, setup);
    const timer = setTimeout(() => {
      const t0 = performance.now();
      controller.request(req).then(
        (p) => {
          if (import.meta.env.DEV && p) performance.measure('hc:layout', { start: t0, end: performance.now() });
        },
        () => {
          // Shown from the controller's state.
        },
      );
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
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

  // Draw the current page whenever the layout, the page, or the width change: only that page is
  // drawn (and cached per layout), and pdf.js keeps the parsed page open for resizes. A newer render
  // on the same canvas cancels the older one, and a cleaned-up run's result is ignored.
  $effect(() => {
    const p = prepared;
    const i = index;
    const width = stageWidth;
    const el = canvas;
    if (!p || !el || width <= 0) {
      rendering = false;
      return;
    }
    let gone = false;
    rendering = true;
    const t0 = performance.now();
    controller.page(p, i)
      // The canvas has a 1px border on each side.
      .then((pdf) => {
        if (import.meta.env.DEV) performance.measure('hc:draw', { start: t0, end: performance.now() });
        return gone ? null : renderPdfPageToCanvas(pdf.bytes, el, { maxWidthPx: width - 2 });
      })
      .then((size) => {
        if (gone || !size) return;
        drawn = true;
        if (import.meta.env.DEV) performance.measure('hc:page', { start: t0, end: performance.now() });
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

  // Stop the controller and release documents and blob URLs when the component goes away.
  $effect(() => () => {
    unsubscribe();
    controller.dispose();
    closePreviewDocuments();
    if (lastPrintUrl) URL.revokeObjectURL(lastPrintUrl);
  });

  function step(delta: number) {
    if (pageCount === 0) return;
    current = Math.min(pageCount - 1, Math.max(0, index + delta));
  }

  /** On the preview or its stepper: arrow keys step pages; Home and End go to the first and last. */
  function onPageKeys(e: KeyboardEvent) {
    if (pageCount < 2 || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    let next: number;
    if (e.key === 'ArrowLeft') next = index - 1;
    else if (e.key === 'ArrowRight') next = index + 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = pageCount - 1;
    else return;
    e.preventDefault();
    current = Math.min(pageCount - 1, Math.max(0, next));
  }

  /** The whole PDF for the current inputs, from the cached layout when nothing changed. */
  async function wholePdf(): Promise<TablePdf> {
    if (!dataset) throw new Error('Load a spreadsheet first.');
    const p = await controller.request(requestFor(dataset, setup));
    if (!p) throw new Error('Load a spreadsheet first.');
    return controller.all(p);
  }

  async function download() {
    if (!canExport || !dataset) return;
    const name = pdfFileName(dataset);
    exporting = 'download';
    error = '';
    try {
      downloadPdf((await wholePdf()).bytes, name);
    } catch (err) {
      error = errorMessage(err);
    } finally {
      exporting = null;
    }
  }

  /**
   * Phones and tablets have no print dialog for a PDF tab. There, Print draws the pages as images
   * in a new window and calls `window.print()`; the share sheet is the fallback for long sheets.
   * On desktop, Print opens the PDF in a new tab, opened at the click and filled once built.
   */
  const touchDevice = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

  async function print() {
    if (!canExport || !dataset || !prepared) return;
    const name = pdfFileName(dataset);
    if (lastPrintUrl) {
      URL.revokeObjectURL(lastPrintUrl);
      lastPrintUrl = '';
    }
    error = '';
    printNote = '';
    const first = prepared.layout.pages[0];
    const maxImagePages = maxImagePrintPages(first.widthPt, first.heightPt);
    // Any window must open now, inside the click, before anything awaits.
    const imagePrint = touchDevice && pageCount <= maxImagePages;
    const win = imagePrint ? openPrintWindow() : touchDevice ? null : openPdfTab();
    if (!win && (imagePrint || !touchDevice)) {
      error = POPUP_BLOCKED;
      return;
    }
    exporting = 'print';
    // Close the window unless it ends up showing the pages.
    let filled = false;
    try {
      const { bytes } = await wholePdf();
      if (win && !imagePrint) {
        lastPrintUrl = showPdfInTab(win, bytes);
        filled = true;
        return;
      }
      if (win) {
        try {
          fillPrintWindow(win, await renderPdfPagesToImages(bytes));
          filled = true;
          return;
        } catch (err) {
          if (!(err instanceof PrintTooLongError)) throw err;
        }
      }
      if (await sharePdf(bytes, name)) {
        printNote = `Sheets over ${plural(maxImagePages, 'page', 'pages')} this size print through the share sheet. Choose Print there, or use Download.`;
        return;
      }
      const url = pdfBlobUrl(bytes);
      if (!window.open(url, '_blank')) {
        URL.revokeObjectURL(url);
        error = POPUP_BLOCKED;
      } else {
        // The new tab still needs the URL; it is revoked on the next print or on unmount.
        lastPrintUrl = url;
      }
    } catch (err) {
      error = errorMessage(err);
    } finally {
      if (win && !filled) closeQuietly(win);
      exporting = null;
    }
  }

  const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
  const printLabel = $derived(pageCount > 0 ? `Print ${plural(pageCount, 'page', 'pages')}` : 'Print');
</script>

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
  <!-- With several pages the preview is a keyboard-navigable carousel (arrow keys, Home, End), so it takes focus;
       the keys work only while focus is on the preview or its stepper. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
  <div class="stage" bind:this={stage} style:aspect-ratio={`${paper.widthPt} / ${paper.heightPt}`}
    style:--page-ratio={paper.widthPt / paper.heightPt}
    role={pageCount > 1 ? 'region' : undefined}
    aria-roledescription={pageCount > 1 ? 'carousel' : undefined}
    tabindex={pageCount > 1 ? 0 : undefined}
    aria-label={pageCount > 1 ? 'Page preview. Use the arrow keys to move through pages, Home and End for the first and last.' : undefined}
    onkeydown={onPageKeys}>
    {#if dataset && prepared}
      <!-- ARIA allows any role on <canvas>; Svelte's rule treats it as interactive, which it is not here. -->
      <!-- svelte-ignore a11y_no_interactive_element_to_noninteractive_role -->
      <canvas bind:this={canvas} class:drawn role="img" aria-label="Page {index + 1} of {pageCount}"></canvas>
    {/if}
    <!-- The placeholder covers the stage until the first page is drawn (pdf.js loads on first use). -->
    {#if !(dataset && prepared && drawn)}
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
    {#if shownError}<p class="error message status-line" role="alert"><CircleAlert size={18} aria-hidden="true" /><span>{shownError}</span></p>{/if}
    {#if dataset && prepared}
      {#if prepared.noRoom}
        <p class="muted message status-line" aria-live="polite"><TriangleAlert size={18} aria-hidden="true" /><span>Margins leave no room to print.</span></p>
      {:else if tooSmallNote}
        <p class="muted message status-line" aria-live="polite"><TriangleAlert size={18} aria-hidden="true" /><span>{tooSmallNote}</span></p>
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
        <!-- aria-disabled, not disabled, so focus stays on a button at either end. -->
        <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
        <div class="stepper" role="group" aria-label="Preview page" onkeydown={onPageKeys}>
          <button type="button" class="step" aria-label="Previous page" title="Previous page (←)" aria-disabled={index === 0}
            onclick={() => step(-1)}><ChevronLeft size={18} aria-hidden="true" /></button>
          <button type="button" class="step" aria-label="Next page" title="Next page (→)" aria-disabled={index >= pageCount - 1}
            onclick={() => step(1)}><ChevronRight size={18} aria-hidden="true" /></button>
        </div>
      {/if}
      <button class="btn btn-secondary btn-download" type="button" aria-label="Download PDF" disabled={!canExport} onclick={download}>
        {#if exporting === 'download'}<LoaderCircle class="spin" size={20} aria-hidden="true" />{:else}<Download size={20} aria-hidden="true" />{/if}
        <span class="btn-label">Download PDF</span>
      </button>
      <button class="btn btn-primary" type="button" aria-label={printLabel} disabled={!canExport} onclick={print}>
        {#if exporting === 'print'}<LoaderCircle class="spin" size={20} aria-hidden="true" />{:else}<Printer size={20} aria-hidden="true" />{/if}
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
  /* As tall as a settings card's header (its 36px chevron), so the titles line up side by side in the wide tier. */
  .preview-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 36px; min-width: 0; }
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
  .step[aria-disabled='true'] { opacity: 0.45; cursor: not-allowed; }
  .step[aria-disabled='true']:hover { background: var(--surface); border-color: var(--line-control); }
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
