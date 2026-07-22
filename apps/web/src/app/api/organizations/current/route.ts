import { getOrganization, updateOrganization } from '@orbit/core';
import { apiContext, handleRoute, publish, readJson } from '@/lib/api/handler.ts';

export async function GET(): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    return { organization: await getOrganization(principal.organizationId) };
  });
}

export async function PATCH(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    const result = await updateOrganization(principal, await readJson(request));
    await publish(result.actions);
    return { organization: result.organization };
  });
}
