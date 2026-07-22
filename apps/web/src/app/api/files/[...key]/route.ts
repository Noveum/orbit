import { readFile } from 'node:fs/promises';
import { db, eq, schema } from '@orbit/db';
import { createStorageDriver, LocalStorageDriver } from '@orbit/services/storage';
import { notFound, validationFailed } from '@orbit/shared/errors';
import { apiContext, errorResponse } from '@/lib/api/handler.ts';

interface RouteContext {
  readonly params: Promise<{ key: string[] }>;
}

const MAX_INLINE_BYTES = 25 * 1024 * 1024;

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const { principal } = await apiContext();
    const { key } = await context.params;
    const storageKey = key.join('/');

    const [record] = await db
      .select()
      .from(schema.attachment)
      .where(eq(schema.attachment.storageKey, storageKey))
      .limit(1);
    if (record === undefined || record.organizationId !== principal.organizationId) {
      throw notFound('That file does not exist.');
    }

    const driver = createStorageDriver();
    if (!(driver instanceof LocalStorageDriver)) {
      return Response.redirect(await driver.getUrl(storageKey, 300), 302);
    }

    const stat = await driver.stat(storageKey);
    if (stat === null) throw notFound('That file does not exist.');
    if (stat.size > MAX_INLINE_BYTES) {
      throw validationFailed('That file is too large to stream from local storage.');
    }

    const body = await readFile(driver.resolve(storageKey));
    return new Response(new Uint8Array(body), {
      headers: {
        'content-type': record.contentType,
        'content-length': String(stat.size),
        'cache-control': 'private, max-age=300',
      },
    });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}

export async function PUT(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { principal } = await apiContext();
    const { key } = await context.params;
    const storageKey = key.join('/');

    const [record] = await db
      .select()
      .from(schema.attachment)
      .where(eq(schema.attachment.storageKey, storageKey))
      .limit(1);
    if (record === undefined || record.organizationId !== principal.organizationId) {
      throw notFound('That upload was not registered.');
    }

    const body = new Uint8Array(await request.arrayBuffer());
    if (body.byteLength > record.size) {
      throw validationFailed('That upload is larger than the registered size.');
    }

    await createStorageDriver().put(storageKey, body, record.contentType);
    await db
      .update(schema.attachment)
      .set({ status: 'ready' })
      .where(eq(schema.attachment.id, record.id));

    return Response.json({ uploaded: true });
  } catch (error: unknown) {
    return errorResponse(error);
  }
}
