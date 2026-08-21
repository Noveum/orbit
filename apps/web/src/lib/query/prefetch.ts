import { listIssues } from '@orbit/core';
import type { Principal } from '@orbit/shared/policy';
import { dehydrate, QueryClient } from '@tanstack/react-query';
import { bootstrapPayloadFor, bootstrapTeams } from '@/lib/api/bootstrap.ts';
import { attachIssueDecorations } from '@/lib/api/issues.ts';
import {
  assignedSearch,
  DEFAULT_ISSUE_QUERY,
  ISSUE_PAGE_SIZE,
  issueSearch,
} from './issue-search.ts';
import { queryKeys } from './keys.ts';
import type { IssuePage } from './schemas.ts';
import { bootstrapSchema, issueListSchema } from './schemas.ts';

function asWire<T>(schema: { parse: (value: unknown) => T }, payload: unknown): T {
  return schema.parse(JSON.parse(JSON.stringify(payload)));
}

async function serverIssuePage(principal: Principal, teamId: string): Promise<IssuePage> {
  const page = await listIssues(principal, { teamId, limit: ISSUE_PAGE_SIZE });
  return asWire(issueListSchema, {
    issues: await attachIssueDecorations(page.issues),
    nextCursor: page.nextCursor,
  });
}

async function serverAssignedPage(principal: Principal): Promise<IssuePage> {
  const page = await listIssues(principal, {
    participantId: principal.userId,
    orderBy: 'updated',
    limit: ISSUE_PAGE_SIZE,
  });
  return asWire(issueListSchema, {
    issues: await attachIssueDecorations(page.issues),
    nextCursor: page.nextCursor,
  });
}

export async function dehydratedAssignedIssues(principal: Principal) {
  const client = new QueryClient();
  const search = assignedSearch(principal.userId);
  client.setQueryData(queryKeys.assignedIssues(principal.userId, search), {
    pages: [await serverAssignedPage(principal)],
    pageParams: [null],
  });
  return dehydrate(client);
}

export async function dehydratedWorkspace(principal: Principal) {
  const client = new QueryClient();
  const resolved = await bootstrapTeams(principal, {});
  const teamId = resolved.activeTeam?.id ?? null;

  const [bootstrap, page] = await Promise.all([
    bootstrapPayloadFor(principal, resolved).then((payload) => asWire(bootstrapSchema, payload)),
    teamId === null ? null : serverIssuePage(principal, teamId),
  ]);

  client.setQueryData(queryKeys.bootstrap(null), bootstrap);

  if (teamId !== null && page !== null) {
    const search = issueSearch(teamId, DEFAULT_ISSUE_QUERY);
    client.setQueryData(queryKeys.issues(teamId, search), { pages: [page], pageParams: [null] });
  }

  return dehydrate(client);
}
