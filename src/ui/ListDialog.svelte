<script lang="ts">
  import { tick } from 'svelte';
  import type { Dataset } from '../lib/sheet/import';
  import DataPanel from './DataPanel.svelte';
  import X from '@lucide/svelte/icons/x';

  /*
   * Load and edit the spreadsheet in a native modal dialog, the same pattern as AboutDialog:
   * Escape closes natively; a backdrop click, the X, and Done close it too. Focus returns to
   * whichever control opened it. It sits outside any form, so Enter here never submits.
   */
  let { dataset, onchange, fallbackFocus }: {
    dataset: Dataset | null;
    onchange: (ds: Dataset | null) => void;
    /** Where focus goes on close when the opener is gone, such as Edit after Remove. */
    fallbackFocus?: () => HTMLElement | null | undefined;
  } = $props();

  let dialog = $state<HTMLDialogElement>();
  let body = $state<HTMLDivElement>();
  let panel = $state<ReturnType<typeof DataPanel>>();
  let opener: HTMLElement | null = null;
  let pressedOnBackdrop = false;

  /** Open the dialog; `paste` opens it straight to the paste box. */
  export async function open(trigger?: HTMLElement, opts: { paste?: boolean } = {}) {
    if (!dialog || dialog.open) return;
    opener = trigger ?? (document.activeElement as HTMLElement | null);
    document.documentElement.classList.add('dialog-open');
    if (body) body.scrollTop = 0;
    dialog.showModal();
    if (opts.paste) {
      await panel?.openPaste();
    } else if (!dataset) {
      // With nothing loaded, start on the drop zone rather than the close button.
      await tick();
      body?.querySelector<HTMLButtonElement>('.drop')?.focus();
    }
  }

  /** Load a file dropped outside the dialog. Resolves with the error message, or '' on success. */
  export function loadFile(file: File): Promise<string> {
    return panel ? panel.loadFile(file) : Promise.resolve('');
  }

  /** Switch to another sheet of the loaded workbook. */
  export function chooseSheet(name: string) {
    panel?.chooseSheet(name);
  }

  /** Drop the spreadsheet, cancelling any load still in flight. */
  export function remove() {
    if (panel) panel.remove();
    else onchange(null);
  }

  function close() {
    dialog?.close();
  }

  function onclose() {
    document.documentElement.classList.remove('dialog-open');
    panel?.settle();
    if (opener?.isConnected) opener.focus();
    else fallbackFocus?.()?.focus();
    opener = null;
  }

  // The dialog box has no padding of its own, so a hit on the <dialog> element itself is the backdrop.
  // Require the press to start there too, so a text selection dragged out of the box doesn't close it.
  function onpointerdown(e: PointerEvent) {
    pressedOnBackdrop = e.target === dialog;
  }
  function onclick(e: MouseEvent) {
    if (pressedOnBackdrop && e.target === dialog) close();
    pressedOnBackdrop = false;
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<dialog bind:this={dialog} class="list-dialog" aria-labelledby="list-dialog-title" {onclose} {onpointerdown} {onclick}>
  <div class="head">
    <h2 id="list-dialog-title">Your spreadsheet</h2>
    <button type="button" class="close" aria-label="Close" onclick={close}><X size={20} aria-hidden="true" /></button>
  </div>
  <div class="body" bind:this={body}>
    <DataPanel bind:this={panel} {dataset} {onchange} />
  </div>
  <div class="foot">
    <p class="summary" aria-live="polite">
      {#if dataset}
        {dataset.rows.length} {dataset.rows.length === 1 ? 'row' : 'rows'} · {dataset.columns.length}
        {dataset.columns.length === 1 ? 'column' : 'columns'}
      {:else}
        No spreadsheet loaded
      {/if}
    </p>
    <button type="button" class="primary done" onclick={close}>Done</button>
  </div>
</dialog>

<style>
  .list-dialog {
    width: calc(100% - 32px);
    max-width: 880px;
    max-height: 85vh;
    padding: 0;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-lg);
    background: var(--surface);
    color: var(--text-soft);
    box-shadow: var(--shadow-float);
    overflow: hidden;
  }
  .list-dialog[open] { display: flex; flex-direction: column; }
  .list-dialog::backdrop { background: rgba(0, 0, 0, 0.4); }

  .head { display: flex; align-items: center; gap: 12px; padding: 16px 12px 0 24px; }
  h2 { flex: 1; margin: 0; font-size: 22px; line-height: 1.3; color: var(--text); }
  .close {
    width: 40px;
    padding: 0;
    border-color: transparent;
    background: var(--surface);
    color: var(--muted);
  }
  .close:hover:not(:disabled) { background: var(--subtle); border-color: transparent; color: var(--text); }
  :global(:root[data-theme='dark']) .close:hover:not(:disabled) { background: var(--hover); }

  /*
   * Only the panel scrolls; the title and the Done row stay put. The body is a flex column so the
   * list table (DataPanel.svelte) can give up height first, and the body scrolls only if even the
   * table's minimum does not fit.
   */
  .body {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 16px 24px 20px;
  }

  /* One row: on a narrow phone the summary wraps inside itself rather than pushing Done down. */
  .foot {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 12px 16px;
    padding: 14px 24px;
    border-top: 1px solid var(--divider);
  }
  .summary { flex: 1 1 auto; min-width: 0; margin: 0; font-size: 14px; color: var(--muted); }
  .done { flex: none; min-width: 96px; }

  @media (max-width: 480px) {
    .head { padding-left: 16px; }
    .body { padding: 12px 16px 16px; }
    .foot { padding: 12px 16px; }
  }
</style>
