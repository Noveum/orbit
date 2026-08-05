import { getRotation, setRotation } from '@orbit/core';
import { validationFailed } from '@orbit/shared/errors';
import { handle, publish, readJson, searchParamsOf } from '@/lib/api/handler.ts';

export async function GET(request: Request): Promise<Response> {
  return await handle(async (principal) => {
    const teamId = searchParamsOf(request)['teamId'];
    if (teamId === undefined) throw validationFailed('A teamId is required.');
    return { rotation: await getRotation(principal, teamId) };
  });
}

export async function PUT(request: Request): Promise<Response> {
  return await handle(async (principal) => {
    const result = await setRotation(principal, await readJson(request));
    await publish(result.actions);
    return { rotation: result.rotation };
  });
}
