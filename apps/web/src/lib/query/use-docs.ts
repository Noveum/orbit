'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/toast.tsx';
import { apiFetch, messageOf } from './fetcher.ts';
import { DOCS_HOME_ROOT, DOCS_ROOT, queryKeys } from './keys.ts';
import type { Doc, DocCollection, DocDetail, DocList, DocsHome, DocVersion } from './schemas.ts';
import {
  deletedSchema,
  docArchiveResultSchema,
  docCollectionEnvelopeSchema,
  docDetailSchema,
  docEnvelopeSchema,
  docFavoriteResultSchema,
  docListSchema,
  docSaveResultSchema,
  docShareResultSchema,
  docsHomeSchema,
  docVersionListSchema,
  docVisitResultSchema,
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

export function useDocsHome() {
  return useQuery({
    queryKey: queryKeys.docsHome(),
    queryFn: async ({ signal }): Promise<DocsHome> =>
      await apiFetch('/api/docs/home', docsHomeSchema, { signal }),
  });
}

function invalidateDocs(client: ReturnType<typeof useQueryClient>): void {
  client.invalidateQueries({ queryKey: [DOCS_ROOT] }).catch(() => undefined);
  client.invalidateQueries({ queryKey: [DOCS_HOME_ROOT] }).catch(() => undefined);
}

export function useRecordDocVisit() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: async (docId: string): Promise<void> => {
      await apiFetch(`/api/docs/${docId}/visit`, docVisitResultSchema, {
        method: 'POST',
        body: {},
      });
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [DOCS_HOME_ROOT] }).catch(() => undefined);
    },
  });
}

export function useToggleDocFavorite(docId: string) {
  const client = useQueryClient();
  const { toast } = useToast();
  const key = queryKeys.doc(docId);

  return useMutation({
    scope: { id: `doc-favorite:${docId}` },
    mutationFn: async (favorite: boolean): Promise<{ docId: string; favorite: boolean }> =>
      await apiFetch(`/api/docs/${docId}/favorite`, docFavoriteResultSchema, {
        method: 'POST',
        body: { favorite },
      }),
    onMutate: async (favorite) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<DocDetail>(key);
      if (previous !== undefined) client.setQueryData<DocDetail>(key, { ...previous, favorite });
      return { previous };
    },
    onError: (error, _favorite, context) => {
      if (context?.previous !== undefined) client.setQueryData(key, context.previous);
      toast({ title: 'Could not update', description: messageOf(error), tone: 'danger' });
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: [DOCS_HOME_ROOT] }).catch(() => undefined);
    },
  });
}

export function useCreateDoc() {
  const client = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: {
      title: string;
      content?: string;
      kind?: 'markdown' | 'html';
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

export function useDuplicateDoc() {
  const client = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (docId: string): Promise<Doc> => {
      const result = await apiFetch(`/api/docs/${docId}/duplicate`, docEnvelopeSchema, {
        method: 'POST',
        body: {},
      });
      return result.doc;
    },
    onSuccess: () => invalidateDocs(client),
    onError: (error) =>
      toast({ title: 'Could not duplicate', description: messageOf(error), tone: 'danger' }),
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

export function useUpdateDocTitle() {
  const client = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: { docId: string; title: string }): Promise<Doc> => {
      const result = await apiFetch(`/api/docs/${input.docId}`, docSaveResultSchema, {
        method: 'PATCH',
        body: { title: input.title },
      });
      return result.doc;
    },
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey: [DOCS_ROOT] });
      const previous = new Map<readonly unknown[], DocList>();
      for (const [key, value] of client.getQueriesData<DocList>({ queryKey: [DOCS_ROOT] })) {
        if (value === undefined) continue;
        previous.set(key, value);
        client.setQueryData<DocList>(key, {
          ...value,
          docs: value.docs.map((doc) =>
            doc.id === input.docId ? { ...doc, title: input.title } : doc,
          ),
        });
      }
      return { previous };
    },
    onError: (error, _input, context) => {
      for (const [key, value] of context?.previous ?? []) client.setQueryData(key, value);
      toast({ title: 'Could not rename', description: messageOf(error), tone: 'danger' });
    },
    onSettled: (_doc, _error, input) => {
      client.invalidateQueries({ queryKey: queryKeys.doc(input.docId) }).catch(() => undefined);
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

export interface DocMoveInput {
  readonly docId: string;
  readonly collectionId: string | null;
  readonly projectId: string | null;
  readonly parentId: string | null;
  readonly beforeId: string | null;
  readonly afterId: string | null;
}

function placeMovedDoc(
  client: ReturnType<typeof useQueryClient>,
  input: DocMoveInput,
): Map<readonly unknown[], DocList> {
  const previous = new Map<readonly unknown[], DocList>();
  for (const [key, value] of client.getQueriesData<DocList>({ queryKey: [DOCS_ROOT] })) {
    if (value === undefined) continue;
    previous.set(key, value);
    client.setQueryData<DocList>(key, {
      ...value,
      docs: value.docs.map((doc) =>
        doc.id === input.docId
          ? {
              ...doc,
              collectionId: input.collectionId,
              projectId: input.projectId,
              parentId: input.parentId,
            }
          : doc,
      ),
    });
  }
  return previous;
}

export function useMoveDoc() {
  const client = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (input: DocMoveInput): Promise<Doc> => {
      const result = await apiFetch(`/api/docs/${input.docId}/move`, docEnvelopeSchema, {
        method: 'POST',
        body: {
          collectionId: input.collectionId,
          projectId: input.projectId,
          parentId: input.parentId,
          beforeId: input.beforeId,
          afterId: input.afterId,
        },
      });
      return result.doc;
    },
    onMutate: async (input) => {
      await client.cancelQueries({ queryKey: [DOCS_ROOT] });
      return { previous: placeMovedDoc(client, input) };
    },
    onError: (error, _input, context) => {
      for (const [key, value] of context?.previous ?? []) client.setQueryData(key, value);
      toast({ title: 'Could not move that doc', description: messageOf(error), tone: 'danger' });
    },
    onSettled: () => invalidateDocs(client),
  });
}

export function useRestoreDoc() {
  const client = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (docId: string): Promise<void> => {
      await apiFetch(`/api/docs/${docId}/restore`, docArchiveResultSchema, {
        method: 'POST',
        body: {},
      });
    },
    onSuccess: () => invalidateDocs(client),
    onError: (error) =>
      toast({ title: 'Could not restore', description: messageOf(error), tone: 'danger' }),
  });
}

export function useDeleteDoc() {
  const client = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (docId: string): Promise<void> => {
      await apiFetch(`/api/docs/${docId}?permanent=1`, deletedSchema, { method: 'DELETE' });
    },
    onSuccess: () => invalidateDocs(client),
    onError: (error) =>
      toast({ title: 'Could not delete', description: messageOf(error), tone: 'danger' }),
  });
}

export function useArchivedDocs(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.docs('archived'),
    enabled,
    queryFn: async ({ signal }): Promise<DocList> =>
      await apiFetch('/api/docs?includeArchived=true', docListSchema, { signal }),
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
