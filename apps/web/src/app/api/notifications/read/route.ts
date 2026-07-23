import { db } from '@orbit/db';
import { markRead, unreadCount } from '@orbit/services/notifications';
import { notificationReadSchema } from '@orbit/shared/validators';
import { apiContext, handleRoute, publish, readJson } from '@/lib/api/handler.ts';
import { notificationActions } from '../deltas.ts';

export async function POST(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const { principal, userName } = await apiContext();
    const parsed = notificationReadSchema.parse(await readJson(request));
    const updated = await markRead(db, {
      userId: principal.userId,
      organizationId: principal.organizationId,
      notificationIds: parsed.notificationIds,
      read: parsed.read,
    });
    await publish(notificationActions(principal, userName, 'update', updated));

    return {
      updated: updated.map((row) => row.id),
      unreadCount: await unreadCount(db, principal.userId, principal.organizationId),
    };
  });
}
