import type { PDFFont } from 'pdf-lib';
import { mergeRuns, type TextRun } from '../text-runs';

export type SanitizeResult = { text: string; replaced: string[] };

/**
 * Normalize to NFC, then replace characters the font cannot encode with '?'.
 * Uses the font's character set, which covers both standard fonts and embedded fonts
 * (embedded fonts silently map missing characters to an empty glyph instead of throwing).
 */
export function sanitizeForFont(text: string, font: PDFFont): SanitizeResult {
  const supported = characterSet(font);
  const replaced: string[] = [];
  let out = '';
  for (const ch of text.normalize('NFC')) {
    if (supported.has(ch.codePointAt(0)!)) {
      out += ch;
    } else {
      out += '?';
      if (!replaced.includes(ch)) replaced.push(ch);
    }
  }
  return { text: out, replaced };
}

const characterSets = new WeakMap<PDFFont, Set<number>>();

function characterSet(font: PDFFont): Set<number> {
  let set = characterSets.get(font);
  if (!set) {
    set = new Set(font.getCharacterSet());
    characterSets.set(font, set);
  }
  return set;
}

/**
 * Break one line into pieces no wider than maxWidth points, using `measure` to get a
 * string's width in points. Text must already be sanitized.
 * A single character wider than maxWidth is still emitted on its own line.
 */
export function wrapLine(
  line: string,
  measure: (text: string) => number,
  maxWidth: number,
): string[] {
  if (line === '') return [''];
  const fits = (s: string) => measure(s) <= maxWidth;
  if (fits(line)) return [line];

  const out: string[] = [];
  let current = '';
  for (const word of line.split(' ')) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (fits(candidate)) {
      current = candidate;
      continue;
    }
    if (current !== '') out.push(current);
    if (fits(word)) {
      current = word;
    } else {
      // Word alone is too wide: break it by characters.
      current = '';
      for (const ch of word) {
        if (fits(current + ch)) current += ch;
        else {
          if (current !== '') out.push(current);
          current = ch;
        }
      }
    }
  }
  if (current !== '') out.push(current);
  return out;
}

/**
 * Break one line of styled runs into lines no wider than maxWidth points. `measureRun` gives a
 * run's width in points in its own face; a line's width is the sum of its runs. Breaks at spaces
 * like wrapLine; each word (and each space) keeps its run's style, and a word too wide on its own
 * breaks by characters. Runs must already be sanitized. Empty input gives one empty line.
 */
export function wrapRuns(
  runs: TextRun[],
  measureRun: (run: TextRun) => number,
  maxWidth: number,
): TextRun[][] {
  const line = mergeRuns(runs);
  if (line.length === 0) return [[]];
  const fits = (rs: TextRun[]) => rs.reduce((w, r) => w + measureRun(r), 0) <= maxWidth;
  if (fits(line)) return [line];

  // Split at spaces into words (pieces of styled runs) and the styled spaces between them.
  const words: TextRun[][] = [[]];
  const spaces: TextRun[] = [];
  for (const r of line) {
    for (const ch of r.text) {
      if (ch === ' ') {
        spaces.push({ ...r, text: ' ' });
        words.push([]);
      } else {
        words[words.length - 1] = mergeRuns(words[words.length - 1], [{ ...r, text: ch }]);
      }
    }
  }

  const out: TextRun[][] = [];
  let current: TextRun[] = [];
  words.forEach((word, i) => {
    const candidate = current.length === 0 ? word : mergeRuns(current, [spaces[i - 1]], word);
    if (fits(candidate)) {
      current = candidate;
      return;
    }
    if (current.length > 0) out.push(current);
    if (fits(word)) {
      current = word;
      return;
    }
    // Word alone is too wide: break it by characters.
    current = [];
    for (const r of word) {
      for (const ch of r.text) {
        const piece = [{ ...r, text: ch }];
        const next = mergeRuns(current, piece);
        if (fits(next)) current = next;
        else {
          if (current.length > 0) out.push(current);
          current = mergeRuns(piece);
        }
      }
    }
  });
  if (current.length > 0) out.push(current);
  return out;
}
