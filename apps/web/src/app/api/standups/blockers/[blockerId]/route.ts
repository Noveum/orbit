import { resolveBlocker } from '@orbit/core';
import { validationFailed } from '@orbit/shared/errors';
import { handle, publish, readJson, searchParamsOf } from '@/lib/api/handler.ts';

interface RouteContext {
  readonly params: Promise<{ blockerId: string }>;
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const { blockerId } = await context.params;
  const standupId = searchParamsOf(request)['standupId'];
  if (standupId === undefined) throw validationFailed('A standupId is required.');
  const body = await readJson(request);
  return await handle(async (principal) => {
    const result = await resolveBlocker(principal, standupId, blockerId, body);
    await publish(result.actions);
    return result.detail;
  });
}
