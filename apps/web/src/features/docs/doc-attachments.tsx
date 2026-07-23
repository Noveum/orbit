'use client';

import { formatBytes } from '@orbit/shared/utils';
import { FileText, Paperclip } from 'lucide-react';
import type { Attachment } from '@/lib/query/schemas.ts';

export function fileUrl(storageKey: string): string {
  return `/api/files/${storageKey.split('/').map(encodeURIComponent).join('/')}`;
}

function kindOf(contentType: string): 'image' | 'video' | 'audio' | 'pdf' | 'other' {
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
  if (kind === 'audio') {
    return (
      <div className="flex h-32 items-center justify-center rounded-t-lg bg-surface-2 px-3">
        <audio src={url} controls className="w-full">
          <track kind="captions" />
        </audio>
      </div>
    );
  }
  return (
    <div className="flex h-32 items-center justify-center rounded-t-lg bg-surface-2">
      <span className="flex flex-col items-center gap-1.5 text-faint">
        {kind === 'pdf' ? (
          <FileText className="size-6" aria-hidden="true" strokeWidth={1.5} />
        ) : (
          <Paperclip className="size-6" aria-hidden="true" strokeWidth={1.5} />
        )}
        <span className="font-medium font-mono text-2xs uppercase tracking-wide">
          {kind === 'pdf' ? 'PDF' : 'File'}
        </span>
      </span>
    </div>
  );
}

export interface DocAttachmentsProps {
  readonly attachments: readonly Attachment[];
}

export function DocAttachments({ attachments }: DocAttachmentsProps) {
  const ready = attachments.filter((attachment) => attachment.status === 'ready');
  if (ready.length === 0) return null;

  return (
    <section className="mt-10" data-testid="doc-attachments">
      <h2 className="mb-3 font-medium text-2xs text-faint uppercase tracking-wide">Attachments</h2>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ready.map((attachment) => (
          <li
            key={attachment.id}
            className="overflow-hidden rounded-lg border border-border bg-surface"
          >
            <Preview attachment={attachment} />
            <div className="flex items-baseline justify-between gap-2 border-border border-t px-3 py-2">
              <a
                href={fileUrl(attachment.storageKey)}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 truncate text-dense text-text hover:text-accent"
              >
                {attachment.fileName}
              </a>
              <span data-numeric className="shrink-0 text-2xs text-faint">
                {formatBytes(attachment.size)}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
