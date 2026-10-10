import type { PDFWorker, RenderTask } from 'pdfjs-dist';

type PdfJs = typeof import('pdfjs-dist');
type Loaded = { pdfjs: PdfJs; worker: PDFWorker };

export type RenderPdfOptions = {
  /** CSS width of the rendered page, in pixels. */
  maxWidthPx: number;
  /** Device pixels per CSS pixel; defaults to `window.devicePixelRatio` (or 1). */
  devicePixelRatio?: number;
  /** 1-based page to draw, clamped to the document's pages; defaults to 1. */
  page?: number;
};

/** Thrown when a newer render for the same canvas superseded this one. */
export class RenderCancelledError extends Error {
  constructor() {
    super('The preview render was superseded by a newer one.');
    this.name = 'RenderCancelledError';
  }
}

export function isRenderCancelled(err: unknown): boolean {
  return err instanceof RenderCancelledError || (err instanceof Error && err.name === 'RenderingCancelledException');
}

let pdfjsPromise: Promise<Loaded> | null = null;

/**
 * pdf.js and its worker load on first use, in their own chunks. One worker is shared by every
 * render, so destroying a document after drawing it does not tear the worker down.
 */
function loadPdfJs(): Promise<Loaded> {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(
      ([pdfjs, workerUrl]) => {
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.default;
        return { pdfjs, worker: new pdfjs.PDFWorker() };
      },
    );
    pdfjsPromise.catch(() => {
      pdfjsPromise = null;
    });
  }
  return pdfjsPromise;
}

/** An opened document and how to release it. */
export type DocHandle<D> = { promise: Promise<D>; destroy(): Promise<void> | void };

export type DocCache<D> = {
  /** The open document for these bytes (by identity), opening it on a miss. Call `release` when done. */
  acquire(bytes: Uint8Array): Promise<{ doc: D; release(): void }>;
  /** Destroy every document; one still in use is destroyed when it is released. */
  clear(): void;
  /** Open documents, for tests. */
  readonly size: number;
};

/**
 * Open documents keyed by bytes identity, most recently used last, at most `max` of them. A
 * document in use is never destroyed under its user: eviction and `clear` wait for its release.
 */
export function createDocCache<D>(open: (bytes: Uint8Array) => DocHandle<D>, max = 4): DocCache<D> {
  type Entry = { handle: DocHandle<D>; uses: number; dropped: boolean };
  const entries = new Map<Uint8Array, Entry>();

  const destroy = (entry: Entry) => {
    void Promise.resolve()
      .then(() => entry.handle.destroy())
      .catch(() => {});
  };
  const drop = (bytes: Uint8Array, entry: Entry) => {
    if (entries.get(bytes) === entry) entries.delete(bytes);
    entry.dropped = true;
    if (entry.uses === 0) destroy(entry);
  };

  return {
    async acquire(bytes) {
      let entry = entries.get(bytes);
      if (entry) {
        entries.delete(bytes);
        entries.set(bytes, entry);
      } else {
        entry = { handle: open(bytes), uses: 0, dropped: false };
        entries.set(bytes, entry);
        for (const [b, e] of entries) {
          if (entries.size <= max) break;
          if (e !== entry) drop(b, e);
        }
      }
      const mine = entry;
      mine.uses++;
      let doc: D;
      try {
        doc = await mine.handle.promise;
      } catch (err) {
        mine.uses--;
        drop(bytes, mine);
        throw err;
      }
      let released = false;
      return {
        doc,
        release() {
          if (released) return;
          released = true;
          mine.uses--;
          if (mine.dropped && mine.uses === 0) destroy(mine);
        },
      };
    },
    clear() {
      for (const [b, e] of [...entries]) drop(b, e);
    },
    get size() {
      return entries.size;
    },
  };
}

type PdfDoc = Awaited<ReturnType<PdfJs['getDocument']>['promise']>;

/** The preview's open documents: stepping back to a page or resizing reuses the parsed document. */
const previewDocs = createDocCache<PdfDoc>((bytes) => {
  const ready = loadPdfJs().then(({ pdfjs, worker }) => {
    // pdf.js transfers the buffer to its worker, so hand it a copy.
    const loading = pdfjs.getDocument({ data: bytes.slice(), worker });
    return { loading, doc: loading.promise };
  });
  return {
    promise: ready.then((r) => r.doc),
    destroy: () => ready.then((r) => r.loading.destroy(), () => {}),
  };
});

