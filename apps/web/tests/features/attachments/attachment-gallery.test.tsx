import { describe, expect, it } from 'bun:test';
import { render, screen } from '@testing-library/react';
import {
  AttachmentGallery,
  attachmentHref,
  fileUrl,
  htmlAttachmentUrl,
} from '@/features/attachments/attachment-gallery.tsx';
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

describe('attachment gallery', () => {
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

    render(<AttachmentGallery attachments={[html]} />);

    expect(screen.getByTestId('html-attachment-preview').getAttribute('src')).toBe(
      htmlAttachmentUrl(html.storageKey),
    );
    expect(screen.getByRole('link', { name: 'report.html' }).getAttribute('href')).toBe(
      fileUrl(html.storageKey),
    );
  });

  it('renders an html attachment in a sandboxed frame', () => {
    render(<AttachmentGallery attachments={[attachment({})]} />);

    const frame = screen.getByTestId('html-attachment-preview');
    expect(frame.getAttribute('src')).toBe('/api/attachments/html/org-1/doc-1/report.html');
    expect(frame.getAttribute('sandbox')).toContain('allow-scripts');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(screen.getByRole('link', { name: 'report.html' }).getAttribute('href')).toBe(
      '/api/files/org-1/doc-1/report.html',
    );
  });

  it('keeps an oversized html attachment downloadable when its preview is refused', () => {
    render(<AttachmentGallery attachments={[attachment({ size: MAX_HTML_PREVIEW_BYTES + 1 })]} />);

    expect(screen.queryByTestId('html-attachment-preview')).toBeNull();
    expect(screen.getByText('HTML')).toBeDefined();
    expect(screen.getByRole('link', { name: 'report.html' }).getAttribute('href')).toBe(
      '/api/files/org-1/doc-1/report.html',
    );
  });

  it('does not frame a non-html attachment', () => {
    render(
      <AttachmentGallery
        attachments={[attachment({ fileName: 'spec.pdf', contentType: 'application/pdf' })]}
      />,
    );

    expect(screen.queryByTestId('html-attachment-preview')).toBeNull();
  });

  it('opens an html attachment full size through the sandboxed route', () => {
    render(<AttachmentGallery attachments={[attachment({})]} />);

    const open = screen.getByTestId('html-attachment-open');
    expect(open.getAttribute('href')).toBe(htmlAttachmentUrl('org-1/doc-1/report.html'));
    expect(open.getAttribute('target')).toBe('_blank');
  });

  it('offers no full size link for an html attachment too large to preview', () => {
    render(<AttachmentGallery attachments={[attachment({ size: MAX_HTML_PREVIEW_BYTES + 1 })]} />);

    expect(screen.queryByTestId('html-attachment-open')).toBeNull();
  });

  it('offers no full size link for a file that is not html', () => {
    render(
      <AttachmentGallery
        attachments={[attachment({ fileName: 'spec.pdf', contentType: 'application/pdf' })]}
      />,
    );

    expect(screen.queryByTestId('html-attachment-open')).toBeNull();
  });

  it('carries a caller supplied heading, so an issue can label its own files', () => {
    render(<AttachmentGallery attachments={[attachment({})]} title="Artifacts" />);

    expect(screen.getByText('Artifacts')).toBeDefined();
  });
});
