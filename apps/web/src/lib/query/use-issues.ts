'use client';

import { sortOrderBetween } from '@orbit/shared/utils';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useToast } from '@/components/ui/toast.tsx';
import { apiFetch, messageOf } from './fetcher.ts';
import {
  ALL_ISSUES_QUERY,
  allIssuesSearch,
  assignedSearch,
  assigneeInTeamSearch,
  columnSearch,
  DEFAULT_ISSUE_QUERY,
  ISSUE_PAGE_SIZE,
  type IssueQuery,
  issueSearch,
} from './issue-search.ts';
import { ISSUE_SUMMARY_ROOT, ISSUES_ROOT, queryKeys } from './keys.ts';
import type {
  Bootstrap,
  Issue,
  IssueCounts,
  IssueDetail,
  IssuePage,
  IssueSummary,
} from './schemas.ts';
import {
  bootstrapSchema,
  issueCountsSchema,
  issueDetailSchema,
  issueEnvelopeSchema,
  issueListSchema,
  issueMoveResultSchema,
  issueSummarySchema,
} from './schemas.ts';
import type { IssuePages } from './sync.ts';
import {
  belongsInList,
  flattenIssuePages,
  mapIssuePages,
  searchOf,
  sortForSearch,
} from './sync.ts';

export type { IssueQuery };
export {
  ALL_ISSUES_QUERY,
  allIssuesSearch,
  assignedSearch,
  assigneeInTeamSearch,
  columnSearch,
  DEFAULT_ISSUE_QUERY,
  ISSUE_PAGE_SIZE,
  issueSearch,
};

export function bootstrapQueryOptions(teamKey: string | null) {
  return {
    queryKey: queryKeys.bootstrap(teamKey),
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<Bootstrap> =>
      await apiFetch(
        teamKey === null ? '/api/bootstrap' : `/api/bootstrap?team=${encodeURIComponent(teamKey)}`,
        bootstrapSchema,
        { signal },
      ),
    staleTime: Number.POSITIVE_INFINITY,
  };
}

export function useBootstrap(teamKey: string | null) {
  return useQuery(bootstrapQueryOptions(teamKey));
}

async function fetchIssuePage(
  search: string,
  cursor: string | null,
  signal: AbortSignal,
): Promise<IssuePage> {
  const url =
    cursor === null
      ? `/api/issues?${search}`
      : `/api/issues?${search}&cursor=${encodeURIComponent(cursor)}`;
  return await apiFetch(url, issueListSchema, { signal });
}

