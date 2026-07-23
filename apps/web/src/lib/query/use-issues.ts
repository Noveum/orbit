'use client';

import type { FilterPredicate, IssueOrdering } from '@orbit/shared/filters';
import { encodeFilterPredicates } from '@orbit/shared/filters';
import { sortOrderBetween } from '@orbit/shared/utils';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/toast.tsx';
import { apiFetch, messageOf } from './fetcher.ts';
import { queryKeys } from './keys.ts';
import type { Bootstrap, Issue, IssueDetail } from './schemas.ts';
import {
  bootstrapSchema,
  issueDetailSchema,
  issueEnvelopeSchema,
  issueListSchema,
  issueMoveResultSchema,
} from './schemas.ts';
import { sortIssues } from './sync.ts';

export function useBootstrap(teamKey: string | null) {
  return useQuery({
    queryKey: queryKeys.bootstrap(teamKey),
    queryFn: async ({ signal }): Promise<Bootstrap> =>
      await apiFetch(
        teamKey === null ? '/api/bootstrap' : `/api/bootstrap?team=${encodeURIComponent(teamKey)}`,
        bootstrapSchema,
        { signal },
      ),
  });
}

export interface IssueQuery {
  readonly predicates: readonly FilterPredicate[];
  readonly orderBy: IssueOrdering;
  readonly includeSubIssues: boolean;
}

export const DEFAULT_ISSUE_QUERY: IssueQuery = {
  predicates: [],
  orderBy: 'manual',
  includeSubIssues: true,
};

export function issueSearch(teamId: string, query: IssueQuery): string {
  const params = new URLSearchParams({ teamId, limit: '200', orderBy: query.orderBy });
  if (!query.includeSubIssues) params.set('includeSubIssues', 'false');
  const predicates = encodeFilterPredicates(query.predicates);
  if (predicates.length > 0) params.set('predicates', predicates);
  return params.toString();
}

export function useIssues(
  teamId: string | null,
  seed: readonly Issue[] | undefined,
  query: IssueQuery = DEFAULT_ISSUE_QUERY,
) {
  const search = teamId === null ? '' : issueSearch(teamId, query);
  return useQuery({
    queryKey: queryKeys.issues(teamId ?? 'none', search),
    enabled: teamId !== null,
    queryFn: async ({ signal }): Promise<readonly Issue[]> => {
      const page = await apiFetch(`/api/issues?${search}`, issueListSchema, { signal });
      return page.issues;
    },
    placeholderData: seed ?? keepPreviousData,
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

function replaceIssue(issues: readonly Issue[] | undefined, next: Issue): readonly Issue[] {
  if (issues === undefined) return [next];
  const index = issues.findIndex((issue) => issue.id === next.id);
  if (index === -1) return [...issues, next];
  const copy = [...issues];
  copy[index] = next;
  return copy;
}

type IssueListSnapshot = readonly [QueryKey, readonly Issue[] | undefined][];

function snapshotIssueLists(client: QueryClient, teamId: string): IssueListSnapshot {
  return client.getQueriesData<readonly Issue[]>({ queryKey: queryKeys.issueTeam(teamId) });
}

function restoreIssueLists(client: QueryClient, snapshot: IssueListSnapshot): void {
  for (const [key, issues] of snapshot) client.setQueryData(key, issues);
}

function patchIssueLists(
  client: QueryClient,
  teamId: string,
  update: (issues: readonly Issue[]) => readonly Issue[],
): void {
  client.setQueriesData<readonly Issue[]>({ queryKey: queryKeys.issueTeam(teamId) }, (current) =>
    current === undefined ? current : update(current),
  );
}

export function useUpdateIssue(teamId: string) {
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
      await client.cancelQueries({ queryKey: queryKeys.issueTeam(teamId) });
      const previous = snapshotIssueLists(client, teamId);
      const previousDetail = client.getQueryData<IssueDetail>(
        queryKeys.issue(input.issue.identifier),
      );

      const optimistic: Issue = {
        ...input.issue,
        ...input.patch,
        labelIds:
          input.patch.labelIds === undefined ? input.issue.labelIds : [...input.patch.labelIds],
      };
      patchIssueLists(client, teamId, (issues) => replaceIssue(issues, optimistic));
      if (previousDetail !== undefined) {
        client.setQueryData(queryKeys.issue(input.issue.identifier), {
          ...previousDetail,
          issue: optimistic,
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
      patchIssueLists(client, teamId, (issues) => replaceIssue(issues, issue));
      client.setQueryData<IssueDetail>(queryKeys.issue(issue.identifier), (current) =>
        current === undefined ? current : { ...current, issue },
      );
    },
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.issueTeam(teamId) });
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
      await client.cancelQueries({ queryKey: queryKeys.issueTeam(teamId) });
      const previous = snapshotIssueLists(client, teamId);
      const optimistic: Issue = {
        ...input.issue,
        stateId: input.stateId,
        sortOrder: sortOrderBetween(input.beforeOrder, input.afterOrder),
      };
      patchIssueLists(client, teamId, (issues) => replaceIssue(issues, optimistic));
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous !== undefined) restoreIssueLists(client, context.previous);
      toast({ title: 'Could not move that issue', description: messageOf(error), tone: 'danger' });
    },
    onSuccess: (moved) => {
      patchIssueLists(client, teamId, (current) => {
        let next = current;
        for (const issue of moved) next = replaceIssue(next, issue);
        return sortIssues(next);
      });
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
      patchIssueLists(client, teamId, (issues) => sortIssues(replaceIssue(issues, issue)));
    },
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.issueTeam(teamId) });
    },
  });
}

export function useDeleteIssue(teamId: string) {
  const client = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (issue: Issue): Promise<void> => {
      await apiFetch(`/api/issues/${issue.id}`, issueEnvelopeSchema.partial(), {
        method: 'DELETE',
      });
    },
    onMutate: async (issue) => {
      await client.cancelQueries({ queryKey: queryKeys.issueTeam(teamId) });
      const previous = snapshotIssueLists(client, teamId);
      patchIssueLists(client, teamId, (issues) => issues.filter((entry) => entry.id !== issue.id));
      return { previous };
    },
    onError: (error, _issue, context) => {
      if (context?.previous !== undefined) restoreIssueLists(client, context.previous);
      toast({ title: 'Could not delete', description: messageOf(error), tone: 'danger' });
    },
  });
}
