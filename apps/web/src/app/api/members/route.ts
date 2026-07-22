import { listMembers } from '@orbit/core';
import { apiContext, handleRoute } from '@/lib/api/handler.ts';

export async function GET(): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    return { members: await listMembers(principal) };
  });
}
