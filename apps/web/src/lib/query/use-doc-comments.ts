'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/toast.tsx';
import { useCurrentUserId } from '@/lib/realtime/session.tsx';
import { apiFetch, messageOf } from './fetcher.ts';
import { queryKeys } from './keys.ts';
import type { DocComment } from './schemas.ts';
import { deletedSchema, docCommentEnvelopeSchema, docCommentListSchema } from './schemas.ts';

export const DOC_COMMENT_PAGE_SIZE = 50;

export function useDocComments(docId: string | null) {
  return useQuery({
    queryKey: queryKeys.docComments(docId ?? 'none'),
    enabled: docId !== null,
    queryFn: async ({ signal }): Promise<readonly DocComment[]> => {
      const all: DocComment[] = [];
      let cursor: string | null = null;
      do {
        const params = new URLSearchParams({ limit: String(DOC_COMMENT_PAGE_SIZE) });
        if (cursor !== null) params.set('cursor', cursor);
        const result = await apiFetch(
          `/api/docs/${encodeURIComponent(docId ?? '')}/comments?${params.toString()}`,
          docCommentListSchema,
          { signal },
        );
        all.push(...result.comments);
        cursor = result.nextCursor;
      } while (cursor !== null);
      return all;
    },
  });
}

export function useCreateDocComment(docId: string) {
  const client = useQueryClient();
  const { toast } = useToast();
  const userId = useCurrentUserId();
  const key = queryKeys.docComments(docId);

  return useMutation({
    mutationFn: async (input: { body: string; parentId: string | null }): Promise<DocComment> => {
      const result = await apiFetch(
        `/api/docs/${encodeURIComponent(docId)}/comments`,
        docCommentEnvelopeSchema,
        { method: 'POST', body: input },
      );
      return result.comment;
    },
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<readonly DocComment[]>(key);
      const now = new Date().toISOString();
      const pendingId = `pending-${crypto.randomUUID()}`;
      const optimistic: DocComment = {
        comment: {
          id: pendingId,
          docId,
          authorId: userId ?? 'me',
          parentId: input.parentId,
          body: input.body,
          editedAt: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
          syncId: 0,
        },
        bodyHtml: '',
      };
      client.setQueryData<readonly DocComment[]>(key, [...(previous ?? []), optimistic]);
      return { previous, pendingId };
    },
    onError: (error, _input, context) => {
      if (context?.previous !== undefined) client.setQueryData(key, context.previous);
      toast({ title: 'Could not post', description: messageOf(error), tone: 'danger' });
    },
    onSuccess: (comment, _input, context) => {
      client.setQueryData<readonly DocComment[]>(key, (current) => {
        const without = (current ?? []).filter((entry) => entry.comment.id !== context?.pendingId);
        return [...without.filter((entry) => entry.comment.id !== comment.comment.id), comment];
      });
    },
  });
}

export function useUpdateDocComment(docId: string) {
  const client = useQueryClient();
  const { toast } = useToast();
  const key = queryKeys.docComments(docId);

  return useMutation({
    mutationFn: async (input: { id: string; body: string }): Promise<DocComment> => {
      const result = await apiFetch(
        `/api/docs/${encodeURIComponent(docId)}/comments/${input.id}`,
        docCommentEnvelopeSchema,
        { method: 'PATCH', body: { body: input.body } },
      );
      return result.comment;
    },
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<readonly DocComment[]>(key);
      client.setQueryData<readonly DocComment[]>(key, (current) =>
        (current ?? []).map((entry) =>
          entry.comment.id === input.id
            ? { ...entry, comment: { ...entry.comment, body: input.body }, bodyHtml: '' }
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
      client.setQueryData<readonly DocComment[]>(key, (current) =>
        (current ?? []).map((entry) => (entry.comment.id === comment.comment.id ? comment : entry)),
      );
    },
  });
}

export function useDeleteDocComment(docId: string) {
  const client = useQueryClient();
  const { toast } = useToast();
  const key = queryKeys.docComments(docId);

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiFetch(`/api/docs/${encodeURIComponent(docId)}/comments/${id}`, deletedSchema, {
        method: 'DELETE',
      });
    },
    onMutate: async (id) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<readonly DocComment[]>(key);
      client.setQueryData<readonly DocComment[]>(key, (current) =>
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
