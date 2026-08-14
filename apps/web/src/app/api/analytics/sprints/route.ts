import { loadAnalyticsLensData } from '@/features/analytics/data.ts';
import { parseAnalyticsSearchParamsStrict } from '@/features/analytics/query-state.ts';
import { handle } from '@/lib/api/handler.ts';

export async function GET(request: Request): Promise<Response> {
  return await handle(async (principal) => {
    const query = parseAnalyticsSearchParamsStrict(new URL(request.url).searchParams);
    return await loadAnalyticsLensData(principal, 'sprints', query);
  });
}
