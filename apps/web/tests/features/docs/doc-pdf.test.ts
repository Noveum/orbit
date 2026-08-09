import { describe, expect, it } from 'bun:test';
import { PDF_MARGIN, pdfDefinition, pdfFileName } from '@/features/docs/doc-pdf.ts';

describe('pdfFileName', () => {
  it('turns a title into a safe file name', () => {
    expect(pdfFileName('Voice / Audio Eval — Model & Cost Benchmark (final)')).toBe(
      'voice-audio-eval-model-cost-benchmark-final.pdf',
    );
  });

  it('falls back when a title has nothing usable in it', () => {
    expect(pdfFileName('///')).toBe('document.pdf');
    expect(pdfFileName('   ')).toBe('document.pdf');
  });

  it('keeps a very long title to a sane length', () => {
    const name = pdfFileName('a'.repeat(300));
    expect(name.length).toBeLessThanOrEqual(84);
    expect(name.endsWith('.pdf')).toBe(true);
  });
});

describe('pdfDefinition', () => {
  it('carries the title into the document metadata and onto the first page', () => {
    const definition = pdfDefinition('Realtime delta protocol', [], 'printed');
    expect(definition.info?.title).toBe('Realtime delta protocol');
    const content = definition.content as { text?: string }[];
    expect(content[0]?.text).toBe('Realtime delta protocol');
  });

  it('numbers every page in the footer', () => {
    const definition = pdfDefinition('Doc', [], 'printed');
    const footer = definition.footer as (page: number, pages: number) => { columns: unknown[] };
    const columns = footer(2, 7).columns as { text?: string }[];
    expect(columns[1]?.text).toBe('2 of 7');
  });

  it('leaves room for the running header and footer', () => {
    const definition = pdfDefinition('Doc', [], 'printed');
    const margins = definition.pageMargins as [number, number, number, number];
    expect(margins[0]).toBe(PDF_MARGIN);
    expect(margins[1]).toBeGreaterThan(PDF_MARGIN);
    expect(margins[3]).toBeGreaterThan(PDF_MARGIN);
  });
});
