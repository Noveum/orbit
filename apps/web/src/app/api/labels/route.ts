import { createLabel, listLabels } from '@orbit/core';
import { labelListQuerySchema } from '@orbit/shared/validators';
import { apiContext, handleRoute, publish, readJson, searchParamsOf } from '@/lib/api/handler.ts';

export async function GET(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const query = labelListQuerySchema.parse(searchParamsOf(request));
    const options = query.teamId === undefined ? {} : { teamId: query.teamId };
    return { labels: await listLabels(principal, options) };
  });
}

export async function POST(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const result = await createLabel(principal, await readJson(request));
    await publish(result.actions);
    return { label: result.label };
  });
}
