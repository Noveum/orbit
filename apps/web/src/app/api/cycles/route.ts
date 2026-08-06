import { createCycle, listCycles, pastCycles } from '@orbit/core';
import { cycleListQuerySchema } from '@orbit/shared/validators';
import { apiContext, handleRoute, publish, readJson, searchParamsOf } from '@/lib/api/handler.ts';

export async function GET(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const query = cycleListQuerySchema.parse(searchParamsOf(request));
    if (query.teamId === undefined) return { cycles: [] };
    if (query.status === 'past') {
      return { cycles: await pastCycles(principal, query.teamId, query.limit) };
    }
    return { cycles: await listCycles(principal, query.teamId) };
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
