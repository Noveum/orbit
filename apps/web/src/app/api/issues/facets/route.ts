import { getIssueFacets } from '@orbit/core';
import { issueFilterSchema } from '@orbit/shared/validators';
import { handle, searchParamsOf } from '@/lib/api/handler.ts';

export async function GET(request: Request): Promise<Response> {
  return await handle(async (principal) => {
    const filter = issueFilterSchema.parse(searchParamsOf(request));
    return await getIssueFacets(principal, filter);
  });
}
