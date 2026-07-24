import { and, db, desc, eq, schema } from '@orbit/db';
import { assertCan } from '@orbit/shared/policy';
import { gitLinksQuerySchema } from '@orbit/shared/validators';
import { apiContext, handleRoute, searchParamsOf } from '@/lib/api/handler.ts';

export async function GET(request: Request): Promise<Response> {
  return await handleRoute(async () => {
    const { principal } = await apiContext();
    assertCan(principal, 'issue:read');
    const { issueId } = gitLinksQuerySchema.parse(searchParamsOf(request));
    const pulls = await db
      .select({
        id: schema.gitLink.id,
        title: schema.gitLink.title,
        url: schema.gitLink.url,
        repository: schema.gitLink.repository,
        number: schema.gitLink.number,
        branch: schema.gitLink.branch,
        state: schema.gitLink.state,
        draft: schema.gitLink.draft,
        merged: schema.gitLink.merged,
      })
      .from(schema.gitLink)
      .where(
        and(
          eq(schema.gitLink.organizationId, principal.organizationId),
          eq(schema.gitLink.issueId, issueId),
          eq(schema.gitLink.kind, 'pull_request'),
        ),
      )
      .orderBy(desc(schema.gitLink.updatedAt));
    return { pulls };
  });
}
