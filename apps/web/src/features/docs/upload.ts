import { z } from 'zod';
import { apiFetch } from '@/lib/query/fetcher.ts';
import { attachmentSchema } from '@/lib/query/schemas.ts';

const presignSchema = z.object({
  attachment: attachmentSchema,
  upload: z.object({
    key: z.string(),
    url: z.string(),
    method: z.literal('PUT'),
    headers: z.record(z.string(), z.string()),
  }),
});

const completeSchema = z.object({ attachment: attachmentSchema });

export interface UploadedFile {
  readonly fileName: string;
  readonly contentType: string;
  readonly url: string;
}

export async function uploadDocFile(docId: string, file: File): Promise<UploadedFile> {
  const contentType = file.type.length > 0 ? file.type : 'application/octet-stream';
  const presigned = await apiFetch('/api/attachments/presign', presignSchema, {
    method: 'POST',
    body: {
      fileName: file.name,
      contentType,
      size: file.size,
      parentType: 'doc',
      parentId: docId,
    },
  });

  const response = await fetch(presigned.upload.url, {
    method: presigned.upload.method,
    headers: { 'content-type': contentType },
    body: file,
  });
  if (!response.ok) throw new Error(`Uploading ${file.name} failed.`);

  await apiFetch(`/api/attachments/${presigned.attachment.id}/complete`, completeSchema, {
    method: 'POST',
  });

  return {
    fileName: file.name,
    contentType,
    url: `/api/files/${presigned.upload.key.split('/').map(encodeURIComponent).join('/')}`,
  };
}
