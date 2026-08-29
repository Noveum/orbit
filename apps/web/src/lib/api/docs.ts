import { listDocCollections, listDocs, visibleProjectFilter } from '@orbit/core';
import { and, db, eq, isNull, schema } from '@orbit/db';
import type { Principal } from '@orbit/shared/policy';
import type { DocFilterInput } from '@orbit/shared/validators';
import { summarizeDoc } from '@/lib/docs/render.ts';

const DOC_EXCERPT_LENGTH = 140;
const DOC_SNIPPET_LENGTH = 200;

export async function docListPayload(principal: Principal, filter?: DocFilterInput) {
  const [docs, collections, projects] = await Promise.all([
    listDocs(principal, filter),
    listDocCollections(principal),
    db
      .select({ id: schema.project.id, name: schema.project.name })
      .from(schema.project)
      .where(
        and(
          eq(schema.project.organizationId, principal.organizationId),
          isNull(schema.project.archivedAt),
          visibleProjectFilter(principal),
        ),
      ),
  ]);

  return {
    docs: docs.map((doc) => ({
      ...doc,
      publishToken: doc.publishToken === null ? null : 'set',
      excerpt: summarizeDoc(doc.kind, doc.excerpt, DOC_EXCERPT_LENGTH),
      snippet:
        doc.snippet.length === 0 ? '' : summarizeDoc(doc.kind, doc.snippet, DOC_SNIPPET_LENGTH),
      titleMatch: doc.titleMatch,
    })),
    collections,
    projects,
  };
}
