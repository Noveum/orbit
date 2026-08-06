import { listDocCollections, listDocs, visibleProjectFilter } from '@orbit/core';
import { and, db, eq, isNull, schema } from '@orbit/db';
import { summarize } from '@orbit/services/markdown';
import type { Principal } from '@orbit/shared/policy';
import type { DocFilterInput } from '@orbit/shared/validators';

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
      excerpt: summarize(doc.excerpt, DOC_EXCERPT_LENGTH),
      snippet: doc.snippet.length === 0 ? '' : summarize(doc.snippet, DOC_SNIPPET_LENGTH),
      titleMatch: doc.titleMatch,
    })),
    collections,
    projects,
  };
}
