import { createDoc, listDocCollections, listDocs } from '@orbit/core';
import { and, db, eq, isNull, schema } from '@orbit/db';
import { summarize } from '@orbit/services/markdown';
import { handle, publish, readJson, searchParamsOf } from '@/lib/api/handler.ts';

export async function GET(request: Request): Promise<Response> {
  return await handle(async (principal) => {
    const [docs, collections, projects] = await Promise.all([
      listDocs(principal, searchParamsOf(request)),
      listDocCollections(principal),
      db
        .select({ id: schema.project.id, name: schema.project.name })
        .from(schema.project)
        .where(
          and(
            eq(schema.project.organizationId, principal.organizationId),
            isNull(schema.project.archivedAt),
          ),
        ),
    ]);

    return {
      docs: docs.map((doc) => ({
        ...doc,
        publishToken: doc.publishToken === null ? null : 'set',
        excerpt: summarize(doc.excerpt, 140),
      })),
      collections,
      projects,
    };
  });
}

export async function POST(request: Request): Promise<Response> {
  const body = await readJson(request);
  return await handle(async (principal) => {
    const created = await createDoc(principal, body);
    await publish(created.actions);
    return { doc: created.doc };
  });
}
