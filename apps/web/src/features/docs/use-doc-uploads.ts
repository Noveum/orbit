'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { useToast } from '@/components/ui/toast.tsx';
import { messageOf } from '@/lib/query/fetcher.ts';
import { queryKeys } from '@/lib/query/keys.ts';
import type { UploadedAttachment } from './editor/rich-text-editor.tsx';
import { type UploadOptions, uploadDocFile } from './upload.ts';

export interface DocUploads {
  readonly uploading: boolean;
  readonly percent: number;
  readonly upload: (file: File, options?: UploadOptions) => Promise<UploadedAttachment>;
  readonly uploadEach: (
    files: readonly File[],
    onUploaded: (uploaded: UploadedAttachment) => void,
  ) => Promise<void>;
}

export function useDocUploads(docId: string): DocUploads {
  const { toast } = useToast();
  const client = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [percent, setPercent] = useState(0);

  const upload = useCallback(
    async (file: File, options: UploadOptions = {}): Promise<UploadedAttachment> => {
      try {
        const uploaded = await uploadDocFile(docId, file, options);
        await client.invalidateQueries({ queryKey: queryKeys.doc(docId) });
        return uploaded;
      } catch (error: unknown) {
        toast({ title: 'Upload failed', description: messageOf(error), tone: 'danger' });
        throw error;
      }
    },
    [client, docId, toast],
  );

  const uploadEach = useCallback(
    async (files: readonly File[], onUploaded: (uploaded: UploadedAttachment) => void) => {
      if (files.length === 0) return;
      setUploading(true);
      setPercent(0);
      try {
        for (const file of files) {
          onUploaded(
            await upload(file, {
              onProgress: ({ loaded, total }) =>
                setPercent(total === 0 ? 0 : Math.round((loaded / total) * 100)),
            }),
          );
        }
      } catch {
        return;
      } finally {
        setUploading(false);
      }
    },
    [upload],
  );

  return { uploading, percent, upload, uploadEach };
}
