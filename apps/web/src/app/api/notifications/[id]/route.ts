import { nextSyncId } from '@orbit/core';
import { and, db, eq, schema } from '@orbit/db';
import { snooze, unreadCount } from '@orbit/services/notifications';
import { notFound } from '@orbit/shared/errors';
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
    const deleted = await db
      .delete(schema.notification)
      .where(
        and(
          eq(schema.notification.id, id),
          eq(schema.notification.userId, principal.userId),
          eq(schema.notification.organizationId, principal.organizationId),
        ),
      )
      .returning();
    const removed = deleted[0];
    if (removed === undefined) throw notFound('That notification does not exist.');
    await publish(
      notificationActions(principal, userName, 'delete', [
        { ...removed, syncId: await nextSyncId(db) },
      ]),
    );
    return {
      deletedId: id,
      unreadCount: await unreadCount(db, principal.userId, principal.organizationId),
    };
  });
}
