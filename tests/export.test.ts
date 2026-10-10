import { describe, it, expect } from 'vitest';
import { openPdfTab, pdfFileName, sourceStem } from '../src/lib/export';

describe('export helpers', () => {
  it('names the PDF after the file, without its extension', () => {
    expect(sourceStem({ sourceName: 'roster.xlsx' })).toBe('roster');
    expect(pdfFileName({ sourceName: 'roster.csv' })).toBe('roster.pdf');
  });

  it('names pasted cells "spreadsheet"', () => {
    expect(sourceStem({ sourceName: 'Pasted cells' })).toBe('');
    expect(pdfFileName({ sourceName: 'Pasted cells' })).toBe('spreadsheet.pdf');
  });

  it('adds the sheet for workbooks with several sheets, and replaces unsafe characters', () => {
    expect(pdfFileName({ sourceName: 'book.xlsx', sheetNames: ['A/B', 'C'], activeSheet: 'A/B' })).toBe('book (A-B).pdf');
    expect(pdfFileName({ sourceName: 'book.xlsx', sheetNames: ['Only'], activeSheet: 'Only' })).toBe('book.pdf');
  });

  it('opens no tab outside a browser', () => {
    expect(openPdfTab()).toBeNull();
  });
});
