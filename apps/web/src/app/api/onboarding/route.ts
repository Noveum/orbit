import { advanceOnboarding, getOnboardingStatus } from '@orbit/core';
import { unauthorized } from '@orbit/shared/errors';
import { handleRoute, readJson } from '@/lib/api/handler.ts';
import { getSession } from '@/lib/auth/session.ts';

export async function GET(): Promise<Response> {
  return await handleRoute(async () => {
    const session = await getSession();
    if (session === null) throw unauthorized();
    return { onboarding: await getOnboardingStatus(session.user.id) };
  });
}

export async function PATCH(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const session = await getSession();
    if (session === null) throw unauthorized();
    return { onboarding: await advanceOnboarding(session.user.id, await readJson(request)) };
  });
}
