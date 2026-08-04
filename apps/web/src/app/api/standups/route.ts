import { findStandup, listStandups, openStandup, standupWorkload, today } from '@orbit/core';
import { handle, publish, readJson, searchParamsOf } from '@/lib/api/handler.ts';

export async function GET(request: Request): Promise<Response> {
  return await handle(async (principal) => {
    const params = searchParamsOf(request);
    const teamId = params['teamId'];
    if (teamId !== undefined && params['heldOn'] !== undefined) {
      return { standup: await findStandup(principal, teamId, params['heldOn']) };
    }
    if (teamId !== undefined && params['view'] === 'today') {
      const since = new Date(Date.now() - 86_400_000);
      const [standup, workload] = await Promise.all([
        findStandup(principal, teamId, today()),
        standupWorkload(principal, teamId, since),
      ]);
      return { standup, workload };
    }
    return { standups: await listStandups(principal, params) };
  });
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  return await handle(async (principal) => {
    const result = await openStandup(principal, body);
    await publish(result.actions);
    return result.detail;
  });
}
