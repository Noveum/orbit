import { createOrganization, listOrganizationsForUser } from '@orbit/core';
import { unauthorized } from '@orbit/shared/errors';
import { handleRoute, publish, readJson } from '@/lib/api/handler.ts';
import { getSession } from '@/lib/auth/session.ts';

export async function GET(): Promise<Response> {
  return await handleRoute(async () => {
    const session = await getSession();
    if (session === null) throw unauthorized();
    const rows = await listOrganizationsForUser(session.user.id);
    return {
      organizations: rows.map((row) => ({
        id: row.organization.id,
        name: row.organization.name,
        slug: row.organization.slug,
        role: row.role,
      })),
    };
  });
}

export async function POST(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const session = await getSession();
    if (session === null) throw unauthorized();
    const bootstrap = await createOrganization(session.user.id, await readJson(request), {
      seed: true,
    });
    await publish(bootstrap.actions);
    return {
      organization: {
        id: bootstrap.organization.id,
        name: bootstrap.organization.name,
        slug: bootstrap.organization.slug,
      },
      team: { id: bootstrap.team.id, key: bootstrap.team.key, name: bootstrap.team.name },
    };
  });
}
