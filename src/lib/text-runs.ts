/** A piece of text in one face. Missing style flags mean false. */
export type TextRun = { text: string; bold?: boolean; italic?: boolean };

export type FaceStyle = { bold: boolean; italic: boolean };

/** The face a run needs, with both flags filled in. */
export function runStyle(run: TextRun): FaceStyle {
  return { bold: !!run.bold, italic: !!run.italic };
}

/** True when two runs use the same face (a missing flag equals false). */
export function sameStyle(a: TextRun, b: TextRun): boolean {
  return !!a.bold === !!b.bold && !!a.italic === !!b.italic;
}

/** A run with only true style flags present. */
function makeRun(text: string, style: { bold?: boolean; italic?: boolean }): TextRun {
  const run: TextRun = { text };
  if (style.bold) run.bold = true;
  if (style.italic) run.italic = true;
  return run;
}

/**
 * Concatenate run lists into one, merging neighbors with equal style and dropping empty runs.
 * Returns fresh runs with only true style flags; the inputs are not changed.
 */
export function mergeRuns(...parts: TextRun[][]): TextRun[] {
  const out: TextRun[] = [];
  for (const part of parts) {
    for (const r of part) {
      if (r.text === '') continue;
      const last = out[out.length - 1];
      if (last && sameStyle(last, r)) last.text += r.text;
      else out.push(makeRun(r.text, r));
    }
  }
  return out;
}
