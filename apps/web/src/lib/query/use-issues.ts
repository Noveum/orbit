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
  issueCacheResetGeneration,
  issueCacheRevisionGeneration,
  issueDeletionGeneration,
  issueListRevisionGeneration,
  issueRevisionGeneration,
  recordIssueDeletions,
  recordIssueListRevisions,
  recordIssueRevisions,
} from './issue-cache-generation.ts';
import {
  ALL_ISSUES_QUERY,
  allIssuesSearch,
  assignedSearch,
  boardSearch,
  columnParamFor,
  columnSearch,
  cycleIssuesSearch,
  DEFAULT_ISSUE_QUERY,
  EMPTY_ISSUE_SCOPE,
  groupColumnSearch,
  ISSUE_PAGE_SIZE,
  type IssueQuery,
  issueSearch,
  projectIssuesSearch,
} from './issue-search.ts';
import {
  BOARD_ROOT,
  ISSUE_FACETS_ROOT,
  ISSUE_ROOT,
  ISSUE_SUMMARY_ROOT,
  ISSUES_ROOT,
  queryKeys,
} from './keys.ts';
import type {
  BoardPage,
  Bootstrap,
  Issue,
  IssueCounts,
  IssueDetail,
  IssueFacets,
  IssuePage,
  IssueSummary,
} from './schemas.ts';
import {
  boardPageSchema,
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
  isGroupColumn,
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

export const BOARD_SEED_STALE_MS = 15_000;

export interface BoardColumnKey {
  readonly query: IssueQuery;
  readonly groupBy: string;
  readonly scope: Readonly<Record<string, string>>;
}

export function columnScopeKey(scope: Readonly<Record<string, string>>): string {
  return scope['teamId'] ?? scope['projectId'] ?? 'workspace';
}

export function useColumnIssues(column: BoardColumnKey, groupId: string, enabled: boolean) {
  const search = groupColumnSearch(column.query, column.groupBy, groupId, column.scope);
  return useInfiniteQuery({
    ...pagedIssueOptions(queryKeys.issues(columnScopeKey(column.scope), search), search),
    enabled: enabled && search.length > 0,
    select: flattenIssuePages,
    staleTime: BOARD_SEED_STALE_MS,
    placeholderData: keepPreviousData,
  });
}

export function seedBoardColumns(
  client: QueryClient,
  column: BoardColumnKey,
  page: BoardPage,
  fetchedAt: number,
  revision = issueCacheRevisionGeneration(client),
): void {
  if (issueCacheRevisionGeneration(client) !== revision) return;
  for (const group of page.groups) {
    const search = groupColumnSearch(column.query, column.groupBy, group.id, column.scope);
    if (search.length === 0) continue;
    const key = queryKeys.issues(columnScopeKey(column.scope), search);
    const held = client.getQueryState(key);
    if (held !== undefined && held.data !== undefined && held.dataUpdatedAt >= fetchedAt) continue;
    client.setQueryData<IssuePages>(key, {
      pages: [{ issues: [...group.issues], nextCursor: group.nextCursor }],
      pageParams: [null],
    });
  }
}

export function useBoardPage(column: BoardColumnKey, enabled: boolean) {
  const client = useQueryClient();
  const search = boardSearch(column.query, column.groupBy, column.scope);

  return useQuery({
    queryKey: queryKeys.boardPage(search),
    enabled: enabled && columnParamFor(column.groupBy) !== null,
    staleTime: BOARD_SEED_STALE_MS,
    queryFn: async ({ signal }): Promise<BoardPage> => {
      const fetchedAt = Date.now();
      const revision = issueCacheRevisionGeneration(client);
      const page = await apiFetch(`/api/issues/board?${search}`, boardPageSchema, { signal });
      seedBoardColumns(client, column, page, fetchedAt, revision);
      return page;
    },
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

export function useCycleIssues(
  cycleId: string | null,
  query: IssueQuery = { ...DEFAULT_ISSUE_QUERY, orderBy: 'manual' },
) {
  const search = cycleId === null ? '' : cycleIssuesSearch(cycleId, query);
  return useInfiniteQuery({
    ...pagedIssueOptions(queryKeys.cycleIssues(cycleId ?? 'none', search), search),
    enabled: cycleId !== null,
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
    staleTime: PREFETCH_STALE_MS,
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
    parent: null,
    subscribed: false,
    attachments: [],
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
      client.prefetchQuery(issueDetailQueryOptions(identifier)).catch(() => undefined);
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
  readonly reviewerIds?: readonly string[];
  readonly projectId?: string | null;
  readonly milestoneId?: string | null;
  readonly cycleId?: string | null;
  readonly parentId?: string | null;
  readonly dueDate?: string | null;
  readonly estimate?: number | null;
  readonly labelIds?: readonly string[];
}

function reconcile(
  search: string,
  issues: readonly Issue[],
  next: Issue,
  admitNew = false,
): readonly Issue[] {
  const index = issues.findIndex((issue) => issue.id === next.id);
  const current = issues[index];
  if (current !== undefined && current.syncId > next.syncId) return issues;
  if (!belongsInList(search, next)) {
    return index === -1 ? issues : issues.filter((issue) => issue.id !== next.id);
  }
  if (index !== -1) {
    const copy = [...issues];
    copy[index] = next;
    return sortForSearch(search, copy);
  }
  if (!(admitNew || admitsNewRows(search))) return issues;
  return sortForSearch(search, [...issues, next]);
}

export type AuthoritativeCachedIssue =
  | { readonly kind: 'missing' }
  | { readonly kind: 'ambiguous' }
  | { readonly kind: 'found'; readonly issue: Issue };

export function authoritativeCachedIssue(
  client: QueryClient,
  issueId: string,
): AuthoritativeCachedIssue {
  const occurrences = client
    .getQueriesData<IssuePages>({ queryKey: [ISSUES_ROOT] })
    .flatMap(([, pages]) =>
      pages === undefined ? [] : flattenIssuePages(pages).filter((issue) => issue.id === issueId),
    );
  const newestSyncId = occurrences.reduce(
    (newest, issue) => Math.max(newest, issue.syncId),
    Number.NEGATIVE_INFINITY,
  );
  const newest = occurrences.filter((issue) => issue.syncId === newestSyncId);
  const issue = newest[0];
  if (issue === undefined) return { kind: 'missing' };
  const heads = new Set(newest.map(issueFingerprint));
  return heads.size === 1 ? { kind: 'found', issue } : { kind: 'ambiguous' };
}

function issueFromPages(pages: IssuePages | undefined, issueId: string): Issue | undefined {
  return pages === undefined
    ? undefined
    : flattenIssuePages(pages).find((issue) => issue.id === issueId);
}

function issueFingerprint(issue: Issue): string {
  return (
    JSON.stringify([
      issue.id,
      issue.teamId,
      issue.number,
      issue.identifier,
      issue.title,
      issue.stateId,
      issue.priority,
      issue.creatorId,
      issue.assigneeId,
      [...(issue.reviewerIds ?? [])].sort(),
      issue.projectId,
      issue.milestoneId,
      issue.cycleId,
      issue.parentId,
      issue.estimate,
      issue.dueDate,
      issue.sortOrder,
      issue.startedAt,
      issue.completedAt,
      issue.canceledAt,
      issue.syncId,
      issue.createdAt,
      issue.updatedAt,
      issue.archivedAt,
      [...issue.labelIds].sort(),
    ]) ?? ''
  );
}

function restoreIssueInPages(
  pages: IssuePages,
  search: string,
  issueId: string,
  before: Issue | undefined,
): IssuePages {
  return mapIssuePages(pages, (issues) => {
    const current = issues.find((issue) => issue.id === issueId);
    if (before === undefined && current === undefined) return issues;
    const without = current === undefined ? issues : issues.filter((issue) => issue.id !== issueId);
    return before === undefined ? without : reconcile(search, without, before, true);
  });
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

function filteredIssueListKeys(client: QueryClient): QueryKey[] {
  return client
    .getQueryCache()
    .findAll({ queryKey: [ISSUES_ROOT] })
    .flatMap((query) => (admitsNewRows(searchOf(query.queryKey)) ? [] : [query.queryKey]));
}

function issueListKeys(client: QueryClient): QueryKey[] {
  return client
    .getQueryCache()
    .findAll({ queryKey: [ISSUES_ROOT] })
    .map((query) => query.queryKey);
}

const ISSUE_SETTLEMENT_ATTEMPTS = 3;

async function refreshIssueListsUntilStable(
  client: QueryClient,
  initialKeys: readonly QueryKey[],
  issueIds: readonly string[],
  refetchAll: boolean,
  expandFiltered: boolean,
): Promise<void> {
  let keys = [...initialKeys];
  for (let attempt = 0; attempt < ISSUE_SETTLEMENT_ATTEMPTS && keys.length > 0; attempt += 1) {
    const listRevisions = keys.map((key) => issueListRevisionGeneration(client, key));
    const issueRevisions = issueIds.map((issueId) => issueRevisionGeneration(client, issueId));
    await Promise.all(
      keys.map((key) =>
        client
          .invalidateQueries(
            refetchAll ? { queryKey: key, exact: true, refetchType: 'all' } : { queryKey: key },
          )
          .catch(() => undefined),
      ),
    );
    const changedKeys = keys.filter(
      (key, index) => issueListRevisionGeneration(client, key) !== listRevisions[index],
    );
    const issueChanged = issueIds.some(
      (issueId, index) => issueRevisionGeneration(client, issueId) !== issueRevisions[index],
    );
    if (changedKeys.length === 0 && !issueChanged) return;
    if (issueChanged) {
      keys = expandFiltered ? filteredIssueListKeys(client) : keys;
    } else keys = changedKeys;
    if (attempt !== ISSUE_SETTLEMENT_ATTEMPTS - 1) continue;
    for (const key of keys) {
      client
        .invalidateQueries(
          refetchAll
            ? { queryKey: key, exact: true, refetchType: 'all' }
            : { queryKey: key, exact: true },
        )
        .catch(() => undefined);
    }
  }
}

async function settleFilteredLists(
  client: QueryClient,
  moved: readonly Issue[],
  before: readonly { key: QueryKey; held: boolean }[],
): Promise<void> {
  const keys: QueryKey[] = [];
  for (const { key, held } of before) {
    const search = searchOf(key);
    const belongsNow = moved.some((issue) => belongsInList(search, issue));
    if (!(held || belongsNow)) continue;
    keys.push(key);
  }
  await refreshIssueListsUntilStable(
    client,
    keys,
    moved.map((issue) => issue.id),
    false,
    true,
  );
}

export function staleBoardPages(client: QueryClient): void {
  client.invalidateQueries({ queryKey: [BOARD_ROOT], refetchType: 'none' }).catch(() => undefined);
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
  recordIssueRevisions(client, [next.id]);
  if (settle) settleFilteredLists(client, [next], before).catch(() => undefined);
}

function placeMovedIssue(client: QueryClient, next: Issue): void {
  eachIssueList(client, { queryKey: [ISSUES_ROOT] }, (issues, search) =>
    reconcile(search, issues, next, isGroupColumn(search, next)),
  );
  recordIssueRevisions(client, [next.id]);
}

async function placeIssues(client: QueryClient, moved: readonly Issue[]): Promise<void> {
  const before = filteredListsHolding(client, moved);
  eachIssueList(client, { queryKey: [ISSUES_ROOT] }, (issues, search) => {
    let next = issues;
    for (const issue of moved) {
      if (!next.some((current) => current.id === issue.id)) continue;
      next = reconcile(search, next, issue);
    }
    return sortForSearch(search, next);
  });
  recordIssueRevisions(
    client,
    moved.map((issue) => issue.id),
  );
  await settleFilteredLists(client, moved, before);
}

function addToLists(client: QueryClient, next: Issue): void {
  const before = filteredListsHolding(client, [next]);
  eachIssueList(client, { queryKey: [ISSUES_ROOT] }, (issues, search) =>
    reconcile(search, issues, next),
  );
  recordIssueRevisions(client, [next.id]);
  settleFilteredLists(client, [next], before).catch(() => undefined);
}

function refreshCounts(client: QueryClient): void {
  client.invalidateQueries({ queryKey: [ISSUE_SUMMARY_ROOT] }).catch(() => undefined);
  staleBoardPages(client);
}

async function invalidateIssueCaches(client: QueryClient): Promise<void> {
  await Promise.allSettled([
    client.invalidateQueries({ queryKey: [ISSUES_ROOT] }),
    client.invalidateQueries({ queryKey: [ISSUE_ROOT] }),
  ]);
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
      const detailKey = queryKeys.issue(input.issue.identifier);
      await Promise.allSettled([
        client.cancelQueries({ queryKey: [ISSUES_ROOT] }),
        client.cancelQueries({ queryKey: detailKey, exact: true }),
      ]);
      const previousDetail = client.getQueryData<IssueDetail>(detailKey);

      const { reviewerIds, ...patch } = input.patch;
      const optimistic: Issue = {
        ...input.issue,
        ...patch,
        ...(reviewerIds === undefined ? {} : { reviewerIds: [...reviewerIds] }),
        labelIds:
          input.patch.labelIds === undefined ? input.issue.labelIds : [...input.patch.labelIds],
      };
      placeIssue(client, optimistic, false);
      let optimisticDetail: IssueDetail | undefined;
      if (previousDetail !== undefined) {
        optimisticDetail = client.setQueryData<IssueDetail>(detailKey, {
          ...previousDetail,
          issue: {
            ...optimistic,
            description: input.patch.description ?? previousDetail.issue.description,
          },
        });
      }
      return {
        previousDetail,
        optimisticDetail,
        identifier: input.issue.identifier,
        resetGeneration: issueCacheResetGeneration(client),
        issueRevision: issueRevisionGeneration(client, input.issue.id),
      };
    },
    onError: (error, input, context) => {
      const currentDetail =
        context === undefined
          ? undefined
          : client.getQueryData<IssueDetail>(queryKeys.issue(context.identifier));
      const canRestore =
        context !== undefined &&
        issueCacheResetGeneration(client) === context.resetGeneration &&
        issueRevisionGeneration(client, input.issue.id) === context.issueRevision &&
        currentDetail === context.optimisticDetail;
      if (canRestore) {
        placeIssue(client, input.issue);
        if (context.previousDetail !== undefined) {
          client.setQueryData(queryKeys.issue(context.identifier), context.previousDetail);
        }
      } else {
        invalidateIssueCaches(client).catch(() => undefined);
      }
      toast({ title: 'Could not save', description: messageOf(error), tone: 'danger' });
    },
    onSuccess: (issue) => {
      placeIssue(client, issue);
      refreshCounts(client);
      client.setQueryData<IssueDetail>(queryKeys.issue(issue.identifier), (current) =>
        current === undefined || current.issue.syncId > issue.syncId
          ? current
          : { ...current, issue },
      );
    },
    onSettled: (_issue, _error, input) => {
      if (input.patch.parentId === undefined) return;
      client.invalidateQueries({ queryKey: [ISSUE_ROOT] }).catch(() => undefined);
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

const moveDeletionGenerations = new WeakMap<MoveInput, number>();

interface MoveListSnapshot {
  readonly key: QueryKey;
  readonly before: Issue | undefined;
  readonly optimistic: Issue | undefined;
  readonly listRevision: number;
}

interface MoveMutationContext {
  readonly lists: readonly MoveListSnapshot[];
  readonly deletionGeneration: number;
  readonly issueRevision: number;
  readonly resetGeneration: number;
}

export interface IssueMoveSettlement {
  readonly issues: readonly Issue[];
  readonly issueWasDeletedDuringSettlement: boolean;
}

function regroupingOf(input: MoveInput): IssueRegrouping {
  return {
    ...(input.stateId === undefined ? {} : { stateId: input.stateId }),
    ...(input.cycleId === undefined ? {} : { cycleId: input.cycleId }),
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    ...(input.assigneeId === undefined ? {} : { assigneeId: input.assigneeId }),
    ...(input.priority === undefined ? {} : { priority: input.priority }),
  };
}

function restoreFailedMoveAfterUnavailableRefresh(
  client: QueryClient,
  input: MoveInput,
  context: MoveMutationContext,
  refreshKeys: readonly QueryKey[],
): void {
  if (issueDeletionGeneration(client, input.issue.id) !== context.deletionGeneration) return;
  if (issueRevisionGeneration(client, input.issue.id) !== context.issueRevision) return;
  if (authoritativeCachedIssue(client, input.issue.id).kind !== 'missing') return;
  for (const snapshot of context.lists) {
    if (snapshot.before === undefined || snapshot.optimistic !== undefined) continue;
    if (!refreshKeys.includes(snapshot.key)) continue;
    if (issueListRevisionGeneration(client, snapshot.key) !== snapshot.listRevision) continue;
    const query = client.getQueryCache().find({ queryKey: snapshot.key, exact: true });
    if (query === undefined || query.state.error === null) continue;
    client.setQueryData<IssuePages>(snapshot.key, (pages) =>
      pages === undefined
        ? pages
        : restoreIssueInPages(pages, searchOf(snapshot.key), input.issue.id, snapshot.before),
    );
  }
}

function failedMoveRollbackFenced(
  client: QueryClient,
  input: MoveInput,
  context: MoveMutationContext | undefined,
): boolean {
  return (
    context !== undefined &&
    (issueCacheResetGeneration(client) !== context.resetGeneration ||
      issueRevisionGeneration(client, input.issue.id) !== context.issueRevision)
  );
}

async function rollbackFailedMove(
  client: QueryClient,
  input: MoveInput,
  context: MoveMutationContext | undefined,
): Promise<void> {
  const lists = context?.lists ?? [];
  const refreshKeys: QueryKey[] = [];
  const expected = new Set(
    lists.flatMap((snapshot) =>
      snapshot.optimistic === undefined ? [] : [issueFingerprint(snapshot.optimistic)],
    ),
  );
  const current = client
    .getQueriesData<IssuePages>({ queryKey: [ISSUES_ROOT] })
    .flatMap(([, pages]) => {
      const found = issueFromPages(pages, input.issue.id);
      return found === undefined ? [] : [found];
    });
  const hasOptimistic = current.some((issue) => expected.has(issueFingerprint(issue)));
  const intervening = current.some((issue) => !expected.has(issueFingerprint(issue)));

  for (const snapshot of lists) {
    const pages = client.getQueryData<IssuePages>(snapshot.key);
    const found = issueFromPages(pages, input.issue.id);
    const stillOptimistic =
      found === undefined
        ? snapshot.optimistic === undefined
        : snapshot.optimistic !== undefined &&
          issueFingerprint(found) === issueFingerprint(snapshot.optimistic);
    if (hasOptimistic && !intervening && stillOptimistic) {
      client.setQueryData<IssuePages>(snapshot.key, (pages) => {
        if (pages === undefined) return pages;
        const found = issueFromPages(pages, input.issue.id);
        if (found !== undefined && !expected.has(issueFingerprint(found))) return pages;
        return restoreIssueInPages(pages, searchOf(snapshot.key), input.issue.id, snapshot.before);
      });
      continue;
    }
    if (intervening && !stillOptimistic) continue;
    refreshKeys.push(snapshot.key);
  }
  await refreshIssueListsUntilStable(client, refreshKeys, [input.issue.id], true, false);
  if (context !== undefined) {
    restoreFailedMoveAfterUnavailableRefresh(client, input, context, refreshKeys);
  }
}

export function useMoveIssue() {
  const client = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: MoveInput): Promise<IssueMoveSettlement> => {
      const deletionGeneration =
        moveDeletionGenerations.get(input) ?? issueDeletionGeneration(client, input.issue.id);
      const result = await apiFetch(`/api/issues/${input.issue.id}/move`, issueMoveResultSchema, {
        method: 'POST',
        body: { ...regroupingOf(input), beforeId: input.beforeId, afterId: input.afterId },
      });
      return {
        issues: [result.issue, ...result.rebalanced],
        get issueWasDeletedDuringSettlement() {
          return issueDeletionGeneration(client, input.issue.id) !== deletionGeneration;
        },
      };
    },
    onMutate: async (input) => {
      moveDeletionGenerations.set(input, issueDeletionGeneration(client, input.issue.id));
      await Promise.allSettled([client.cancelQueries({ queryKey: [ISSUES_ROOT] })]);
      const before = client.getQueriesData<IssuePages>({ queryKey: [ISSUES_ROOT] });
      const optimistic: Issue = {
        ...input.issue,
        ...regroupingOf(input),
        sortOrder: sortOrderBetween(input.beforeOrder, input.afterOrder),
      };
      placeMovedIssue(client, optimistic);
      return {
        lists: before.map(([key, pages]) => ({
          key,
          before: issueFromPages(pages, input.issue.id),
          optimistic: issueFromPages(client.getQueryData<IssuePages>(key), input.issue.id),
          listRevision: issueListRevisionGeneration(client, key),
        })),
        deletionGeneration:
          moveDeletionGenerations.get(input) ?? issueDeletionGeneration(client, input.issue.id),
        issueRevision: issueRevisionGeneration(client, input.issue.id),
        resetGeneration: issueCacheResetGeneration(client),
      };
    },
    onError: async (error, input, context) => {
      toast({ title: 'Could not move that issue', description: messageOf(error), tone: 'danger' });
      if (failedMoveRollbackFenced(client, input, context)) await invalidateIssueCaches(client);
      else await rollbackFailedMove(client, input, context);
    },
    onSuccess: async (settlement, input) => {
      const confirmedDeletedIds = settlement.issues
        .filter((issue) => issueDeletionGeneration(client, issue.id) > 0)
        .map((issue) => issue.id);
      const confirmedDeleted = new Set(confirmedDeletedIds);
      await placeIssues(
        client,
        settlement.issues.filter((issue) => !confirmedDeleted.has(issue.id)),
      );
      if (confirmedDeleted.size > 0) dropFromIssueLists(client, confirmedDeleted);
      if (settlement.issueWasDeletedDuringSettlement) {
        dropFromIssueLists(client, new Set([input.issue.id]));
      }
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
  readonly reviewerIds?: readonly string[];
  readonly projectId: string | null;
  readonly cycleId: string | null;
  readonly parentId?: string | null;
  readonly dueDate?: string | null;
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
    onSuccess: (issue, input) => {
      addToLists(client, issue);
      refreshCounts(client);
      if (input.parentId === undefined || input.parentId === null) return;
      client.invalidateQueries({ queryKey: [ISSUE_ROOT] }).catch(() => undefined);
    },
  });
}

interface DeleteListSnapshot {
  readonly key: QueryKey;
  readonly before: IssuePages | undefined;
  readonly optimistic: IssuePages | undefined;
}

interface DeleteMutationContext {
  readonly lists: readonly DeleteListSnapshot[];
  readonly issueRevisions: ReadonlyMap<string, number>;
  readonly resetGeneration: number;
}

function dropFromIssueLists(client: QueryClient, removed: ReadonlySet<string>): void {
  eachIssueList(client, { queryKey: [ISSUES_ROOT] }, (issues) => withoutIssues(issues, removed));
}

function orphanRemovedParent(detail: IssueDetail, removed: ReadonlySet<string>): IssueDetail {
  const parentIdRemoved = detail.issue.parentId !== null && removed.has(detail.issue.parentId);
  const parentRemoved = detail.parent !== null && removed.has(detail.parent.id);
  if (!(parentIdRemoved || parentRemoved)) return detail;
  return {
    ...detail,
    issue: parentIdRemoved ? { ...detail.issue, parentId: null } : detail.issue,
    parent: null,
  };
}

async function dropFromIssueDetails(
  client: QueryClient,
  removed: ReadonlySet<string>,
): Promise<void> {
  const fetchingKeys = client
    .getQueryCache()
    .findAll({ queryKey: [ISSUE_ROOT] })
    .flatMap((query) => (query.state.fetchStatus === 'fetching' ? [query.queryKey] : []));
  await Promise.allSettled(
    fetchingKeys.map((key) => client.cancelQueries({ queryKey: key, exact: true })),
  );
  for (const [key, detail] of client.getQueriesData<IssueDetail>({ queryKey: [ISSUE_ROOT] })) {
    if (detail === undefined) continue;
    if (removed.has(detail.issue.id)) {
      client.resetQueries({ queryKey: key, exact: true }).catch(() => undefined);
      continue;
    }
    let next = orphanRemovedParent(detail, removed);
    for (const id of removed) next = withoutSubIssue(next, id) ?? next;
    if (next !== detail) client.setQueryData(key, next);
  }
  for (const key of fetchingKeys) {
    client.invalidateQueries({ queryKey: key, exact: true }).catch(() => undefined);
  }
}

function deletionChangedIssueIds(snapshot: DeleteListSnapshot): string[] {
  if (snapshot.before === undefined) return [];
  return flattenIssuePages(snapshot.before).flatMap((issue) => {
    const optimistic = issueFromPages(snapshot.optimistic, issue.id);
    return optimistic === undefined || issueFingerprint(optimistic) !== issueFingerprint(issue)
      ? [issue.id]
      : [];
  });
}

function restoreDeletedIssueInPages(
  pages: IssuePages,
  snapshot: IssuePages | undefined,
  issueId: string,
  before: Issue | undefined,
): IssuePages {
  return mapIssuePages(pages, (issues) => {
    const currentIndex = issues.findIndex((issue) => issue.id === issueId);
    if (before === undefined) {
      return currentIndex === -1 ? issues : issues.filter((issue) => issue.id !== issueId);
    }
    if (currentIndex !== -1) {
      const restored = [...issues];
      restored[currentIndex] = before;
      return restored;
    }
    const beforeRows = snapshot === undefined ? [] : flattenIssuePages(snapshot);
    const snapshotIndex = beforeRows.findIndex((issue) => issue.id === issueId);
    const previous = beforeRows
      .slice(0, Math.max(0, snapshotIndex))
      .reverse()
      .find((issue) => issues.some((current) => current.id === issue.id));
    if (previous !== undefined) {
      const insertAt = issues.findIndex((issue) => issue.id === previous.id) + 1;
      return [...issues.slice(0, insertAt), before, ...issues.slice(insertAt)];
    }
    const following = beforeRows
      .slice(snapshotIndex + 1)
      .find((issue) => issues.some((current) => current.id === issue.id));
    if (following !== undefined) {
      const insertAt = issues.findIndex((issue) => issue.id === following.id);
      return [...issues.slice(0, insertAt), before, ...issues.slice(insertAt)];
    }
    return [...issues, before];
  });
}

function restorableDeletedIssueIds(
  client: QueryClient,
  context: DeleteMutationContext,
  changedIds: readonly string[],
): string[] {
  return changedIds.filter(
    (issueId) => issueRevisionGeneration(client, issueId) === context.issueRevisions.get(issueId),
  );
}

function cachedIssueMatches(present: Issue | undefined, expected: Issue | undefined): boolean {
  if (present === undefined) return expected === undefined;
  return expected !== undefined && issueFingerprint(present) === issueFingerprint(expected);
}

function restoreIssueList(
  client: QueryClient,
  context: DeleteMutationContext,
  snapshot: DeleteListSnapshot,
  current: IssuePages | undefined,
): IssuePages | undefined {
  const changedIds = deletionChangedIssueIds(snapshot);
  if (changedIds.length === 0) return current;
  const restorable = restorableDeletedIssueIds(client, context, changedIds);
  if (current === undefined) {
    return restorable.length === changedIds.length ? snapshot.before : current;
  }
  let restored = current;
  for (const issueId of restorable) {
    const optimistic = issueFromPages(snapshot.optimistic, issueId);
    if (!cachedIssueMatches(issueFromPages(restored, issueId), optimistic)) continue;
    restored = restoreDeletedIssueInPages(
      restored,
      snapshot.before,
      issueId,
      issueFromPages(snapshot.before, issueId),
    );
  }
  return mapIssuePages(restored, (issues) => sortForSearch(searchOf(snapshot.key), issues));
}

function restoreIssueLists(client: QueryClient, context: DeleteMutationContext): void {
  for (const snapshot of context.lists) {
    client.setQueryData<IssuePages>(snapshot.key, (current) =>
      restoreIssueList(client, context, snapshot, current),
    );
  }
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
      await Promise.allSettled([client.cancelQueries({ queryKey: [ISSUES_ROOT] })]);
      const before = client.getQueriesData<IssuePages>({
        queryKey: [ISSUES_ROOT],
      });
      dropFromIssueLists(client, new Set(issues.map((issue) => issue.id)));
      const lists = before.map(([key, pages]) => ({
        key,
        before: pages,
        optimistic: client.getQueryData<IssuePages>(key),
      }));
      const changedIds = new Set(lists.flatMap(deletionChangedIssueIds));
      return {
        lists,
        issueRevisions: new Map(
          [...changedIds].map((issueId) => [issueId, issueRevisionGeneration(client, issueId)]),
        ),
        resetGeneration: issueCacheResetGeneration(client),
      };
    },
    onError: async (error, _issues, context) => {
      const partiallyDeleted = error instanceof PartialIssueDelete && error.gone.length > 0;
      if (partiallyDeleted) {
        recordIssueDeletions(client, error.gone);
        recordIssueListRevisions(client, issueListKeys(client));
        await Promise.allSettled([client.cancelQueries({ queryKey: [ISSUES_ROOT] })]);
      }
      const resetChanged =
        context !== undefined && issueCacheResetGeneration(client) !== context.resetGeneration;
      if (context !== undefined && !resetChanged) restoreIssueLists(client, context);
      if (resetChanged) await invalidateIssueCaches(client);
      if (partiallyDeleted) {
        dropFromIssueLists(client, new Set(error.gone));
        await dropFromIssueDetails(client, new Set(error.gone));
      }
      toast({ title: 'Could not delete', description: messageOf(error), tone: 'danger' });
    },
    onSuccess: async (issues) => {
      const removed = new Set(issues.map((issue) => issue.id));
      recordIssueDeletions(
        client,
        issues.map((issue) => issue.id),
      );
      recordIssueListRevisions(client, issueListKeys(client));
      await Promise.allSettled([client.cancelQueries({ queryKey: [ISSUES_ROOT] })]);
      dropFromIssueLists(client, removed);
      await dropFromIssueDetails(client, removed);
    },
    onSettled: () => {
      refreshCounts(client);
      client.invalidateQueries({ queryKey: [ISSUE_FACETS_ROOT] }).catch(() => undefined);
    },
  });
}
