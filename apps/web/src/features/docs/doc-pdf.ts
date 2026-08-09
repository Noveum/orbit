'use client';

import type { TDocumentDefinitions } from 'pdfmake/interfaces';

export const PDF_MARGIN = 48;

export interface PdfDocument {
  readonly title: string;
  readonly markdown: string;
  readonly origin: string;
}

export function pdfDefinition(
  title: string,
  body: unknown,
  printedOn: string,
): TDocumentDefinitions {
  return {
    info: { title },
    pageSize: 'A4',
    pageMargins: [PDF_MARGIN, PDF_MARGIN + 16, PDF_MARGIN, PDF_MARGIN + 16],
    defaultStyle: { fontSize: 10.5, lineHeight: 1.4, color: '#1c1f27' },
    header: () => ({
      text: title,
      margin: [PDF_MARGIN, 20, PDF_MARGIN, 0],
      fontSize: 8,
      color: '#8a8f98',
    }),
    footer: (page: number, pages: number) => ({
      columns: [
        { text: printedOn, fontSize: 8, color: '#8a8f98' },
        { text: `${page} of ${pages}`, alignment: 'right', fontSize: 8, color: '#8a8f98' },
      ],
      margin: [PDF_MARGIN, 12, PDF_MARGIN, 0],
    }),
    content: [
      { text: title, fontSize: 20, bold: true, margin: [0, 0, 0, 14], color: '#0d0f14' },
      body as TDocumentDefinitions['content'],
    ],
  };
}

export async function downloadPdf({ title, markdown, origin }: PdfDocument): Promise<void> {
  const [{ default: htmlToPdfmake }, pdfMakeModule, { renderMarkdown }] = await Promise.all([
    import('html-to-pdfmake'),
    import('pdfmake/build/pdfmake'),
    import('@orbit/services/markdown'),
  ]);
  const fonts = await import('pdfmake/build/vfs_fonts');

  const pdfMake = (pdfMakeModule as { default?: unknown }).default ?? pdfMakeModule;
  const vfs: unknown = (fonts as unknown as { default?: unknown; vfs?: unknown }).default ?? fonts;
  Object.assign(pdfMake as Record<string, unknown>, { vfs });

  const body: unknown = htmlToPdfmake(renderMarkdown(markdown), {
    window,
    defaultStyles: {
      h1: { fontSize: 16, bold: true, marginBottom: 6, marginTop: 14 },
      h2: { fontSize: 14, bold: true, marginBottom: 5, marginTop: 12 },
      h3: { fontSize: 12, bold: true, marginBottom: 4, marginTop: 10 },
      p: { margin: [0, 0, 0, 8] },
      li: { margin: [0, 0, 0, 3] },
      pre: { fontSize: 9, background: '#f0f1f4', margin: [0, 4, 0, 10] },
      code: { fontSize: 9, background: '#f0f1f4' },
      table: { marginBottom: 10, fontSize: 9 },
      th: { bold: true, fillColor: '#eef0f3', margin: [0, 3, 0, 3] },
      td: { margin: [0, 3, 0, 3] },
      a: { color: '#2f6feb', decoration: 'underline' },
      blockquote: { italics: true, color: '#4b5060', margin: [10, 4, 0, 10] },
      img: { margin: [0, 6, 0, 6] },
    },
  });

  const printedOn = `${title} · ${origin}`;
  const definition = pdfDefinition(title, body, printedOn);
  (pdfMake as { createPdf: (d: TDocumentDefinitions) => { download: (n: string) => void } })
    .createPdf(definition)
    .download(pdfFileName(title));
}

export function pdfFileName(title: string): string {
  const stem = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${stem.length === 0 ? 'document' : stem}.pdf`;
}
