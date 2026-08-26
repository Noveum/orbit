'use client';

import { formatBytes } from '@orbit/shared/utils';
import { FileText, Paperclip } from 'lucide-react';
import { cn } from '@/lib/cn.ts';
import {
  HTML_IFRAME_SANDBOX,
  isHtmlAttachment,
  MAX_HTML_PREVIEW_BYTES,
} from '@/lib/docs/html-artifact.ts';
import { cardHover } from '@/lib/interaction.ts';
import type { Attachment } from '@/lib/query/schemas.ts';

function encodeStorageKey(storageKey: string): string {
  return storageKey.split('/').map(encodeURIComponent).join('/');
}

export function fileUrl(storageKey: string): string {
  return `/api/files/${encodeStorageKey(storageKey)}`;
}

export function htmlAttachmentUrl(storageKey: string): string {
  return `/api/attachments/html/${encodeStorageKey(storageKey)}`;
}

export function attachmentHref(attachment: Attachment): string {
  return fileUrl(attachment.storageKey);
}

function kindOf(contentType: string): 'image' | 'video' | 'audio' | 'pdf' | 'html' | 'other' {
  if (isHtmlAttachment(contentType)) return 'html';
  if (contentType.startsWith('image/')) return 'image';
  if (contentType.startsWith('video/')) return 'video';
  if (contentType.startsWith('audio/')) return 'audio';
  if (contentType === 'application/pdf') return 'pdf';
  return 'other';
}

function Preview({ attachment }: { attachment: Attachment }) {
  const url = fileUrl(attachment.storageKey);
  const kind = kindOf(attachment.contentType);

  if (kind === 'image') {
    return (
      // biome-ignore lint/performance/noImgElement: uploads are served by our own file route, not the Next image optimizer
      <img
        src={url}
        alt={attachment.fileName}
        className="h-32 w-full rounded-t-lg bg-surface-2 object-cover"
      />
    );
  }
  if (kind === 'video') {
    return (
      <video src={url} controls className="h-32 w-full rounded-t-lg bg-surface-2 object-contain">
        <track kind="captions" />
      </video>
    );
  }
  if (kind === 'html' && attachment.size <= MAX_HTML_PREVIEW_BYTES) {
    return (
      <iframe
        src={htmlAttachmentUrl(attachment.storageKey)}
        title={attachment.fileName}
        sandbox={HTML_IFRAME_SANDBOX}
        loading="lazy"
        className="h-32 w-full rounded-t-lg border-0 bg-surface-2"
        data-testid="html-attachment-preview"
      />
    );
  }
  if (kind === 'audio') {
    return (
      <div className="flex h-32 items-center justify-center rounded-t-lg bg-surface-2 px-3">
        <audio src={url} controls className="w-full">
          <track kind="captions" />
        </audio>
      </div>
    );
  }
  let label = 'File';
  if (kind === 'pdf') label = 'PDF';
  if (kind === 'html') label = 'HTML';
  return (
    <div className="flex h-32 items-center justify-center rounded-t-lg bg-surface-2">
      <span className="flex flex-col items-center gap-1.5 text-faint">
        {kind === 'pdf' || kind === 'html' ? (
          <FileText className="size-6" aria-hidden="true" strokeWidth={1.5} />
        ) : (
          <Paperclip className="size-6" aria-hidden="true" strokeWidth={1.5} />
        )}
        <span className="font-medium font-mono text-2xs uppercase tracking-wide">{label}</span>
      </span>
    </div>
  );
}

export interface AttachmentGalleryProps {
  readonly attachments: readonly Attachment[];
  readonly title?: string;
}

export function AttachmentGallery({ attachments, title = 'Attachments' }: AttachmentGalleryProps) {
  const ready = attachments.filter((attachment) => attachment.status === 'ready');
  if (ready.length === 0) return null;

  return (
    <section className="mt-10" data-testid="doc-attachments">
      <h2 className="mb-3 font-medium text-2xs text-faint uppercase tracking-wide">{title}</h2>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ready.map((attachment) => (
          <li
            key={attachment.id}
            className={cn('overflow-hidden rounded-lg border border-border bg-surface', cardHover)}
          >
            <Preview attachment={attachment} />
            <div className="flex items-baseline justify-between gap-2 border-border border-t px-3 py-2">
              <a
                href={attachmentHref(attachment)}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 truncate text-dense text-text hover:text-accent"
              >
                {attachment.fileName}
              </a>
              <span className="flex shrink-0 items-baseline gap-2">
                {kindOf(attachment.contentType) === 'html' &&
                attachment.size <= MAX_HTML_PREVIEW_BYTES ? (
                  <a
                    href={htmlAttachmentUrl(attachment.storageKey)}
                    target="_blank"
                    rel="noreferrer"
                    data-testid="html-attachment-open"
                    className="text-2xs text-muted hover:text-accent"
                  >
                    Open
                  </a>
                ) : null}
                <span data-numeric className="text-2xs text-faint">
                  {formatBytes(attachment.size)}
                </span>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
