'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { messageOf } from '@/lib/query/fetcher.ts';
import { useCreateDoc } from '@/lib/query/use-docs.ts';
import { HTML_PAGE_STARTER, templateById } from './templates.ts';
import { useDocPreferences } from './use-doc-preferences.ts';

export const NEW_DOC_TITLE = 'Untitled doc';
export const NEW_DOC_CONTENT = '';

export interface NewDocProps {
  readonly collectionId: string | null;
  readonly projectId: string | null;
  readonly templateId?: string | null;
  readonly kind?: string | null;
}

export function NewDoc({ collectionId, projectId, templateId = null, kind = null }: NewDocProps) {
  const router = useRouter();
  const { mode, setMode } = useDocPreferences();
  const create = useCreateDoc();
  const { toast } = useToast();
  const started = useRef(false);
  const run = create.mutateAsync;

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (mode === 'preview') setMode('rich');
    const template =
      templateId === null && kind === 'html'
        ? {
            title: 'Untitled page',
            content: HTML_PAGE_STARTER,
            kind: 'html' as const,
          }
        : templateById(templateId);
    run({
      title: template.title,
      content: template.content,
      kind: template.kind,
      collectionId,
      projectId,
    })
      .then((doc) => router.replace(`/docs/${doc.id}`))
      .catch((error: unknown) => {
        toast({
          title: 'Could not create that document',
          description: messageOf(error),
          tone: 'danger',
        });
        router.replace('/docs');
      });
  }, [run, router, toast, collectionId, projectId, templateId, kind, mode, setMode]);

  return (
    <div className="mx-auto flex w-full max-w-[45rem] flex-col gap-4 px-6 py-10">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
