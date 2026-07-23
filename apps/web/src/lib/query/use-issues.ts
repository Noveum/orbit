'use client';

import { sortOrderBetween } from '@orbit/shared/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

const TEAM_ISSUE_LIMIT = 200;

export function teamIssuesQuery(teamId: string) {
  return {
    queryKey: queryKeys.issues(teamId),
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<readonly Issue[]> => {
      const page = await apiFetch(
        `/api/issues?teamId=${encodeURIComponent(teamId)}&limit=${TEAM_ISSUE_LIMIT}`,
        issueListSchema,
        { signal },
      );
      return page.issues;
    },
  };
}

export function useIssues(teamId: string | null, seed: readonly Issue[] | undefined) {
  return useQuery({
    ...teamIssuesQuery(teamId ?? 'none'),
    enabled: teamId !== null,
    ...(seed === undefined ? {} : { placeholderData: seed }),
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
      await client.cancelQueries({ queryKey: queryKeys.issues(teamId) });
      const previous = client.getQueryData<readonly Issue[]>(queryKeys.issues(teamId));
      const previousDetail = client.getQueryData<IssueDetail>(
        queryKeys.issue(input.issue.identifier),
      );

      const optimistic: Issue = {
        ...input.issue,
        ...input.patch,
        labelIds:
          input.patch.labelIds === undefined ? input.issue.labelIds : [...input.patch.labelIds],
      };
      client.setQueryData(queryKeys.issues(teamId), replaceIssue(previous, optimistic));
      if (previousDetail !== undefined) {
        client.setQueryData(queryKeys.issue(input.issue.identifier), {
          ...previousDetail,
          issue: optimistic,
        });
      }
      return { previous, previousDetail, identifier: input.issue.identifier };
    },
    onError: (error, _input, context) => {
      if (context?.previous !== undefined) {
        client.setQueryData(queryKeys.issues(teamId), context.previous);
      }
      if (context?.previousDetail !== undefined && context.identifier !== undefined) {
        client.setQueryData(queryKeys.issue(context.identifier), context.previousDetail);
      }
      toast({ title: 'Could not save', description: messageOf(error), tone: 'danger' });
    },
    onSuccess: (issue) => {
      client.setQueryData<readonly Issue[]>(queryKeys.issues(teamId), (current) =>
        replaceIssue(current, issue),
      );
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
      await client.cancelQueries({ queryKey: queryKeys.issues(teamId) });
      const previous = client.getQueryData<readonly Issue[]>(queryKeys.issues(teamId));
      const optimistic: Issue = {
        ...input.issue,
        stateId: input.stateId,
        sortOrder: sortOrderBetween(input.beforeOrder, input.afterOrder),
      };
      client.setQueryData(queryKeys.issues(teamId), replaceIssue(previous, optimistic));
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous !== undefined) {
        client.setQueryData(queryKeys.issues(teamId), context.previous);
      }
      toast({ title: 'Could not move that issue', description: messageOf(error), tone: 'danger' });
    },
    onSuccess: (issues) => {
      client.setQueryData<readonly Issue[]>(queryKeys.issues(teamId), (current) => {
        let next = current ?? [];
        for (const issue of issues) next = replaceIssue(next, issue);
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
      client.setQueryData<readonly Issue[]>(queryKeys.issues(teamId), (current) =>
        sortIssues(replaceIssue(current, issue)),
      );
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
      await client.cancelQueries({ queryKey: queryKeys.issues(teamId) });
      const previous = client.getQueryData<readonly Issue[]>(queryKeys.issues(teamId));
      client.setQueryData<readonly Issue[]>(queryKeys.issues(teamId), (current) =>
        (current ?? []).filter((entry) => entry.id !== issue.id),
      );
      return { previous };
    },
    onError: (error, _issue, context) => {
      if (context?.previous !== undefined) {
        client.setQueryData(queryKeys.issues(teamId), context.previous);
      }
      toast({ title: 'Could not delete', description: messageOf(error), tone: 'danger' });
    },
  });
}
