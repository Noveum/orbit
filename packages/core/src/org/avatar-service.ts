import { db, eq, schema } from '@orbit/db';
import { type StorageDriver, storageDriver } from '@orbit/services/storage';
import { AVATAR_MAX_BYTES } from '@orbit/shared/constants';
import { requireRow } from '../internal.ts';
import type { UserRow } from './profile-service.ts';

const AVATAR_KEY_PREFIX = 'avatars';
const EXTERNAL_FETCH_TIMEOUT_MS = 10_000;

export function avatarStorageKey(userId: string): string {
  return `${AVATAR_KEY_PREFIX}/${userId}`;
}

export function avatarPublicUrl(userId: string, version: number): string {
  return `/api/avatars/${encodeURIComponent(userId)}?v=${version}`;
}

export function isAvatarUrl(image: string | null): boolean {
  return (image ?? '').startsWith('/api/avatars/');
}

export function isExternalImageUrl(image: string | null): image is string {
  return image !== null && image.length > 0 && !isAvatarUrl(image);
}

async function setImage(userId: string, image: string | null): Promise<UserRow> {
  const [updated] = await db
    .update(schema.user)
    .set({ image, updatedAt: new Date() })
    .where(eq(schema.user.id, userId))
    .returning();
  return requireRow(updated, 'That account does not exist.');
}

export async function saveAvatar(userId: string, at: Date = new Date()): Promise<UserRow> {
  return await setImage(userId, avatarPublicUrl(userId, at.getTime()));
}

export async function clearAvatar(userId: string): Promise<UserRow> {
  return await setImage(userId, null);
}

export async function ingestExternalAvatar(
  userId: string,
  sourceUrl: string,
  driver: StorageDriver = storageDriver(),
): Promise<boolean> {
  try {
    const response = await fetch(sourceUrl, {
      signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const contentType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';
    if (!contentType.startsWith('image/')) throw new Error(`not an image (${contentType})`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > AVATAR_MAX_BYTES) {
      throw new Error(`unusable size ${bytes.byteLength}`);
    }
    await driver.put(avatarStorageKey(userId), bytes, contentType);
    await saveAvatar(userId);
    return true;
  } catch {
    await clearAvatar(userId).catch(() => undefined);
    return false;
  }
}
