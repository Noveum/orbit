'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { useCreateDoc } from '@/lib/query/use-docs.ts';

export const NEW_DOC_TITLE = 'Untitled doc';
export const NEW_DOC_CONTENT = '# Untitled doc\n\nStart writing.\n';

export interface NewDocProps {
  readonly collectionId: string | null;
  readonly projectId: string | null;
}

export function NewDoc({ collectionId, projectId }: NewDocProps) {
  const router = useRouter();
  const create = useCreateDoc();
  const started = useRef(false);
  const run = create.mutateAsync;

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    run({ title: NEW_DOC_TITLE, content: NEW_DOC_CONTENT, collectionId, projectId })
      .then((doc) => router.replace(`/docs/${doc.id}?edit=1`))
      .catch(() => router.replace('/docs'));
  }, [run, router, collectionId, projectId]);

  return (
    <div className="mx-auto flex w-full max-w-[45rem] flex-col gap-4 px-6 py-10">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
