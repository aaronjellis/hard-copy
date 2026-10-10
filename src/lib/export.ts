import type { Dataset } from './sheet/import';

/** Download and Print helpers: file names, blob URLs, tabs, and the share sheet. */

export const POPUP_BLOCKED = 'Your browser blocked the new tab. Allow pop-ups for this site and try again.';
/** How long a download's blob URL lives; the browser reads it asynchronously. */
const DOWNLOAD_URL_LIFETIME_MS = 30_000;

/** The new tab's content while the PDF is built. */
const TAB_SHELL_HTML = '<!doctype html><title>Preparing PDF…</title>'
  + '<body style="margin:0"><p style="font:16px system-ui;padding:16px">Preparing your PDF…</p></body>';

/** A file's name without its extension; '' for pasted cells. */
export function sourceStem(ds: Pick<Dataset, 'sourceName'>): string {
  if (ds.sourceName === 'Pasted cells') return '';
  return ds.sourceName.replace(/\.[^.]+$/, '');
}

/** The PDF's file name: the source's stem (or "spreadsheet"), plus the sheet for multi-sheet workbooks. */
export function pdfFileName(ds: Pick<Dataset, 'sourceName' | 'sheetNames' | 'activeSheet'>): string {
  const base = sourceStem(ds) || 'spreadsheet';
  const sheet = ds.sheetNames && ds.sheetNames.length > 1 && ds.activeSheet ? ` (${ds.activeSheet})` : '';
  return `${base}${sheet}`.replace(/[\\/:*?"<>|]+/g, '-') + '.pdf';
}

export function pdfBlobUrl(bytes: Uint8Array): string {
  return URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
}

/** Save the PDF as `name` through a temporary link. */
export function downloadPdf(bytes: Uint8Array, name: string): void {
  const url = pdfBlobUrl(bytes);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_LIFETIME_MS);
}

/**
 * Open a blank tab with a "Preparing" message, for the PDF to load into once it is built. Call it
 * directly in the click handler, before any `await`, or pop-up blockers refuse it. Null when blocked.
 */
export function openPdfTab(): Window | null {
  if (typeof window === 'undefined' || typeof window.open !== 'function') return null;
  const win = window.open('about:blank', '_blank');
  if (!win) return null;
  try {
    win.document.open();
    win.document.write(TAB_SHELL_HTML);
    win.document.close();
  } catch {
    // Only the message is lost.
  }
  return win;
}

/**
 * Load the PDF into a tab from openPdfTab. Returns the blob URL, which the caller revokes later
 * (the tab still reads it), or '' when the user already closed the tab.
 */
export function showPdfInTab(win: Window, bytes: Uint8Array): string {
  if (win.closed) return '';
  const url = pdfBlobUrl(bytes);
  try {
    win.location.href = url;
    win.focus();
  } catch {
    URL.revokeObjectURL(url);
    return '';
  }
  return url;
}

export function closeQuietly(win: Window | null): void {
  try {
    win?.close();
  } catch {
    // Already gone.
  }
}

export function canShareFiles(file: File): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function'
    && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
}

/**
 * Offer the PDF to the system share sheet. True when the sheet opened (closing it is not an error);
 * false when this browser cannot share files. Other failures throw.
 */
export async function sharePdf(bytes: Uint8Array, name: string): Promise<boolean> {
  const file = new File([bytes as BlobPart], name, { type: 'application/pdf' });
  if (!canShareFiles(file)) return false;
  try {
    await navigator.share({ files: [file], title: name.replace(/\.pdf$/, '') });
  } catch (err) {
    if (!(err instanceof DOMException && err.name === 'AbortError')) throw err;
  }
  return true;
}
