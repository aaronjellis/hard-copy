import { openPdf } from './preview';

/**
 * Phones and tablets show no print dialog for a PDF opened in a tab, but `window.print()` on an
 * HTML page opens the system print screen. So on those devices each PDF page is drawn to an
 * image, written into a new window sized with `@page`, and printed from there.
 */

/** One page drawn as an image: an object URL (see revokePrintPages) and its paper size. */
export type PrintPage = { url: string; widthIn: number; heightIn: number };

export const DEFAULT_PRINT_DPI = 150;
/** Most image area printed at once, in megapixels: 60 pages of 1.5 MP. Letter at 150 DPI is 2.1 MP a page. */
export const MAX_PRINT_MEGAPIXELS = 60 * 1.5;
/** How long page images outlive a print screen that never reports closing. */
export const PRINT_URL_LIFETIME_MS = 60_000;

/** Megapixels of one page `widthPt` × `heightPt` points drawn at `dpi`. */
export function pageMegapixels(widthPt: number, heightPt: number, dpi = DEFAULT_PRINT_DPI): number {
  return ((widthPt / 72) * dpi * (heightPt / 72) * dpi) / 1e6;
}

/** The most pages of this size the image print path draws at `dpi` (at least 1). */
export function maxImagePrintPages(widthPt: number, heightPt: number, dpi = DEFAULT_PRINT_DPI): number {
  return Math.max(1, Math.floor(MAX_PRINT_MEGAPIXELS / pageMegapixels(widthPt, heightPt, dpi)));
}

/** The new window's content while the PDF is built and drawn. */
export const PRINT_SHELL_HTML =
  '<!doctype html><title>Printing…</title>'
  + '<style>html,body{margin:0}@page{margin:0} .p{display:block;page-break-after:always;break-after:page} .p:last-child{page-break-after:auto}</style>'
  + '<body><p class="wait" style="font:16px system-ui;padding:16px">Preparing your pages…</p></body>';

/** Thrown when a PDF has more page area than the image print path handles (`max` pages of its size). */
export class PrintTooLongError extends Error {
  constructor(readonly pages: number, readonly max: number) {
    super(`This PDF has ${pages} pages. Printing from a phone or tablet handles up to ${max} pages this size at a time.`);
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

/** Revoke the object URLs of drawn pages. */
export function revokePrintPages(pages: PrintPage[]): void {
  for (const page of pages) URL.revokeObjectURL(page.url);
}

/**
 * Replaces the "Preparing" message with one image per page and opens the print screen once every
 * image has loaded. The window stays open afterward: closing it automatically misbehaves on iOS.
 * The page images are revoked after printing (`afterprint`) or after PRINT_URL_LIFETIME_MS,
 * whichever comes first, or at once if the window is already gone. Never throws.
 */
export function fillPrintWindow(win: Window, pages: PrintPage[]): void {
  let revoked = false;
  const revoke = () => {
    if (revoked) return;
    revoked = true;
    revokePrintPages(pages);
  };
  try {
    if (win.closed || pages.length === 0) return revoke();
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
      img.src = page.url;
      doc.body.appendChild(img);
    }
    setTimeout(revoke, PRINT_URL_LIFETIME_MS);

    void Promise.all(loads).then(() => {
      try {
        if (win.closed) return revoke();
        win.addEventListener('afterprint', revoke, { once: true });
        win.focus();
        win.print();
      } catch {
        // The window went away between loading and printing.
        revoke();
      }
    });
  } catch {
    // The user closed the window, or the browser revoked access to it.
    revoke();
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('This browser could not draw the page as an image.'))), 'image/png');
  });
}

/**
 * Draws every page of a PDF to a PNG object URL at `dpi`. Throws `PrintTooLongError` before
 * drawing anything when the pages' total area at `dpi` is over `maxMegapixels`. The caller owns
 * the URLs (fillPrintWindow revokes them; otherwise call revokePrintPages).
 */
export async function renderPdfPagesToImages(
  bytes: Uint8Array,
  opts: { dpi?: number; maxMegapixels?: number } = {},
): Promise<PrintPage[]> {
  const dpi = opts.dpi ?? DEFAULT_PRINT_DPI;
  const maxMegapixels = opts.maxMegapixels ?? MAX_PRINT_MEGAPIXELS;
  const pdf = await openPdf(bytes);
  const pages: PrintPage[] = [];
  try {
    const sizes = await pdf.pageSizes();
    const total = sizes.reduce((sum, s) => sum + pageMegapixels(s.widthPt, s.heightPt, dpi), 0);
    if (total > maxMegapixels) {
      const first = sizes[0];
      throw new PrintTooLongError(pdf.numPages, Math.max(1, Math.floor(maxMegapixels / pageMegapixels(first.widthPt, first.heightPt, dpi))));
    }
    for (let n = 1; n <= pdf.numPages; n++) {
      const { canvas, widthPt, heightPt } = await pdf.renderPage(n, dpi / 72);
      try {
        pages.push({ url: URL.createObjectURL(await canvasToBlob(canvas)), widthIn: widthPt / 72, heightIn: heightPt / 72 });
      } finally {
        canvas.width = canvas.height = 0;
      }
    }
    return pages;
  } catch (err) {
    revokePrintPages(pages);
    throw err;
  } finally {
    await pdf.destroy();
  }
}
