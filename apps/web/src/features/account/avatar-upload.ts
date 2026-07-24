import { AVATAR_CONTENT_TYPE } from '@orbit/shared/constants';
import { z } from 'zod';
import { apiRequest } from '@/lib/api/client.ts';

const presignSchema = z.object({
  upload: z.object({
    url: z.string(),
    method: z.literal('PUT'),
    headers: z.record(z.string(), z.string()),
  }),
});

const avatarSchema = z.object({ user: z.object({ image: z.string().nullable() }) });

async function putBlob(
  url: string,
  headers: Readonly<Record<string, string>>,
  blob: Blob,
): Promise<void> {
  const response = await fetch(url, { method: 'PUT', headers, body: blob });
  if (!response.ok) {
    throw new Error(`Uploading your photo failed with status ${response.status}.`);
  }
}

export async function uploadAvatar(blob: Blob): Promise<string | null> {
  const contentType = blob.type.length > 0 ? blob.type : AVATAR_CONTENT_TYPE;
  const presigned = presignSchema.parse(
    await apiRequest('/api/account/avatar/presign', {
      method: 'POST',
      body: { contentType, size: blob.size },
    }),
  );

  await putBlob(presigned.upload.url, presigned.upload.headers, blob);

  const saved = avatarSchema.parse(await apiRequest('/api/account/avatar', { method: 'POST' }));
  return saved.user.image;
}

export async function removeAvatar(): Promise<string | null> {
  const cleared = avatarSchema.parse(await apiRequest('/api/account/avatar', { method: 'DELETE' }));
  return cleared.user.image;
}
