import { describe, expect, it } from 'bun:test';
import { render, screen } from '@testing-library/react';
import {
  attachmentHref,
  DocAttachments,
  fileUrl,
  htmlAttachmentUrl,
} from '../../../src/features/docs/doc-attachments.tsx';
import type { Attachment } from '../../../src/lib/query/schemas.ts';

function attachment(overrides: Partial<Attachment>): Attachment {
  return {
    id: 'att-1',
    fileName: 'report.html',
    contentType: 'text/html',
    size: 2048,
    storageKey: 'org-1/doc-1/report.html',
    status: 'ready',
    ...overrides,
  } as Attachment;
}

describe('doc attachments', () => {
  it('serves an html attachment through the sandboxed route, never the file route', () => {
    const html = attachment({});

    expect(htmlAttachmentUrl(html.storageKey)).toBe(
      '/api/attachments/html/org-1/doc-1/report.html',
    );
    expect(attachmentHref(html)).toBe(htmlAttachmentUrl(html.storageKey));
    expect(attachmentHref(html)).not.toBe(fileUrl(html.storageKey));
  });

  it('keeps a non-html attachment on the plain file route', () => {
    const pdf = attachment({ fileName: 'spec.pdf', contentType: 'application/pdf' });

    expect(attachmentHref(pdf)).toBe(fileUrl(pdf.storageKey));
  });

  it('treats an html content type carrying a charset as html', () => {
    const html = attachment({ contentType: 'text/html; charset=utf-8' });

    expect(attachmentHref(html)).toBe(htmlAttachmentUrl(html.storageKey));
  });

  it('renders an html attachment in a sandboxed frame', () => {
    render(<DocAttachments attachments={[attachment({})]} />);

    const frame = screen.getByTestId('html-attachment-preview');
    expect(frame.getAttribute('src')).toBe('/api/attachments/html/org-1/doc-1/report.html');
    expect(frame.getAttribute('sandbox')).toContain('allow-scripts');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
  });

  it('does not frame a non-html attachment', () => {
    render(
      <DocAttachments
        attachments={[attachment({ fileName: 'spec.pdf', contentType: 'application/pdf' })]}
      />,
    );

    expect(screen.queryByTestId('html-attachment-preview')).toBeNull();
  });
});
