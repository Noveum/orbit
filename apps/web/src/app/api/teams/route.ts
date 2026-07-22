import { createTeam, listTeams } from '@orbit/core';
import { apiContext, handleRoute, publish, readJson } from '@/lib/api/handler.ts';

export async function GET(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const includeArchived = new URL(request.url).searchParams.get('includeArchived') === 'true';
    return { teams: await listTeams(principal, { includeArchived }) };
  });
}

export async function POST(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const result = await createTeam(principal, await readJson(request));
    await publish(result.actions);
    return { team: result.team };
  });
}
