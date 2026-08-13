import { loadAnalyticsDrilldownData } from '@/features/analytics/data.ts';
import { analyticsDrilldownFromSearchParams } from '@/features/analytics/query-state.ts';
import { handle } from '@/lib/api/handler.ts';

export async function GET(request: Request): Promise<Response> {
  return await handle(async (principal) => {
    const parsed = analyticsDrilldownFromSearchParams(new URL(request.url).searchParams);
    const { cohort, cursor, limit, ...query } = parsed;
    return await loadAnalyticsDrilldownData(principal, {
      query,
      cohort,
      limit,
      ...(cursor === undefined ? {} : { cursor }),
    });
  });
}
