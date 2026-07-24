import { notFound, unauthorized } from '@orbit/shared/errors';
import { setPasswordSchema } from '@orbit/shared/validators';
import { headers } from 'next/headers';
import { handleRoute, readJson } from '@/lib/api/handler.ts';
import { auth, passwordAuthEnabled } from '@/lib/auth/server.ts';

export async function POST(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    if (!passwordAuthEnabled) throw notFound();
    const requestHeaders = await headers();
    const session = await auth.api.getSession({ headers: requestHeaders });
    if (session === null) throw unauthorized();

    const { newPassword } = setPasswordSchema.parse(await readJson(request));
    await auth.api.setPassword({ headers: requestHeaders, body: { newPassword } });
    return { ok: true };
  });
}
