import {
  dismissInboxConversation,
  getInboxConversation,
  snoozeInboxConversation,
} from '@orbit/core';
import { handle, publish, readJson } from '@/lib/api/handler.ts';

interface RouteParams {
  readonly params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: RouteParams): Promise<Response> {
  const { id } = await params;
  return await handle((principal) => getInboxConversation(principal, id));
}

export async function PATCH(request: Request, { params }: RouteParams): Promise<Response> {
  const { id } = await params;
  return await handle(async (principal) => {
    const { actions, ...result } = await snoozeInboxConversation(
      principal,
      id,
      await readJson(request),
    );
    await publish(actions);
    return result;
  });
}

export async function DELETE(_request: Request, { params }: RouteParams): Promise<Response> {
  const { id } = await params;
  return await handle(async (principal) => {
    const { actions, ...result } = await dismissInboxConversation(principal, id);
    await publish(actions);
    return result;
  });
}
