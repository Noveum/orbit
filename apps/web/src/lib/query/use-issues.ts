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
import { useCallback, useMemo } from 'react';
import { useToast } from '@/components/ui/toast.tsx';
import { apiFetch, messageOf } from './fetcher.ts';
import {
  ALL_ISSUES_QUERY,
  allIssuesSearch,
  assignedSearch,
  columnSearch,
  DEFAULT_ISSUE_QUERY,
  EMPTY_ISSUE_SCOPE,
  ISSUE_PAGE_SIZE,
  type IssueQuery,
  issueSearch,
  projectIssuesSearch,
} from './issue-search.ts';
import {
  ISSUE_FACETS_ROOT,
  ISSUE_ROOT,
  ISSUE_SUMMARY_ROOT,
  ISSUES_ROOT,
  queryKeys,
} from './keys.ts';
import type {
  Bootstrap,
  Issue,
  IssueCounts,
  IssueDetail,
  IssueFacets,
  IssuePage,
  IssueSummary,
} from './schemas.ts';
import {
  bootstrapSchema,
  issueCountsSchema,
  issueDeletedSchema,
  issueDetailSchema,
  issueEnvelopeSchema,
  issueFacetsSchema,
  issueListSchema,
  issueMoveResultSchema,
  issueSummarySchema,
} from './schemas.ts';
import type { IssuePages } from './sync.ts';
import {
  admitsNewRows,
  belongsInList,
  flattenIssuePages,
  mapIssuePages,
  searchOf,
  sortForSearch,
  withoutIssues,
  withoutSubIssue,
} from './sync.ts';

