'use client';

import type { DocAccessLevel, DocAccessSubject } from '@orbit/shared/constants';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { apiFetch } from './fetcher.ts';
import { queryKeys } from './keys.ts';

export interface DocGrant {
  readonly subjectType: DocAccessSubject;
  readonly subjectId: string;
  readonly level: DocAccessLevel;
}

const grantSchema = z.object({
  id: z.string(),
  subjectType: z.enum(['user', 'team']),
  subjectId: z.string(),
  level: z.enum(['read', 'write']),
});

const accessSchema = z.object({ grants: z.array(grantSchema) });

export function useDocAccess(docId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.docAccess(docId),
    enabled,
    queryFn: async ({ signal }) =>
      await apiFetch(`/api/docs/${docId}/access`, accessSchema, { signal }),
  });
}

const accessRequestSchema = z.object({
  id: z.string(),
  docId: z.string(),
  requesterId: z.string(),
  message: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
});

const accessRequestListSchema = z.object({ requests: z.array(accessRequestSchema) });

const gatewaySchema = z.object({
  gateway: z.object({
    id: z.string(),
    title: z.string(),
    ownerName: z.string(),
    requested: z.boolean(),
  }),
});

export type DocGateway = z.infer<typeof gatewaySchema>['gateway'];

export function useDocGateway(docId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.docGateway(docId),
    enabled,
    retry: false,
    queryFn: async ({ signal }) =>
      (await apiFetch(`/api/docs/${docId}/access-requests?gateway=1`, gatewaySchema, { signal }))
        .gateway,
  });
}

export function useRequestDocAccess(docId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (message: string) =>
      await apiFetch(
        `/api/docs/${docId}/access-requests`,
        z.object({ request: accessRequestSchema }),
        {
          method: 'POST',
          body: { message },
        },
      ),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.docGateway(docId) }).catch(() => undefined);
    },
  });
}

export function useDocAccessRequests(docId: string) {
  return useQuery({
    queryKey: queryKeys.docAccessRequests(docId),
    retry: false,
    queryFn: async ({ signal }) =>
      (await apiFetch(`/api/docs/${docId}/access-requests`, accessRequestListSchema, { signal }))
        .requests,
  });
}

export function useDecideDocAccessRequest(docId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { requestId: string; grant: boolean }) =>
      await apiFetch(
        `/api/docs/access-requests/${input.requestId}`,
        z.object({ request: accessRequestSchema }),
        { method: 'POST', body: { grant: input.grant } },
      ),
    onSettled: () => {
      client
        .invalidateQueries({ queryKey: queryKeys.docAccessRequests(docId) })
        .catch(() => undefined);
      client.invalidateQueries({ queryKey: queryKeys.docAccess(docId) }).catch(() => undefined);
    },
  });
}

export function useSetDocAccess(docId: string) {
  const client = useQueryClient();
  return useMutation({
    scope: { id: `doc-access:${docId}` },
    mutationFn: async (grants: readonly DocGrant[]) =>
      await apiFetch(`/api/docs/${docId}/access`, accessSchema, {
        method: 'PUT',
        body: { grants },
      }),
    onSuccess: (data) => {
      client.setQueryData(queryKeys.docAccess(docId), data);
    },
    onSettled: () => {
      client.invalidateQueries({ queryKey: queryKeys.docAccess(docId) }).catch(() => undefined);
    },
  });
}
