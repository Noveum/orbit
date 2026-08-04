import { createCycle, listCycles, pastCycles } from '@orbit/core';
import { apiContext, handleRoute, publish, readJson, searchParamsOf } from '@/lib/api/handler.ts';

export async function GET(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const params = searchParamsOf(request);
    const teamId = params['teamId'];
    if (teamId === undefined) return { cycles: [] };
    if (params['status'] === 'past') {
      const limit = Number(params['limit'] ?? '12');
      return { cycles: await pastCycles(principal, teamId, Number.isFinite(limit) ? limit : 12) };
    }
    return { cycles: await listCycles(principal, teamId) };
  });
}

export async function POST(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const result = await createCycle(principal, await readJson(request));
    await publish(result.actions);
    return { cycle: result.cycle };
  });
}