export type { IssueQuery };
export {
  ALL_ISSUES_QUERY,
  allIssuesSearch,
  assignedSearch,
  columnSearch,
  DEFAULT_ISSUE_QUERY,
  EMPTY_ISSUE_SCOPE,
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

const PREFETCH_STALE_MS = 30_000;
const FACETS_STALE_MS = 60_000;

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

export function issueFacetsQueryOptions(search: string, enabled = true) {
  return {
    queryKey: queryKeys.issueFacets(search),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: FACETS_STALE_MS,
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<IssueFacets> =>
      await apiFetch(`/api/issues/facets?${search}`, issueFacetsSchema, { signal }),
  };
}

export function useIssueFacets(search: string, enabled = true) {
  return useQuery(issueFacetsQueryOptions(search, enabled));
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

export function useProjectIssues(
  projectId: string | null,
  query: IssueQuery = { ...DEFAULT_ISSUE_QUERY, orderBy: 'updated' },
) {
  const search = projectId === null ? '' : projectIssuesSearch(projectId, query);
  return useInfiniteQuery({
    ...pagedIssueOptions(queryKeys.projectIssues(projectId ?? 'none', search), search),
    enabled: projectId !== null,
    select: flattenIssuePages,
    placeholderData: keepPreviousData,
  });
}

export function useAssignedIssues(userId: string | null, query?: IssueQuery) {
  const search = userId === null ? '' : assignedSearch(userId, query);
  return useInfiniteQuery({
    ...pagedIssueOptions(queryKeys.assignedIssues(userId ?? 'none', search), search),
    enabled: userId !== null,
    select: flattenIssuePages,
    placeholderData: keepPreviousData,
  });
}

export function useAllIssues(
  query: IssueQuery = ALL_ISSUES_QUERY,
  scope: Readonly<Record<string, string>> = EMPTY_ISSUE_SCOPE,
  enabled = true,
) {
  const search = allIssuesSearch(query, scope);
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

export function issueDetailQueryOptions(identifier: string) {
  return {
    queryKey: queryKeys.issue(identifier),
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<IssueDetail> =>
      await apiFetch(`/api/issues/${encodeURIComponent(identifier)}`, issueDetailSchema, {
        signal,
      }),
  };
}

export function previewDetail(issue: Issue): IssueDetail {
  return {
    issue,
    descriptionHtml: '',
    activity: [],
    activityCursor: null,
    subIssues: [],
    subscribed: false,
  };
}

export function useIssueDetail(identifier: string, known?: Issue) {
  const placeholder = useMemo(
    () => (known === undefined ? undefined : previewDetail(known)),
    [known],
  );
  return useQuery({
    ...issueDetailQueryOptions(identifier),
    ...(placeholder === undefined ? {} : { placeholderData: placeholder }),
  });
}

export function usePrefetchIssueDetail() {
  const client = useQueryClient();
  return useCallback(
    (identifier: string) => {
      client
        .prefetchQuery({ ...issueDetailQueryOptions(identifier), staleTime: PREFETCH_STALE_MS })
        .catch(() => undefined);
    },
    [client],
  );
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

function reconcile(search: string, issues: readonly Issue[], next: Issue): readonly Issue[] {
  const index = issues.findIndex((issue) => issue.id === next.id);
  if (!belongsInList(search, next)) {
    return index === -1 ? issues : issues.filter((issue) => issue.id !== next.id);
  }
  if (index !== -1) {
    const copy = [...issues];
    copy[index] = next;
    return sortForSearch(search, copy);
  }
  if (!admitsNewRows(search)) return issues;
  return sortForSearch(search, [...issues, next]);
}

function filteredListsHolding(
  client: QueryClient,
  moved: readonly Issue[],
): { key: QueryKey; held: boolean }[] {
  const ids = new Set(moved.map((issue) => issue.id));
  return client
    .getQueriesData<IssuePages>({ queryKey: [ISSUES_ROOT] })
    .filter(([key]) => !admitsNewRows(searchOf(key)))
    .map(([key, pages]) => ({
      key,
      held: pages !== undefined && flattenIssuePages(pages).some((issue) => ids.has(issue.id)),
    }));
}

function settleFilteredLists(
  client: QueryClient,
  moved: readonly Issue[],
  before: readonly { key: QueryKey; held: boolean }[],
): void {
  for (const { key, held } of before) {
    const search = searchOf(key);
    const belongsNow = moved.some((issue) => belongsInList(search, issue));
    if (!(held || belongsNow)) continue;
    client.invalidateQueries({ queryKey: key }).catch(() => undefined);
  }
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

function placeIssue(client: QueryClient, next: Issue, settle = true): void {
  const before = filteredListsHolding(client, [next]);
  eachIssueList(client, { queryKey: [ISSUES_ROOT] }, (issues, search) =>
    reconcile(search, issues, next),
  );
  if (settle) settleFilteredLists(client, [next], before);
}

function placeIssues(client: QueryClient, moved: readonly Issue[]): void {
  const before = filteredListsHolding(client, moved);
  eachIssueList(client, { queryKey: [ISSUES_ROOT] }, (issues, search) => {
    let next = issues;
    for (const issue of moved) next = reconcile(search, next, issue);
    return sortForSearch(search, next);
  });
  settleFilteredLists(client, moved, before);
}

function addToLists(client: QueryClient, next: Issue): void {
  const before = filteredListsHolding(client, [next]);
  eachIssueList(client, { queryKey: [ISSUES_ROOT] }, (issues, search) =>
    reconcile(search, issues, next),
  );
  settleFilteredLists(client, [next], before);
}

function refreshCounts(client: QueryClient): void {
  client.invalidateQueries({ queryKey: [ISSUE_SUMMARY_ROOT] }).catch(() => undefined);
}

function resortTeamIssueLists(client: QueryClient, teamId: string): void {
  eachIssueList(client, { queryKey: queryKeys.issueTeam(teamId) }, (issues, search) =>
    sortForSearch(search, issues),
  );
}

export function useUpdateIssue() {
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
      const previousDetail = client.getQueryData<IssueDetail>(
        queryKeys.issue(input.issue.identifier),
      );

      const optimistic: Issue = {
        ...input.issue,
        ...input.patch,
        labelIds:
          input.patch.labelIds === undefined ? input.issue.labelIds : [...input.patch.labelIds],
      };
      placeIssue(client, optimistic, false);
      if (previousDetail !== undefined) {
        client.setQueryData(queryKeys.issue(input.issue.identifier), {
          ...previousDetail,
          issue: {
            ...optimistic,
            description: input.patch.description ?? previousDetail.issue.description,
          },
        });
      }
      return { previousDetail, identifier: input.issue.identifier };
    },
    onError: (error, input, context) => {
      placeIssue(client, input.issue);
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

export interface IssueRegrouping {
  readonly stateId?: string;
  readonly cycleId?: string | null;
  readonly projectId?: string | null;
  readonly assigneeId?: string | null;
  readonly priority?: number;
}

export type MoveInput = IssueRegrouping & {
  readonly issue: Issue;
  readonly beforeId: string | null;
  readonly afterId: string | null;
  readonly beforeOrder: number | null;
  readonly afterOrder: number | null;
};

function regroupingOf(input: MoveInput): IssueRegrouping {
  return {
    ...(input.stateId === undefined ? {} : { stateId: input.stateId }),
    ...(input.cycleId === undefined ? {} : { cycleId: input.cycleId }),
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    ...(input.assigneeId === undefined ? {} : { assigneeId: input.assigneeId }),
    ...(input.priority === undefined ? {} : { priority: input.priority }),
  };
}

export function useMoveIssue() {
  const client = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: MoveInput): Promise<readonly Issue[]> => {
      const result = await apiFetch(`/api/issues/${input.issue.id}/move`, issueMoveResultSchema, {
        method: 'POST',
        body: { ...regroupingOf(input), beforeId: input.beforeId, afterId: input.afterId },
      });
      return [result.issue, ...result.rebalanced];
    },
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey: [ISSUES_ROOT] });
      const optimistic: Issue = {
        ...input.issue,
        ...regroupingOf(input),
        sortOrder: sortOrderBetween(input.beforeOrder, input.afterOrder),
      };
      placeIssue(client, optimistic, false);
      return {};
    },
    onError: (error, input) => {
      placeIssue(client, input.issue);
      toast({ title: 'Could not move that issue', description: messageOf(error), tone: 'danger' });
    },
    onSuccess: (moved) => {
      placeIssues(client, moved);
    },
    onSettled: (_moved, _error, input) => {
      resortTeamIssueLists(client, input.issue.teamId);
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

export function useCreateIssue(_teamId: string) {
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
      addToLists(client, issue);
      refreshCounts(client);
    },
  });
}

type ListSnapshot = readonly [QueryKey, IssuePages | undefined][];

function dropFromIssueLists(client: QueryClient, removed: ReadonlySet<string>): void {
  eachIssueList(client, { queryKey: [ISSUES_ROOT] }, (issues) => withoutIssues(issues, removed));
}

function dropFromIssueDetails(client: QueryClient, removed: ReadonlySet<string>): void {
  for (const [key, detail] of client.getQueriesData<IssueDetail>({ queryKey: [ISSUE_ROOT] })) {
    if (detail === undefined) continue;
    if (removed.has(detail.issue.id)) {
      client.resetQueries({ queryKey: key, exact: true });
      continue;
    }
    let next = detail;
    for (const id of removed) next = withoutSubIssue(next, id) ?? next;
    if (next !== detail) client.setQueryData(key, next);
  }
}

function restoreIssueLists(client: QueryClient, snapshot: ListSnapshot): void {
  for (const [key, pages] of snapshot) client.setQueryData(key, pages);
}

export class PartialIssueDelete extends Error {
  readonly gone: readonly string[];

  constructor(gone: readonly string[], cause: unknown) {
    super(messageOf(cause, 'That delete did not go through.'));
    this.name = 'PartialIssueDelete';
    this.gone = gone;
    this.cause = cause;
  }
}

async function deleteEach(issues: readonly Issue[]): Promise<readonly Issue[]> {
  const gone: string[] = [];
  for (const issue of issues) {
    try {
      await apiFetch(`/api/issues/${issue.id}`, issueDeletedSchema, { method: 'DELETE' });
    } catch (error: unknown) {
      throw new PartialIssueDelete(gone, error);
    }
    gone.push(issue.id);
  }
  return issues;
}

export function useDeleteIssues() {
  const client = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: deleteEach,
    onMutate: async (issues) => {
      await client.cancelQueries({ queryKey: [ISSUES_ROOT] });
      const snapshot: ListSnapshot = client.getQueriesData<IssuePages>({
        queryKey: [ISSUES_ROOT],
      });
      dropFromIssueLists(client, new Set(issues.map((issue) => issue.id)));
      return { snapshot };
    },
    onError: (error, _issues, context) => {
      if (context !== undefined) restoreIssueLists(client, context.snapshot);
      if (error instanceof PartialIssueDelete && error.gone.length > 0) {
        dropFromIssueLists(client, new Set(error.gone));
        dropFromIssueDetails(client, new Set(error.gone));
      }
      toast({ title: 'Could not delete', description: messageOf(error), tone: 'danger' });
    },
    onSuccess: (issues) => {
      dropFromIssueDetails(client, new Set(issues.map((issue) => issue.id)));
    },
    onSettled: () => {
      refreshCounts(client);
      client.invalidateQueries({ queryKey: [ISSUE_FACETS_ROOT] }).catch(() => undefined);
    },
  });
}
