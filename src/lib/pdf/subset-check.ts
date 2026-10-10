import type { BoundingBox, Font, Glyph } from '@pdf-lib/fontkit';

/**
 * Characters checked for every font in addition to the document's own text, so the verdict
 * does not hinge on which few glyphs the first render happened to use.
 */
const PROBE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789 .,-';

const verdicts = new WeakMap<Uint8Array, Promise<boolean>>();
const sources = new WeakMap<Uint8Array, Promise<Uint8Array | null>>();

/**
 * The bytes to embed as a subset: the font itself when it subsets cleanly, a copy with its glyphs
 * padded (see padGlyphs) when that repairs the subset, or null when the font must be embedded
 * whole. Cached per bytes (by identity), so the same copy is returned every time.
 */
export function subsetSource(fontBytes: Uint8Array, text: string): Promise<Uint8Array | null> {
  let p = sources.get(fontBytes);
  if (!p) {
    p = (async () => {
      if (await canSubsetSafely(fontBytes, text)) return fontBytes;
      const padded = padGlyphs(fontBytes);
      return padded && (await canSubsetSafely(padded, text)) ? padded : null;
    })();
    sources.set(fontBytes, p);
  }
  return p;
}

/**
 * True when fontkit's subsetter (the one pdf-lib uses for `embedFont(…, { subset: true })`)
 * reproduces this font's glyph outlines faithfully. Some TrueType fonts, such as Lobster, come
 * out with corrupt `glyf` data that renders as almost nothing (see padGlyphs for why).
 *
 * Builds a subset of `text` plus a fixed probe string, re-parses it, and compares each included
 * glyph's path command count and bounding box with the original. Any mismatch or error is false.
 * The verdict is cached per bytes (by identity), computed from the first text seen.
 */
export function canSubsetSafely(fontBytes: Uint8Array, text: string): Promise<boolean> {
  let p = verdicts.get(fontBytes);
  if (!p) {
    p = check(fontBytes, `${text}${PROBE}`).catch(() => false);
    verdicts.set(fontBytes, p);
  }
  return p;
}

async function check(bytes: Uint8Array, text: string): Promise<boolean> {
  const fontkit = (await import('@pdf-lib/fontkit')).default;
  const font = fontkit.create(bytes);
  const subset = font.createSubset();
  const originals = new Map<number, Glyph>();
  for (const glyph of font.layout(text).glyphs) originals.set(subset.includeGlyph(glyph), glyph);

  const copy = fontkit.create(await encode(subset));
  for (const [id, original] of originals) {
    if (!sameOutline(original, copy.getGlyph(id))) return false;
  }
  return true;
}

/** Serializes a subset the same way pdf-lib's CustomFontSubsetEmbedder does. */
function encode(subset: ReturnType<Font['createSubset']>): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const parts: Uint8Array[] = [];
    const stream = subset.encodeStream() as unknown as {
      on(event: 'data', cb: (bytes: Uint8Array) => void): typeof stream;
      on(event: 'end', cb: () => void): typeof stream;
      on(event: 'error', cb: (err: unknown) => void): typeof stream;
    };
    stream
      .on('data', (bytes) => parts.push(bytes))
      .on('end', () => resolve(concat(parts)))
      .on('error', reject);
  });
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** fontkit's Path has `commands` at runtime, but its typings omit it. */
const commandCount = (glyph: Glyph) => (glyph.path as unknown as { commands: unknown[] }).commands.length;

function sameOutline(a: Glyph, b: Glyph): boolean {
  return commandCount(a) === commandCount(b) && sameBox(a.bbox, b.bbox);
}

function sameBox(a: BoundingBox, b: BoundingBox): boolean {
  return Object.is(a.minX, b.minX) && Object.is(a.minY, b.minY) && Object.is(a.maxX, b.maxX) && Object.is(a.maxY, b.maxY);
}

