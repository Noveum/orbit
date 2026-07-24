import { listIssues } from '@orbit/core';
import type { Principal } from '@orbit/shared/policy';
import { dehydrate, QueryClient } from '@tanstack/react-query';
import { bootstrapPayload } from '@/lib/api/bootstrap.ts';
import { attachLabels } from '@/lib/api/issues.ts';
import { DEFAULT_ISSUE_QUERY, ISSUE_PAGE_SIZE, issueSearch } from './issue-search.ts';
import { queryKeys } from './keys.ts';
import type { Bootstrap, IssuePage } from './schemas.ts';
import { bootstrapSchema, issueListSchema } from './schemas.ts';

function asWire<T>(schema: { parse: (value: unknown) => T }, payload: unknown): T {
  return schema.parse(JSON.parse(JSON.stringify(payload)));
}

async function serverBootstrap(principal: Principal): Promise<Bootstrap> {
  return asWire(bootstrapSchema, await bootstrapPayload(principal, {}));
}

async function serverIssuePage(principal: Principal, teamId: string): Promise<IssuePage> {
  const page = await listIssues(principal, { teamId, limit: ISSUE_PAGE_SIZE });
  return asWire(issueListSchema, {
    issues: await attachLabels(page.issues),
    nextCursor: page.nextCursor,
  });
}

export async function dehydratedWorkspace(principal: Principal) {
  const client = new QueryClient();
  const bootstrap = await serverBootstrap(principal);
  client.setQueryData(queryKeys.bootstrap(null), bootstrap);

  const teamId = bootstrap.activeTeamId;
  if (teamId !== null) {
    const search = issueSearch(teamId, DEFAULT_ISSUE_QUERY);
    client.setQueryData(queryKeys.issues(teamId, search), {
      pages: [await serverIssuePage(principal, teamId)],
      pageParams: [null],
    });
  }

  return dehydrate(client);
}
