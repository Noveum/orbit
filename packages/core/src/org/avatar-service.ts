import { db, eq, schema } from '@orbit/db';
import { requireRow } from '../internal.ts';
import type { UserRow } from './profile-service.ts';

const AVATAR_KEY_PREFIX = 'avatars';

export function avatarStorageKey(userId: string): string {
  return `${AVATAR_KEY_PREFIX}/${userId}`;
}

export function avatarPublicUrl(userId: string, version: number): string {
  return `/api/avatars/${encodeURIComponent(userId)}?v=${version}`;
}

export function isAvatarUrl(image: string | null): boolean {
  return (image ?? '').startsWith('/api/avatars/');
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
