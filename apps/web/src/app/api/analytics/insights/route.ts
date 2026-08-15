import { loadAnalyticsInsightsData } from '@/features/analytics/data.ts';
import { analyticsInsightsFromSearchParams } from '@/features/analytics/query-state.ts';
import { handle } from '@/lib/api/handler.ts';

export async function GET(request: Request): Promise<Response> {
  return await handle(async (principal) => {
    const parsed = analyticsInsightsFromSearchParams(new URL(request.url).searchParams);
    return await loadAnalyticsInsightsData(principal, parsed, parsed.insight);
  });
}