/** Close every document the preview holds open, such as when the preview goes away. */
export function closePreviewDocuments(): void {
  previewDocs.clear();
}

type Pending = { task: RenderTask | null };
const pending = new WeakMap<HTMLCanvasElement, Pending>();

/**
 * Renders a page of a PDF (page 1 unless `opts.page` says otherwise) into `canvas`, `maxWidthPx` CSS pixels wide, at device resolution.
 * The page is drawn off screen first, so the canvas keeps its old picture until the new one is ready.
 * The parsed document is cached by bytes identity (see closePreviewDocuments), so redrawing the
 * same bytes at another width does not parse them again.
 * A newer call for the same canvas cancels this one, which then rejects with `RenderCancelledError`
 * (see `isRenderCancelled`). Resolves with the page size in PDF points.
 */
export async function renderPdfPageToCanvas(
  bytes: Uint8Array,
  canvas: HTMLCanvasElement,
  opts: RenderPdfOptions,
): Promise<{ widthPt: number; heightPt: number }> {
  const previous = pending.get(canvas);
  previous?.task?.cancel();
  const mine: Pending = { task: null };
  pending.set(canvas, mine);
  const current = () => pending.get(canvas) === mine;

  try {
    const { doc, release } = await previewDocs.acquire(bytes);
    try {
      if (!current()) throw new RenderCancelledError();
      const pageNumber = Math.min(doc.numPages, Math.max(1, Math.floor(opts.page ?? 1)));
      const page = await doc.getPage(pageNumber);
      if (!current()) throw new RenderCancelledError();

      const base = page.getViewport({ scale: 1 });
      const widthPt = base.width;
      const heightPt = base.height;
      const cssWidth = Math.max(1, opts.maxWidthPx);
      const cssHeight = (cssWidth * heightPt) / widthPt;
      const dpr = opts.devicePixelRatio ?? globalThis.devicePixelRatio ?? 1;
      const viewport = page.getViewport({ scale: (cssWidth / widthPt) * dpr });

      const scratch = document.createElement('canvas');
      scratch.width = Math.round(viewport.width);
      scratch.height = Math.round(viewport.height);
      const task = page.render({ canvas: scratch, viewport, background: '#ffffff' });
      mine.task = task;
      await task.promise;
      if (!current()) throw new RenderCancelledError();

      canvas.width = scratch.width;
      canvas.height = scratch.height;
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D drawing is not available in this browser.');
      ctx.drawImage(scratch, 0, 0);
      scratch.width = scratch.height = 0;
      return { widthPt, heightPt };
    } finally {
      release();
    }
  } finally {
    if (current()) pending.delete(canvas);
  }
}

export type OpenedPdf = {
  numPages: number;
  /** Every page's size in PDF points, without drawing. */
  pageSizes(): Promise<{ widthPt: number; heightPt: number }[]>;
  /**
   * Draws page `pageNumber` (1-based) onto a new off-screen canvas at `scale` device pixels per
   * PDF point. The caller owns the canvas. Resolves with the page size in PDF points.
   */
  renderPage(pageNumber: number, scale: number): Promise<{ canvas: HTMLCanvasElement; widthPt: number; heightPt: number }>;
  /** Releases the document. The shared worker stays up. */
  destroy(): Promise<void>;
};

/** Opens a PDF with pdf.js for page-by-page rendering, such as for printing. */
export async function openPdf(bytes: Uint8Array): Promise<OpenedPdf> {
  const { pdfjs, worker } = await loadPdfJs();
  // pdf.js transfers the buffer to its worker, so hand it a copy.
  const loading = pdfjs.getDocument({ data: bytes.slice(), worker });
  let doc;
  try {
    doc = await loading.promise;
  } catch (err) {
    await loading.destroy();
    throw err;
  }
  return {
    numPages: doc.numPages,
    async pageSizes() {
      const out: { widthPt: number; heightPt: number }[] = [];
      for (let n = 1; n <= doc.numPages; n++) {
        const { width, height } = (await doc.getPage(n)).getViewport({ scale: 1 });
        out.push({ widthPt: width, heightPt: height });
      }
      return out;
    },
    async renderPage(pageNumber, scale) {
      const page = await doc.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvas, viewport, background: '#ffffff' }).promise;
      page.cleanup();
      return { canvas, widthPt: base.width, heightPt: base.height };
    },
    destroy: () => loading.destroy(),
  };
}
