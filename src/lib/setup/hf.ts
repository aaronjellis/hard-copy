export type SlotKind = 'none' | 'title' | 'file' | 'sheet' | 'date' | 'time' | 'page' | 'pageOf' | 'text';

/** One header or footer position. `text` is used only by the `text` kind. */
export type Slot = { kind: SlotKind; text?: string };

/** Every slot kind, in menu order. */
export const SLOT_KINDS: readonly SlotKind[] = ['none', 'title', 'file', 'sheet', 'date', 'time', 'page', 'pageOf', 'text'];

export const SLOT_LABELS: Readonly<Record<SlotKind, string>> = Object.freeze({
  none: 'None',
  title: 'Title',
  file: 'File name',
  sheet: 'Sheet name',
  date: 'Date',
  time: 'Time',
  page: 'Page N',
  pageOf: 'Page N of M',
  text: 'Custom text',
});

/** What a slot can draw on. `now` and `locale` default to the current time and the user's locale. */
export type SlotContext = {
  title: string;
  file: string;
  sheet: string;
  page: number;
  pageCount: number;
  now?: Date;
  locale?: string | string[];
};

/** The text a slot shows on a page. */
export function resolveSlot(slot: Slot, ctx: SlotContext): string {
  switch (slot.kind) {
    case 'none':
      return '';
    case 'title':
      return ctx.title;
    case 'file':
      return ctx.file;
    case 'sheet':
      return ctx.sheet;
    case 'date':
      return new Intl.DateTimeFormat(ctx.locale, { dateStyle: 'medium' }).format(ctx.now ?? new Date());
    case 'time':
      return new Intl.DateTimeFormat(ctx.locale, { timeStyle: 'short' }).format(ctx.now ?? new Date());
    case 'page':
      return `Page ${ctx.page}`;
    case 'pageOf':
      return `Page ${ctx.page} of ${ctx.pageCount}`;
    case 'text':
      return slot.text ?? '';
  }
}
