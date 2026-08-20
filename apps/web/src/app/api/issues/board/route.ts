import { listBoardGroups } from '@orbit/core';
import { handle, searchParamsOf } from '@/lib/api/handler.ts';
import { attachLabels } from '@/lib/api/issues.ts';

export async function GET(request: Request): Promise<Response> {
  const params = searchParamsOf(request);
  return await handle(async (principal) => {
    const page = await listBoardGroups(principal, params);
    return {
      ...page,
      groups: await Promise.all(
        page.groups.map(async (group) => ({ ...group, issues: await attachLabels(group.issues) })),
      ),
    };
  });
}
