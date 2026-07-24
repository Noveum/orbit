import { avatarStorageKey } from '@orbit/core';
import { storageDriver } from '@orbit/services/storage';
import { avatarUploadSchema } from '@orbit/shared/validators';
import { handle, readJson } from '@/lib/api/handler.ts';

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  return await handle(async (principal) => {
    const { contentType } = avatarUploadSchema.parse(body);
    const key = avatarStorageKey(principal.userId);
    const target = await storageDriver().createUploadTarget(key, contentType);
    return { upload: target };
  });
}
