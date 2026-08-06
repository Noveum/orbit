import type { UploadedFile } from '@/features/docs/upload.ts';
import { messageOf } from '@/lib/query/fetcher.ts';

export interface PendingAttachment {
  readonly placeholder: string;
  readonly file: File;
}

export interface PendingFailure {
  readonly fileName: string;
  readonly reason: string;
}

export interface PendingOutcome {
  readonly description: string;
  readonly attached: number;
  readonly failures: readonly PendingFailure[];
}

export function holdAttachment(file: File): PendingAttachment {
  return { placeholder: URL.createObjectURL(file), file };
}

export function releasePending(pending: readonly PendingAttachment[]): void {
  for (const entry of pending) URL.revokeObjectURL(entry.placeholder);
}

export function rewritePlaceholder(markdown: string, placeholder: string, url: string): string {
  return markdown.split(placeholder).join(url);
}

export async function attachPending(
  description: string,
  pending: readonly PendingAttachment[],
  upload: (file: File) => Promise<UploadedFile>,
): Promise<PendingOutcome> {
  let body = description;
  let attached = 0;
  const failures: PendingFailure[] = [];

  for (const entry of pending) {
    try {
      const uploaded = await upload(entry.file);
      body = rewritePlaceholder(body, entry.placeholder, uploaded.url);
      attached += 1;
    } catch (error: unknown) {
      failures.push({ fileName: entry.file.name, reason: messageOf(error) });
    }
  }

  return { description: body, attached, failures };
}
