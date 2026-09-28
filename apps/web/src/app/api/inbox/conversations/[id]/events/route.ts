import { listInboxConversationEvents } from '@orbit/core';
import { handle, searchParamsOf } from '@/lib/api/handler.ts';

export async function GET(
  request: Request,
  { params }: { readonly params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return await handle((principal) =>
    listInboxConversationEvents(principal, id, searchParamsOf(request)),
  );
}