const tag = (bytes: Uint8Array, at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
const align4 = (n: number) => (n + 3) & ~3;

/**
 * A copy of a TrueType font with every glyph padded to a multiple of 4 bytes and a long `loca`,
 * or null when the font needs no padding or is not a plain TrueType file.
 *
 * Why: fontkit copies each glyph's bytes into the subset as is, then switches the subset to a
 * short `loca` when it is under 64 KB. Short `loca` stores offsets divided by 2, so every glyph
 * that follows an odd-length glyph starts one byte early and decodes as garbage. Fonts like
 * Lobster store glyphs unpadded (legal with a long `loca`), which triggers this.
 */
export function padGlyphs(bytes: Uint8Array): Uint8Array | null {
  try {
    return pad(bytes);
  } catch {
    return null;
  }
}

function pad(bytes: Uint8Array): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(0);
  if (version !== 0x00010000 && version !== 0x74727565 /* 'true' */) return null;

  const numTables = view.getUint16(4);
  const records = Array.from({ length: numTables }, (_, i) => {
    const at = 12 + 16 * i;
    return { tag: tag(bytes, at), offset: view.getUint32(at + 8), length: view.getUint32(at + 12) };
  });
  const find = (name: string) => records.find((r) => r.tag === name);
  const head = find('head'), loca = find('loca'), glyf = find('glyf'), maxp = find('maxp');
  if (!head || !loca || !glyf || !maxp) return null;
  for (const r of records) if (r.offset + r.length > bytes.length) return null;

  const longLoca = view.getInt16(head.offset + 50) === 1;
  const numGlyphs = view.getUint16(maxp.offset + 4);
  const offsets = Array.from({ length: numGlyphs + 1 }, (_, i) =>
    longLoca ? view.getUint32(loca.offset + 4 * i) : view.getUint16(loca.offset + 2 * i) * 2,
  );
  const lengths = offsets.slice(1).map((end, i) => end - offsets[i]);
  if (lengths.some((n) => n < 0) || offsets[numGlyphs] > glyf.length) return null;
  if (lengths.every((n) => n % 2 === 0)) return null;

  const newGlyf = new Uint8Array(lengths.reduce((n, len) => n + align4(len), 0));
  const newLoca = new Uint8Array(4 * (numGlyphs + 1));
  const locaView = new DataView(newLoca.buffer);
  let pos = 0;
  lengths.forEach((len, i) => {
    locaView.setUint32(4 * i, pos);
    const start = glyf.offset + offsets[i];
    newGlyf.set(bytes.subarray(start, start + len), pos);
    pos += align4(len);
  });
  locaView.setUint32(4 * numGlyphs, pos);

  const newHead = bytes.slice(head.offset, head.offset + head.length);
  const headView = new DataView(newHead.buffer);
  headView.setUint32(8, 0); // checkSumAdjustment, recomputed below
  headView.setInt16(50, 1); // indexToLocFormat: long

  const data = records.map((r) =>
    r === glyf ? newGlyf : r === loca ? newLoca : r === head ? newHead : bytes.subarray(r.offset, r.offset + r.length),
  );
  const dirSize = 12 + 16 * numTables;
  const out = new Uint8Array(dirSize + data.reduce((n, d) => n + align4(d.length), 0));
  const outView = new DataView(out.buffer);
  out.set(bytes.subarray(0, 12));
  let headAt = 0;
  pos = dirSize;
  records.forEach((r, i) => {
    const at = 12 + 16 * i;
    out.set(bytes.subarray(at, at + 4), at);
    outView.setUint32(at + 4, checksum(data[i]));
    outView.setUint32(at + 8, pos);
    outView.setUint32(at + 12, data[i].length);
    out.set(data[i], pos);
    if (r === head) headAt = pos;
    pos += align4(data[i].length);
  });
  outView.setUint32(headAt + 8, (0xb1b0afba - checksum(out)) >>> 0);
  return out;
}

/** The OpenType checksum: the sum of the data as big-endian uint32s, zero-padded. */
function checksum(data: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    sum = (sum + (((data[i] << 24) | ((data[i + 1] ?? 0) << 16) | ((data[i + 2] ?? 0) << 8) | (data[i + 3] ?? 0)) >>> 0)) >>> 0;
  }
  return sum;
}
