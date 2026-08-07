'use client';

import { useCallback, useRef } from 'react';
import { useToast } from '@/components/ui/toast.tsx';
import type { UploadedAttachment } from '@/features/docs/editor/rich-text-editor.tsx';
import { assertUploadable, uploadAttachment } from '@/features/docs/upload.ts';
import {
  attachPending,
  holdAttachment,
  type PendingAttachment,
  releasePending,
} from '@/features/issues/pending-attachments.ts';
import { messageOf } from '@/lib/query/fetcher.ts';

export interface CommentUploads {
  readonly hold: (file: File) => Promise<UploadedAttachment>;
  readonly upload: (commentId: string, file: File) => Promise<UploadedAttachment>;
  readonly settle: (commentId: string, body: string) => Promise<string | null>;
}

export function usePendingCommentFiles(): CommentUploads {
  const { toast } = useToast();
  const held = useRef<readonly PendingAttachment[]>([]);

  const refuse = useCallback(
    (error: unknown): Promise<never> => {
      const reason = messageOf(error);
      toast({ title: 'Could not attach that file', description: reason, tone: 'danger' });
      return Promise.reject(new Error(reason));
    },
    [toast],
  );

  const hold = useCallback(
    (file: File): Promise<UploadedAttachment> => {
      try {
        const contentType = assertUploadable(file);
        const entry = holdAttachment(file);
        held.current = [...held.current, entry];
        return Promise.resolve({ url: entry.placeholder, fileName: file.name, contentType });
      } catch (error: unknown) {
        return refuse(error);
      }
    },
    [refuse],
  );

  const upload = useCallback(
    async (commentId: string, file: File): Promise<UploadedAttachment> => {
      try {
        return await uploadAttachment('comment', commentId, file);
      } catch (error: unknown) {
        return await refuse(error);
      }
    },
    [refuse],
  );

  const settle = useCallback(
    async (commentId: string, body: string): Promise<string | null> => {
      const pending = held.current;
      held.current = [];
      if (pending.length === 0) return null;
      const outcome = await attachPending(
        body,
        pending,
        async (file) => await uploadAttachment('comment', commentId, file),
      );
      releasePending(pending);
      for (const failure of outcome.failures) {
        toast({
          title: `Could not attach ${failure.fileName}`,
          description: failure.reason,
          tone: 'danger',
        });
      }
      return outcome.rewritten === 0 ? null : outcome.description;
    },
    [toast],
  );

  return { hold, upload, settle };
}
