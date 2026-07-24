'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/toast.tsx';
import { apiFetch, messageOf } from './fetcher.ts';
import { DOCS_ROOT, queryKeys } from './keys.ts';
import type { Doc, DocCollection, DocDetail, DocList, DocVersion } from './schemas.ts';
import {
  deletedSchema,
  docArchiveResultSchema,
  docCollectionEnvelopeSchema,
  docDetailSchema,
  docEnvelopeSchema,
  docListSchema,
  docSaveResultSchema,
  docShareResultSchema,
  docVersionListSchema,
} from './schemas.ts';

export interface DocPatch {
  readonly title?: string;
  readonly content?: string;
  readonly collectionId?: string | null;
  readonly projectId?: string | null;
  readonly parentId?: string | null;
}

export interface DocShareInput {
  readonly visibility: string;
  readonly rotateToken?: boolean;
}

export function useDocs(search: string) {
  return useQuery({
    queryKey: queryKeys.docs(search),
    queryFn: async ({ signal }): Promise<DocList> => {
      const query = search.trim().length === 0 ? '' : `?query=${encodeURIComponent(search.trim())}`;
      return await apiFetch(`/api/docs${query}`, docListSchema, { signal });
    },
    placeholderData: (previous) => previous,
  });
}

export function useDoc(docId: string | null) {
  return useQuery({
    queryKey: queryKeys.doc(docId ?? 'none'),
    enabled: docId !== null,
    queryFn: async ({ signal }): Promise<DocDetail> =>
      await apiFetch(`/api/docs/${docId ?? ''}`, docDetailSchema, { signal }),
  });
}

function invalidateDocs(client: ReturnType<typeof useQueryClient>): void {
  client.invalidateQueries({ queryKey: [DOCS_ROOT] }).catch(() => undefined);
}

export function useCreateDoc() {
  const client = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: {
      title: string;
      content?: string;
      collectionId?: string | null;
      projectId?: string | null;
      parentId?: string | null;
    }): Promise<Doc> => {
      const result = await apiFetch('/api/docs', docEnvelopeSchema, {
        method: 'POST',
        body: input,
      });
      return result.doc;
    },
    onSuccess: () => invalidateDocs(client),
    onError: (error) =>
      toast({ title: 'Could not create the doc', description: messageOf(error), tone: 'danger' }),
  });
}

export function useUpdateDoc(docId: string) {
  const client = useQueryClient();
  const { toast } = useToast();
  const key = queryKeys.doc(docId);

  return useMutation({
    mutationFn: async (patch: DocPatch): Promise<{ doc: Doc; contentHtml: string }> =>
      await apiFetch(`/api/docs/${docId}`, docSaveResultSchema, {
        method: 'PATCH',
        body: patch,
      }),
    onMutate: async (patch) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<DocDetail>(key);
      if (previous !== undefined) {
        client.setQueryData<DocDetail>(key, { ...previous, doc: { ...previous.doc, ...patch } });
      }
      return { previous };
    },
    onError: (error, _patch, context) => {
      if (context?.previous !== undefined) client.setQueryData(key, context.previous);
      toast({ title: 'Could not save', description: messageOf(error), tone: 'danger' });
    },
    onSuccess: (result) => {
      client.setQueryData<DocDetail>(key, (current) =>
        current === undefined
          ? current
          : { ...current, doc: result.doc, contentHtml: result.contentHtml },
      );
      invalidateDocs(client);
    },
  });
}

export function useShareDoc(docId: string) {
  const client = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: DocShareInput): Promise<{ doc: Doc; publishUrl: string | null }> =>
      await apiFetch(`/api/docs/${docId}/share`, docShareResultSchema, {
        method: 'POST',
        body: { visibility: input.visibility, rotateToken: input.rotateToken ?? false },
      }),
    onSuccess: (result) => {
      client.setQueryData<DocDetail>(queryKeys.doc(docId), (current) =>
        current === undefined ? current : { ...current, doc: result.doc },
      );
      invalidateDocs(client);
    },
    onError: (error) =>
      toast({ title: 'Could not update sharing', description: messageOf(error), tone: 'danger' }),
  });
}

export function useArchiveDoc() {
  const client = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (docId: string): Promise<void> => {
      await apiFetch(`/api/docs/${docId}`, docArchiveResultSchema, { method: 'DELETE' });
    },
    onSuccess: () => invalidateDocs(client),
    onError: (error) =>
      toast({ title: 'Could not archive', description: messageOf(error), tone: 'danger' }),
  });
}

export function useCreateCollection() {
  const client = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (name: string): Promise<DocCollection> => {
      const result = await apiFetch('/api/docs/collections', docCollectionEnvelopeSchema, {
        method: 'POST',
        body: { name },
      });
      return result.collection;
    },
    onSuccess: () => invalidateDocs(client),
    onError: (error) =>
      toast({ title: 'Could not create', description: messageOf(error), tone: 'danger' }),
  });
}

export function useRenameCollection() {
  const client = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: { id: string; name: string }): Promise<DocCollection> => {
      const result = await apiFetch(
        `/api/docs/collections/${input.id}`,
        docCollectionEnvelopeSchema,
        { method: 'PATCH', body: { name: input.name } },
      );
      return result.collection;
    },
    onSuccess: () => invalidateDocs(client),
    onError: (error) =>
      toast({ title: 'Could not rename', description: messageOf(error), tone: 'danger' }),
  });
}

export function useDeleteCollection() {
  const client = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (collectionId: string): Promise<void> => {
      await apiFetch(`/api/docs/collections/${collectionId}`, deletedSchema, {
        method: 'DELETE',
      });
    },
    onSuccess: () => invalidateDocs(client),
    onError: (error) =>
      toast({ title: 'Could not delete', description: messageOf(error), tone: 'danger' }),
  });
}

export function useDocVersions(docId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.docVersions(docId),
    enabled,
    queryFn: async ({ signal }): Promise<DocVersion[]> => {
      const result = await apiFetch(`/api/docs/${docId}/versions`, docVersionListSchema, {
        signal,
      });
      return result.versions;
    },
  });
}

export function useRestoreDocVersion(docId: string) {
  const client = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (versionId: string): Promise<Doc> => {
      const result = await apiFetch(`/api/docs/${docId}/versions`, docEnvelopeSchema, {
        method: 'POST',
        body: { versionId },
      });
      return result.doc;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.doc(docId) }).catch(() => undefined);
      client.invalidateQueries({ queryKey: queryKeys.docVersions(docId) }).catch(() => undefined);
      invalidateDocs(client);
    },
    onError: (error) =>
      toast({ title: 'Could not restore', description: messageOf(error), tone: 'danger' }),
  });
}
