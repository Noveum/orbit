import { can } from '@orbit/shared/policy';
import type { Metadata } from 'next';
import { DocsWorkspace } from '@/features/docs/docs-workspace.tsx';
import { pageContext } from '@/lib/api/handler.ts';

export const metadata: Metadata = { title: 'Docs' };

export default async function DocsPage() {
  const { principal } = await pageContext();
  return (
    <DocsWorkspace
      docId={null}
      canWrite={can(principal, 'doc:write')}
      canPublish={can(principal, 'doc:publish')}
    />
  );
}
