import { db, eq, schema } from '@orbit/db';
import { createStorageDriver } from '@orbit/services/storage';
import { notFound, validationFailed } from '@orbit/shared/errors';
import { handle } from '@/lib/api/handler.ts';

interface RouteContext {
  readonly params: Promise<{ id: string }>;
}

export async function POST(_request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  return await handle(async (principal) => {
    const [record] = await db
      .select()
      .from(schema.attachment)
      .where(eq(schema.attachment.id, id))
      .limit(1);
    if (record === undefined || record.organizationId !== principal.organizationId) {
      throw notFound('That upload was not registered.');
    }

    const stored = await createStorageDriver().stat(record.storageKey);
    if (stored === null) throw notFound('That upload never reached storage.');
    if (stored.size > record.size) {
      throw validationFailed('That upload is larger than the registered size.');
    }

    const [updated] = await db
      .update(schema.attachment)
      .set({ status: 'ready' })
      .where(eq(schema.attachment.id, record.id))
      .returning();

    return { attachment: updated };
  });
}
