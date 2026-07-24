import { updateProfile } from '@orbit/core';
import { unauthorized } from '@orbit/shared/errors';
import { handleRoute, publish, readJson } from '@/lib/api/handler.ts';
import { republishMemberships } from '@/lib/api/profile-sync.ts';
import { getSession } from '@/lib/auth/session.ts';

export async function PATCH(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const session = await getSession();
    if (session === null) throw unauthorized();
    const user = await updateProfile(session.user.id, await readJson(request));

    await publish(await republishMemberships(user));

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
