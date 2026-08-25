import { describe, expect, it } from 'bun:test';
import { render, screen } from '@testing-library/react';
import {
  attachmentHref,
  DocAttachments,
  fileUrl,
  htmlAttachmentUrl,
} from '@/features/docs/doc-attachments.tsx';
import { MAX_HTML_PREVIEW_BYTES } from '@/lib/docs/html-artifact.ts';
import type { Attachment } from '@/lib/query/schemas.ts';

function attachment(overrides: Partial<Attachment>): Attachment {
  return {
    id: 'att-1',
    parentType: 'doc',
    parentId: 'doc-1',
    fileName: 'report.html',
    contentType: 'text/html',
    size: 2048,
    storageKey: 'org-1/doc-1/report.html',
    status: 'ready',
    ...overrides,
  };
}

describe('doc attachments', () => {
  it('previews html through the sandboxed route and downloads it through the file route', () => {
    const html = attachment({});

    expect(htmlAttachmentUrl(html.storageKey)).toBe(
      '/api/attachments/html/org-1/doc-1/report.html',
    );
    expect(attachmentHref(html)).toBe(fileUrl(html.storageKey));
    expect(attachmentHref(html)).not.toBe(htmlAttachmentUrl(html.storageKey));
  });

  it('keeps a non-html attachment on the plain file route', () => {
    const pdf = attachment({ fileName: 'spec.pdf', contentType: 'application/pdf' });

    expect(attachmentHref(pdf)).toBe(fileUrl(pdf.storageKey));
  });

  it('treats an html content type carrying a charset as html', () => {
    const html = attachment({ contentType: 'text/html; charset=utf-8' });

    render(<DocAttachments attachments={[html]} />);

    expect(screen.getByTestId('html-attachment-preview').getAttribute('src')).toBe(
      htmlAttachmentUrl(html.storageKey),
    );
    expect(screen.getByRole('link', { name: 'report.html' }).getAttribute('href')).toBe(
      fileUrl(html.storageKey),
    );
  });

  it('renders an html attachment in a sandboxed frame', () => {
    render(<DocAttachments attachments={[attachment({})]} />);

    const frame = screen.getByTestId('html-attachment-preview');
    expect(frame.getAttribute('src')).toBe('/api/attachments/html/org-1/doc-1/report.html');
    expect(frame.getAttribute('sandbox')).toContain('allow-scripts');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(screen.getByRole('link', { name: 'report.html' }).getAttribute('href')).toBe(
      '/api/files/org-1/doc-1/report.html',
    );
  });

  it('keeps an oversized html attachment downloadable when its preview is refused', () => {
    render(<DocAttachments attachments={[attachment({ size: MAX_HTML_PREVIEW_BYTES + 1 })]} />);

    expect(screen.queryByTestId('html-attachment-preview')).toBeNull();
    expect(screen.getByText('HTML')).toBeDefined();
    expect(screen.getByRole('link', { name: 'report.html' }).getAttribute('href')).toBe(
      '/api/files/org-1/doc-1/report.html',
    );
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
