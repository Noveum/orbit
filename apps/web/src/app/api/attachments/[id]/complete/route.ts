import { findAttachmentForOrganization, markAttachmentReady } from '@orbit/core';
import { storageDriver } from '@orbit/services/storage';
import { notFound, validationFailed } from '@orbit/shared/errors';
import { handle, publish } from '@/lib/api/handler.ts';

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  return await handle(async (principal) => {
    const record = await findAttachmentForOrganization(principal, id);

    const stored = await storageDriver().stat(record.storageKey);
    if (stored === null) throw notFound('That upload never reached storage.');
    if (stored.size > record.size) {
      throw validationFailed('That upload is larger than the registered size.');
    }

    const result = await markAttachmentReady(principal, record, stored.size);
    await publish(result.actions);

    return { attachment: result.attachment };
  });
}
