import { recordDocVisit } from '@orbit/core';
import { handle } from '@/lib/api/handler.ts';

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  return await handle(async (principal) => {
    const doc = await recordDocVisit(principal, id);
    return { docId: doc.id };
  });
}
