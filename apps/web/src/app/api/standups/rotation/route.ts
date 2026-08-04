import { getRotation, setRotation } from '@orbit/core';
import { validationFailed } from '@orbit/shared/errors';
import { handle, readJson, searchParamsOf } from '@/lib/api/handler.ts';

export async function GET(request: Request): Promise<Response> {
  return await handle(async (principal) => {
    const teamId = searchParamsOf(request)['teamId'];
    if (teamId === undefined) throw validationFailed('A teamId is required.');
    return { rotation: await getRotation(principal, teamId) };
  });
}

export async function PUT(request: Request): Promise<Response> {
  const body = await readJson(request);
  return await handle(async (principal) => ({ rotation: await setRotation(principal, body) }));
}
