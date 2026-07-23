import { buildSyncAction, nextSyncId, updateProfile } from '@orbit/core';
import { db, eq, schema } from '@orbit/db';
import { unauthorized } from '@orbit/shared/errors';
import { scopes } from '@orbit/shared/events';
import { handleRoute, publish, readJson } from '@/lib/api/handler.ts';
import { getSession } from '@/lib/auth/session.ts';

export async function PATCH(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const session = await getSession();
    if (session === null) throw unauthorized();
    const user = await updateProfile(session.user.id, await readJson(request));

    const syncId = await nextSyncId(db);
    const memberships = await db
      .update(schema.member)
      .set({ syncId })
      .where(eq(schema.member.userId, user.id))
      .returning();
    await publish(
      memberships.map((row) =>
        buildSyncAction({
          syncId: row.syncId,
          organizationId: row.organizationId,
          scopes: [scopes.organization(row.organizationId), scopes.user(row.userId)],
          action: 'update',
          model: 'member',
          modelId: row.id,
          data: row,
          actor: { type: 'user', id: user.id, name: user.name },
        }),
      ),
    );

    return {
      user: {
        name: user.name,
        handle: user.handle,
        image: user.image,
        timezone: user.timezone,
      },
    };
  });
}
