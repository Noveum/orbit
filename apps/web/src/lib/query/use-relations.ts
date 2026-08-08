'use client';

import type { IssueRelationType } from '@orbit/shared/constants';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/toast.tsx';
import { apiFetch, messageOf } from './fetcher.ts';
import { queryKeys } from './keys.ts';
import type { IssueRelation } from './schemas.ts';
import { issueRelationListSchema } from './schemas.ts';

export interface RelationInput {
  readonly relatedIssueId: string;
  readonly type: IssueRelationType;
}

function relationsPath(issueId: string): string {
  return `/api/issues/${encodeURIComponent(issueId)}/relations`;
}

export function useIssueRelations(issueId: string | null) {
  return useQuery({
    queryKey: queryKeys.issueRelations(issueId ?? 'none'),
    enabled: issueId !== null,
    queryFn: async ({ signal }): Promise<readonly IssueRelation[]> => {
      const result = await apiFetch(relationsPath(issueId ?? ''), issueRelationListSchema, {
        signal,
      });
      return result.relations;
    },
  });
}

export function useSetRelation(issueId: string) {
  const client = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: RelationInput): Promise<readonly IssueRelation[]> => {
      const result = await apiFetch(relationsPath(issueId), issueRelationListSchema, {
        method: 'POST',
        body: input,
      });
      return result.relations;
    },
    onError: (error) => {
      toast({ title: 'Could not link that issue', description: messageOf(error), tone: 'danger' });
    },
    onSuccess: (relations) => {
      client.setQueryData(queryKeys.issueRelations(issueId), relations);
    },
  });
}

export function useRemoveRelation(issueId: string) {
  const client = useQueryClient();
  const { toast } = useToast();
  const key = queryKeys.issueRelations(issueId);

  return useMutation({
    mutationFn: async (input: RelationInput): Promise<readonly IssueRelation[]> => {
      const search = new URLSearchParams({
        relatedIssueId: input.relatedIssueId,
        type: input.type,
      });
      const result = await apiFetch(
        `${relationsPath(issueId)}?${search.toString()}`,
        issueRelationListSchema,
        { method: 'DELETE' },
      );
      return result.relations;
    },
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<readonly IssueRelation[]>(key);
      client.setQueryData<readonly IssueRelation[]>(key, (current) =>
        (current ?? []).filter(
          (entry) => !(entry.issue.id === input.relatedIssueId && entry.type === input.type),
        ),
      );
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous !== undefined) client.setQueryData(key, context.previous);
      toast({
        title: 'Could not unlink that issue',
        description: messageOf(error),
        tone: 'danger',
      });
    },
    onSuccess: (relations) => {
      client.setQueryData(key, relations);
    },
  });
}
