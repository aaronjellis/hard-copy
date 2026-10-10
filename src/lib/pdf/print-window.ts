import { openPdf } from './preview';

/**
 * Phones and tablets show no print dialog for a PDF opened in a tab, but `window.print()` on an
 * HTML page opens the system print screen. So on those devices each PDF page is drawn to an
 * image, written into a new window sized with `@page`, and printed from there.
 */

export type PrintPage = { dataUrl: string; widthIn: number; heightIn: number };

export const DEFAULT_PRINT_DPI = 200;
export const MAX_PRINT_PAGES = 60;

/** The new window's content while the PDF is built and drawn. */
export const PRINT_SHELL_HTML =
  '<!doctype html><title>Printing…</title>'
  + '<style>html,body{margin:0}@page{margin:0} .p{display:block;page-break-after:always;break-after:page} .p:last-child{page-break-after:auto}</style>'
  + '<body><p class="wait" style="font:16px system-ui;padding:16px">Preparing your pages…</p></body>';

/** Thrown when a PDF has more pages than the image print path handles. */
export class PrintTooLongError extends Error {
  constructor(readonly pages: number, readonly max: number) {
    super(`This PDF has ${pages} pages. Printing from a phone or tablet handles up to ${max} at a time.`);
    this.name = 'PrintTooLongError';
  }
}

/** An inch length for CSS, rounded to 4 decimals so 297 pt reads as `4.125in`. */
export function formatInches(inches: number): string {
  return `${Number(inches.toFixed(4))}in`;
}

/** The `@page` rule that sizes every printed page to the paper with no margin. */
export function pageSizeCss(widthIn: number, heightIn: number): string {
  return `@page { size: ${formatInches(widthIn)} ${formatInches(heightIn)}; margin: 0 }`;
}

/**
 * Opens a blank window with a "Preparing" message. Call it directly in the click handler,
 * before any `await`, or pop-up blockers refuse it. Returns null when the window was blocked.
 */
export function openPrintWindow(): Window | null {
  if (typeof window === 'undefined' || typeof window.open !== 'function') return null;
  const win = window.open('about:blank', '_blank');
  if (!win) return null;
  try {
    win.document.open();
    win.document.write(PRINT_SHELL_HTML);
    win.document.close();
  } catch {
    // The page still fills in later; a failed write only loses the "Preparing" message.
  }
  return win;
}

/**
 * Replaces the "Preparing" message with one image per page and opens the print screen once every
 * image has loaded. The window stays open afterward: closing it automatically misbehaves on iOS.
 * Never throws, even if the user closed the window.
 */
export function fillPrintWindow(win: Window, pages: PrintPage[]): void {
  try {
    if (win.closed || pages.length === 0) return;
    const doc = win.document;
    const { widthIn, heightIn } = pages[0];
    const style = doc.createElement('style');
    style.textContent = pageSizeCss(widthIn, heightIn);
    doc.head.appendChild(style);
    doc.querySelector('.wait')?.remove();

    const loads: Promise<void>[] = [];
    for (const page of pages) {
      const img = doc.createElement('img');
      img.className = 'p';
      img.alt = '';
      img.style.width = formatInches(widthIn);
      img.style.height = formatInches(heightIn);
      loads.push(new Promise<void>((resolve) => {
        img.onload = img.onerror = () => resolve();
      }));
      img.src = page.dataUrl;
      doc.body.appendChild(img);
    }

    void Promise.all(loads).then(() => {
      try {
        if (win.closed) return;
        win.focus();
        win.print();
      } catch {
        // The window went away between loading and printing.
      }
    });
  } catch {
    // The user closed the window, or the browser revoked access to it.
  }
}

/**
 * Draws every page of a PDF to a PNG data URL at `dpi`. Throws `PrintTooLongError` before
 * drawing anything when the PDF has more than `maxPages` pages.
 */
export async function renderPdfPagesToDataUrls(
  bytes: Uint8Array,
  opts: { dpi?: number; maxPages?: number } = {},
): Promise<PrintPage[]> {
  const dpi = opts.dpi ?? DEFAULT_PRINT_DPI;
  const maxPages = opts.maxPages ?? MAX_PRINT_PAGES;
  const pdf = await openPdf(bytes);
  try {
    if (pdf.numPages > maxPages) throw new PrintTooLongError(pdf.numPages, maxPages);
    const pages: PrintPage[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const { canvas, widthPt, heightPt } = await pdf.renderPage(n, dpi / 72);
      pages.push({ dataUrl: canvas.toDataURL('image/png'), widthIn: widthPt / 72, heightIn: heightPt / 72 });
      canvas.width = canvas.height = 0;
    }
    return pages;
  } finally {
    await pdf.destroy();
  }
}