function pagedIssueOptions(queryKey: QueryKey, search: string) {
  return {
    queryKey,
    queryFn: async ({
      pageParam,
      signal,
    }: {
      pageParam: string | null;
      signal: AbortSignal;
    }): Promise<IssuePage> => await fetchIssuePage(search, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (last: IssuePage): string | null => last.nextCursor,
  };
}

export function issuesQueryOptions(teamId: string, query: IssueQuery = DEFAULT_ISSUE_QUERY) {
  const search = issueSearch(teamId, query);
  return pagedIssueOptions(queryKeys.issues(teamId, search), search);
}

export function issueSummaryQueryOptions(search: string, enabled = true) {
  return {
    queryKey: queryKeys.issueSummary(search),
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<IssueSummary> =>
      await apiFetch(`/api/issues/summary?${search}`, issueSummarySchema, { signal }),
  };
}

export function useIssueSummary(search: string, enabled = true) {
  return useQuery(issueSummaryQueryOptions(search, enabled));
}

function seedPages(seed: readonly Issue[] | undefined): IssuePages | undefined {
  if (seed === undefined || seed.length === 0) return undefined;
  return { pages: [{ issues: [...seed], nextCursor: null }], pageParams: [null] };
}

export function useIssues(
  teamId: string | null,
  seed: readonly Issue[] | undefined,
  query: IssueQuery = DEFAULT_ISSUE_QUERY,
) {
  const options = issuesQueryOptions(teamId ?? 'none', query);
  return useInfiniteQuery({
    ...options,
    enabled: teamId !== null,
    select: flattenIssuePages,
    placeholderData: seedPages(seed) ?? keepPreviousData,
  });
}

export function useColumnIssues(
  teamId: string | null,
  query: IssueQuery,
  stateId: string,
  enabled: boolean,
) {
  const search = teamId === null ? '' : columnSearch(teamId, query, stateId);
  return useInfiniteQuery({
    ...pagedIssueOptions(queryKeys.issues(teamId ?? 'none', search), search),
    enabled: enabled && teamId !== null,
    select: flattenIssuePages,
    placeholderData: keepPreviousData,
  });
}

export function useTeamMemberIssues(teamId: string | null, userId: string | null) {
  const search = teamId === null || userId === null ? '' : assigneeInTeamSearch(teamId, userId);
  return useInfiniteQuery({
    ...pagedIssueOptions(queryKeys.issues(teamId ?? 'none', search), search),
    enabled: teamId !== null && userId !== null,
    select: flattenIssuePages,
    placeholderData: keepPreviousData,
  });
}

export function useAssignedIssues(userId: string | null) {
  const search = userId === null ? '' : assignedSearch(userId);
  return useInfiniteQuery({
    ...pagedIssueOptions(queryKeys.assignedIssues(userId ?? 'none', search), search),
    enabled: userId !== null,
    select: flattenIssuePages,
    placeholderData: keepPreviousData,
  });
}

export function useAllIssues(query: IssueQuery = ALL_ISSUES_QUERY, enabled = true) {
  const search = allIssuesSearch(query);
  return useInfiniteQuery({
    ...pagedIssueOptions(queryKeys.allIssues(search), search),
    enabled,
    select: flattenIssuePages,
    placeholderData: keepPreviousData,
  });
}

export function useIssueCounts(teamId: string | null) {
  const search = teamId === null ? '' : `teamId=${encodeURIComponent(teamId)}`;
  return useQuery({
    queryKey: queryKeys.issueCounts(search),
    enabled: teamId !== null,
    queryFn: async ({ signal }): Promise<IssueCounts> =>
      await apiFetch(`/api/issues/counts?${search}`, issueCountsSchema, { signal }),
  });
}

export function useIssueDetail(identifier: string) {
  return useQuery({
    queryKey: queryKeys.issue(identifier),
    queryFn: async ({ signal }): Promise<IssueDetail> =>
      await apiFetch(`/api/issues/${encodeURIComponent(identifier)}`, issueDetailSchema, {
        signal,
      }),
  });
}

export interface IssuePatch {
  readonly title?: string;
  readonly description?: string;
  readonly stateId?: string;
  readonly priority?: number;
  readonly assigneeId?: string | null;
  readonly projectId?: string | null;
  readonly cycleId?: string | null;
  readonly estimate?: number | null;
  readonly labelIds?: readonly string[];
}

type IssueListSnapshot = readonly [QueryKey, IssuePages | undefined][];

function snapshotIssueLists(client: QueryClient): IssueListSnapshot {
  return client.getQueriesData<IssuePages>({ queryKey: [ISSUES_ROOT] });
}

function restoreIssueLists(client: QueryClient, snapshot: IssueListSnapshot): void {
  for (const [key, pages] of snapshot) client.setQueryData(key, pages);
}

function reconcile(
  search: string,
  issues: readonly Issue[],
  next: Issue,
  admit: boolean,
): readonly Issue[] {
  const index = issues.findIndex((issue) => issue.id === next.id);
  if (!belongsInList(search, next)) {
    return index === -1 ? issues : issues.filter((issue) => issue.id !== next.id);
  }
  if (index === -1) return admit ? sortForSearch(search, [...issues, next]) : issues;
  const copy = [...issues];
  copy[index] = next;
  return copy;
}

function eachIssueList(
  client: QueryClient,
  filters: { queryKey: QueryKey },
  update: (issues: readonly Issue[], search: string) => readonly Issue[],
): void {
  for (const [key] of client.getQueriesData<IssuePages>(filters)) {
    const search = searchOf(key);
    client.setQueryData<IssuePages>(key, (current) =>
      current === undefined ? current : mapIssuePages(current, (issues) => update(issues, search)),
    );
  }
}

function patchIssueLists(
  client: QueryClient,
  update: (issues: readonly Issue[]) => readonly Issue[],
): void {
  eachIssueList(client, { queryKey: [ISSUES_ROOT] }, (issues) => update(issues));
}

function placeIssue(client: QueryClient, next: Issue): void {
  eachIssueList(client, { queryKey: [ISSUES_ROOT] }, (issues, search) =>
    reconcile(search, issues, next, false),
  );
}

function placeIssues(client: QueryClient, moved: readonly Issue[]): void {
  eachIssueList(client, { queryKey: [ISSUES_ROOT] }, (issues, search) => {
    let next = issues;
    for (const issue of moved) next = reconcile(search, next, issue, false);
    return sortForSearch(search, next);
  });
}

function addToTeamLists(client: QueryClient, teamId: string, next: Issue): void {
  eachIssueList(client, { queryKey: queryKeys.issueTeam(teamId) }, (issues, search) =>
    reconcile(search, issues, next, true),
  );
}

function refreshCounts(client: QueryClient): void {
  client.invalidateQueries({ queryKey: [ISSUE_SUMMARY_ROOT] }).catch(() => undefined);
}

function resortTeamIssueLists(client: QueryClient, teamId: string): void {
  eachIssueList(client, { queryKey: queryKeys.issueTeam(teamId) }, (issues, search) =>
    sortForSearch(search, issues),
  );
}

export function useUpdateIssue(_teamId: string) {
  const client = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: { issue: Issue; patch: IssuePatch }): Promise<Issue> => {
      const result = await apiFetch(`/api/issues/${input.issue.id}`, issueEnvelopeSchema, {
        method: 'PATCH',
        body: input.patch,
      });
      return result.issue;
    },
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey: [ISSUES_ROOT] });
      const previous = snapshotIssueLists(client);
      const previousDetail = client.getQueryData<IssueDetail>(
        queryKeys.issue(input.issue.identifier),
      );

      const optimistic: Issue = {
        ...input.issue,
        ...input.patch,
        labelIds:
          input.patch.labelIds === undefined ? input.issue.labelIds : [...input.patch.labelIds],
      };
      placeIssue(client, optimistic);
      if (previousDetail !== undefined) {
        client.setQueryData(queryKeys.issue(input.issue.identifier), {
          ...previousDetail,
          issue: {
            ...optimistic,
            description: input.patch.description ?? previousDetail.issue.description,
          },
        });
      }
      return { previous, previousDetail, identifier: input.issue.identifier };
    },
    onError: (error, _input, context) => {
      if (context?.previous !== undefined) restoreIssueLists(client, context.previous);
      if (context?.previousDetail !== undefined && context.identifier !== undefined) {
        client.setQueryData(queryKeys.issue(context.identifier), context.previousDetail);
      }
      toast({ title: 'Could not save', description: messageOf(error), tone: 'danger' });
    },
    onSuccess: (issue) => {
      placeIssue(client, issue);
      refreshCounts(client);
      client.setQueryData<IssueDetail>(queryKeys.issue(issue.identifier), (current) =>
        current === undefined ? current : { ...current, issue },
      );
    },
  });
}

