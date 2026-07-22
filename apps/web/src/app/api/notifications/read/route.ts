import { db } from '@orbit/db';
import { markRead, unreadCount } from '@orbit/services/notifications';
import { notificationReadSchema } from '@orbit/shared/validators';
import { apiContext, handleRoute, readJson } from '@/lib/api/handler.ts';

export async function POST(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const parsed = notificationReadSchema.parse(await readJson(request));
    const updated = await markRead(db, {
      userId: principal.userId,
      organizationId: principal.organizationId,
      notificationIds: parsed.notificationIds,
      read: parsed.read,
    });
    return {
      updated,
      unreadCount: await unreadCount(db, principal.userId, principal.organizationId),
    };
  });
}
