import { shareDoc } from '@orbit/core';
import { handle, publish, readJson } from '@/lib/api/handler.ts';
import { publicDocPath } from '@/lib/docs/paths.ts';

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const body = await readJson(request);
  return await handle(async (principal) => {
    const shared = await shareDoc(principal, id, body);
    await publish(shared.actions);
    const token = shared.publishToken;
    return {
      doc: shared.doc,
      publishUrl: token === null ? null : new URL(publicDocPath(token), request.url).toString(),
    };
  });
}
