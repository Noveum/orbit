import { getIssueSummary } from '@orbit/core';
import { issueSummaryQuerySchema } from '@orbit/shared/validators';
import { handle, searchParamsOf } from '@/lib/api/handler.ts';

export async function GET(request: Request): Promise<Response> {
  return await handle(async (principal) => {
    const params = searchParamsOf(request);
    const filter = issueSummaryQuerySchema.parse(params);
    return await getIssueSummary(principal, filter);
  });
}
