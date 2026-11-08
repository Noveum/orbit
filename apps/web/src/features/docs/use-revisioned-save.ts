'use client';

import { useCallback, useRef, useState } from 'react';
import { ApiError } from '@/lib/query/fetcher.ts';

export const STALE_REVISION_REASON = 'stale_revision';

export interface RevisionedSaveOptions<
  TValue,
  TResult extends { readonly doc: { readonly revision: number } },
> {
  readonly save: (value: TValue, baseRevision: number) => Promise<TResult>;
  readonly initialRevision: number;
}

export interface RevisionedSave<TValue, TResult> {
  readonly save: (value: TValue) => Promise<TResult>;
  readonly stale: boolean;
  readonly adoptRevision: (revision: number) => void;
}

export function useRevisionedSave<
  TValue,
  TResult extends { readonly doc: { readonly revision: number } },
>({
  save,
  initialRevision,
}: RevisionedSaveOptions<TValue, TResult>): RevisionedSave<TValue, TResult> {
  const revisionRef = useRef(initialRevision);
  const [stale, setStale] = useState(false);

  const send = useCallback(
    async (value: TValue) => {
      try {
        const result = await save(value, revisionRef.current);
        revisionRef.current = result.doc.revision;
        setStale(false);
        return result;
      } catch (error) {
        if (error instanceof ApiError && error.details?.['reason'] === STALE_REVISION_REASON) {
          setStale(true);
        }
        throw error;
      }
    },
    [save],
  );

  const adoptRevision = useCallback((revision: number) => {
    revisionRef.current = revision;
    setStale(false);
  }, []);

  return { save: send, stale, adoptRevision };
}
