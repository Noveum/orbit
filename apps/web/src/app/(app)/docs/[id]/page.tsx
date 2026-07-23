import { can } from '@orbit/shared/policy';
import type { Metadata } from 'next';
import { DocsWorkspace } from '@/features/docs/docs-workspace.tsx';
import { pageContext } from '@/lib/api/handler.ts';

export const metadata: Metadata = { title: 'Docs' };

export default async function DocPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edit?: string }>;
}) {
  const [{ principal }, { id }, query] = await Promise.all([pageContext(), params, searchParams]);

  return (
    <DocsWorkspace
      docId={id}
      canWrite={can(principal, 'doc:write')}
      canPublish={can(principal, 'doc:publish')}
      startEditing={query.edit === '1'}
    />
  );
}
