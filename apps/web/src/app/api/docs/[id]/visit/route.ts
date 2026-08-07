import { recordDocVisit } from '@orbit/core';
import { handle, routeId } from '@/lib/api/handler.ts';

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  return await handle(async (principal) => {
    const doc = await recordDocVisit(principal, routeId((await context.params).id, 'doc'));
    return { docId: doc.id };
  });
}
