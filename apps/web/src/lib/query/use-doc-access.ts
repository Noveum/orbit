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
