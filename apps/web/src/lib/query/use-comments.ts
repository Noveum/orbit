'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/toast.tsx';
import { useCurrentUserId } from '@/lib/realtime/session.tsx';
import { apiFetch, messageOf } from './fetcher.ts';
import { queryKeys } from './keys.ts';
import type { Comment } from './schemas.ts';
import {
  commentEnvelopeSchema,
  commentListSchema,
  deletedSchema,
  reactionResultSchema,
} from './schemas.ts';

export function useComments(issueId: string | null) {
  return useQuery({
    queryKey: queryKeys.comments(issueId ?? 'none'),
    enabled: issueId !== null,
    queryFn: async ({ signal }): Promise<readonly Comment[]> => {
      const result = await apiFetch(
        `/api/comments?issueId=${encodeURIComponent(issueId ?? '')}`,
        commentListSchema,
        { signal },
      );
      return result.comments;
    },
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function useCreateComment(issueId: string) {
  const client = useQueryClient();
  const { toast } = useToast();
  const userId = useCurrentUserId();
  const key = queryKeys.comments(issueId);

  return useMutation({
    mutationFn: async (input: { body: string; parentId: string | null }): Promise<Comment> => {
      const result = await apiFetch(
        `/api/comments?issueId=${encodeURIComponent(issueId)}`,
        commentEnvelopeSchema,
        { method: 'POST', body: input },
      );
      return result.comment;
    },
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<readonly Comment[]>(key);
      const now = new Date().toISOString();
      const pendingId = `pending-${now}`;
      const optimistic: Comment = {
        comment: {
          id: pendingId,
          issueId,
          authorId: userId ?? 'me',
          parentId: input.parentId,
          body: input.body,
          editedAt: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          syncId: 0,
        },
        bodyHtml: `<p>${escapeHtml(input.body)}</p>`,
        reactions: [],
      };
      client.setQueryData<readonly Comment[]>(key, [...(previous ?? []), optimistic]);
      return { previous, pendingId };
    },
    onError: (error, _input, context) => {
      if (context?.previous !== undefined) client.setQueryData(key, context.previous);
      toast({ title: 'Could not post', description: messageOf(error), tone: 'danger' });
    },
    onSuccess: (comment, _input, context) => {
      client.setQueryData<readonly Comment[]>(key, (current) => {
        const without = (current ?? []).filter((entry) => entry.comment.id !== context?.pendingId);
        return [...without.filter((entry) => entry.comment.id !== comment.comment.id), comment];
      });
    },
  });
}

export function useUpdateComment(issueId: string) {
  const client = useQueryClient();
  const { toast } = useToast();
  const key = queryKeys.comments(issueId);

  return useMutation({
    mutationFn: async (input: { id: string; body: string }): Promise<Comment> => {
      const result = await apiFetch(`/api/comments/${input.id}`, commentEnvelopeSchema, {
        method: 'PATCH',
        body: { body: input.body },
      });
      return result.comment;
    },
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<readonly Comment[]>(key);
      client.setQueryData<readonly Comment[]>(key, (current) =>
        (current ?? []).map((entry) =>
          entry.comment.id === input.id
            ? {
                ...entry,
                comment: { ...entry.comment, body: input.body },
                bodyHtml: `<p>${escapeHtml(input.body)}</p>`,
              }
            : entry,
        ),
      );
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous !== undefined) client.setQueryData(key, context.previous);
      toast({ title: 'Could not edit', description: messageOf(error), tone: 'danger' });
    },
    onSuccess: (comment) => {
      client.setQueryData<readonly Comment[]>(key, (current) =>
        (current ?? []).map((entry) =>
          entry.comment.id === comment.comment.id
            ? { ...comment, reactions: entry.reactions }
            : entry,
        ),
      );
    },
  });
}

export function useDeleteComment(issueId: string) {
  const client = useQueryClient();
  const { toast } = useToast();
  const key = queryKeys.comments(issueId);

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiFetch(`/api/comments/${id}`, deletedSchema, { method: 'DELETE' });
    },
    onMutate: async (id) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<readonly Comment[]>(key);
      client.setQueryData<readonly Comment[]>(key, (current) =>
        (current ?? []).filter((entry) => entry.comment.id !== id),
      );
      return { previous };
    },
    onError: (error, _id, context) => {
      if (context?.previous !== undefined) client.setQueryData(key, context.previous);
      toast({ title: 'Could not delete', description: messageOf(error), tone: 'danger' });
    },
  });
}

export function useToggleReaction(issueId: string) {
  const client = useQueryClient();
  const { toast } = useToast();
  const userId = useCurrentUserId();
  const key = queryKeys.comments(issueId);

  return useMutation({
    mutationFn: async (input: { commentId: string; emoji: string }): Promise<void> => {
      await apiFetch(`/api/comments/${input.commentId}/reactions`, reactionResultSchema, {
        method: 'POST',
        body: { emoji: input.emoji },
      });
    },
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<readonly Comment[]>(key);
      client.setQueryData<readonly Comment[]>(key, (current) =>
        (current ?? []).map((entry) => {
          if (entry.comment.id !== input.commentId) return entry;
          const mine = entry.reactions.find(
            (reaction) => reaction.emoji === input.emoji && reaction.userId === userId,
          );
          if (mine !== undefined) {
            return {
              ...entry,
              reactions: entry.reactions.filter((reaction) => reaction.id !== mine.id),
            };
          }
          return {
            ...entry,
            reactions: [
              ...entry.reactions,
              {
                id: `pending-${input.emoji}`,
                commentId: input.commentId,
                userId: userId ?? 'me',
                emoji: input.emoji,
              },
            ],
          };
        }),
      );
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous !== undefined) client.setQueryData(key, context.previous);
      toast({ title: 'Could not react', description: messageOf(error), tone: 'danger' });
    },
    onSettled: () => {
      client.invalidateQueries({ queryKey: key });
    },
  });
}
