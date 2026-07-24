import { can } from '@orbit/shared/policy';
import { HydrationBoundary } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { DocsShell } from '@/features/docs/docs-shell.tsx';
import { pageContext } from '@/lib/api/handler.ts';
import { dehydratedDocList } from '@/lib/query/docs-prefetch.ts';

export default async function DocsLayout({ children }: { children: ReactNode }) {
  const { principal } = await pageContext();

  return (
    <HydrationBoundary state={await dehydratedDocList(principal)}>
      <DocsShell canWrite={can(principal, 'doc:write')}>{children}</DocsShell>
    </HydrationBoundary>
  );
}
