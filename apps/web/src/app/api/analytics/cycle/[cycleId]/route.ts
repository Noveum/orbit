import { measureSchema } from '@orbit/core';
import { loadCycleBundle } from '@/features/analytics/data.ts';
import { handle, searchParamsOf } from '@/lib/api/handler.ts';

interface RouteContext {
  readonly params: Promise<{ cycleId: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { cycleId } = await context.params;
  const measure = measureSchema.catch('issues').parse(searchParamsOf(request)['measure']);
  return await handle(async (principal) => {
    const bundle = await loadCycleBundle(principal, cycleId, measure);
    return { bundle };
  });
}
