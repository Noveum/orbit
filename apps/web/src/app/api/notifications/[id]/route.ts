import { db } from '@orbit/db';
import { dismissNotification, snooze, unreadCount } from '@orbit/services/notifications';
import { z } from 'zod';
import { apiContext, handleRoute, publish, readJson } from '@/lib/api/handler.ts';
import { notificationActions } from '../deltas.ts';

interface RouteParams {
  readonly params: Promise<{ id: string }>;
}

const snoozeRequestSchema = z.object({
  snoozeHours: z.number().int().min(1).max(720).default(24),
});

export async function PATCH(request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal, userName } = await apiContext();
    const { id } = await params;
    const parsed = snoozeRequestSchema.parse(await readJson(request));
    const record = await snooze(db, {
      userId: principal.userId,
      organizationId: principal.organizationId,
      notificationId: id,
      until: new Date(Date.now() + parsed.snoozeHours * 3_600_000),
    });
    await publish(notificationActions(principal, userName, 'update', [record]));
    return {
      notification: record,
      unreadCount: await unreadCount(db, principal.userId, principal.organizationId),
    };
  });
}

export async function DELETE(_request: Request, { params }: RouteParams): Promise<Response> {
  return await handleRoute(async () => {
    const { principal, userName } = await apiContext();
    const { id } = await params;
    const removed = await dismissNotification(db, {
      userId: principal.userId,
      organizationId: principal.organizationId,
      notificationId: id,
    });
    await publish(notificationActions(principal, userName, 'delete', [removed]));
    return {
      deletedId: id,
      unreadCount: await unreadCount(db, principal.userId, principal.organizationId),
    };
  });
}