export interface MoveInput {
  readonly issue: Issue;
  readonly stateId: string;
  readonly beforeId: string | null;
  readonly afterId: string | null;
  readonly beforeOrder: number | null;
  readonly afterOrder: number | null;
}

export function useMoveIssue(teamId: string) {
  const client = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: MoveInput): Promise<readonly Issue[]> => {
      const result = await apiFetch(`/api/issues/${input.issue.id}/move`, issueMoveResultSchema, {
        method: 'POST',
        body: { stateId: input.stateId, beforeId: input.beforeId, afterId: input.afterId },
      });
      return [result.issue, ...result.rebalanced];
    },
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey: [ISSUES_ROOT] });
      const previous = snapshotIssueLists(client);
      const optimistic: Issue = {
        ...input.issue,
        stateId: input.stateId,
        sortOrder: sortOrderBetween(input.beforeOrder, input.afterOrder),
      };
      placeIssue(client, optimistic);
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous !== undefined) restoreIssueLists(client, context.previous);
      toast({ title: 'Could not move that issue', description: messageOf(error), tone: 'danger' });
    },
    onSuccess: (moved) => {
      placeIssues(client, moved);
    },
    onSettled: () => {
      resortTeamIssueLists(client, teamId);
      refreshCounts(client);
    },
  });
}

export interface CreateIssueInput {
  readonly teamId: string;
  readonly title: string;
  readonly description: string;
  readonly stateId?: string;
  readonly priority: number;
  readonly assigneeId: string | null;
  readonly projectId: string | null;
  readonly cycleId: string | null;
  readonly estimate: number | null;
  readonly labelIds: readonly string[];
}

export function useCreateIssue(teamId: string) {
  const client = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: CreateIssueInput): Promise<Issue> => {
      const result = await apiFetch('/api/issues', issueEnvelopeSchema, {
        method: 'POST',
        body: input,
      });
      return result.issue;
    },
    onError: (error) => {
      toast({
        title: 'Could not create that issue',
        description: messageOf(error),
        tone: 'danger',
      });
    },
    onSuccess: (issue) => {
      addToTeamLists(client, teamId, issue);
      refreshCounts(client);
    },
  });
}

export function useDeleteIssue(_teamId: string) {
  const client = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (issue: Issue): Promise<void> => {
      await apiFetch(`/api/issues/${issue.id}`, issueEnvelopeSchema.partial(), {
        method: 'DELETE',
      });
    },
    onMutate: async (issue) => {
      await client.cancelQueries({ queryKey: [ISSUES_ROOT] });
      const previous = snapshotIssueLists(client);
      patchIssueLists(client, (issues) => issues.filter((entry) => entry.id !== issue.id));
      return { previous };
    },
    onError: (error, _issue, context) => {
      if (context?.previous !== undefined) restoreIssueLists(client, context.previous);
      toast({ title: 'Could not delete', description: messageOf(error), tone: 'danger' });
    },
    onSettled: (_data, _error, issue) => {
      client.removeQueries({ queryKey: queryKeys.issue(issue.identifier) });
      refreshCounts(client);
    },
  });
}
