import { can } from '@orbit/shared/policy';
import type { Metadata } from 'next';
import { DocsEmptyPane } from '@/features/docs/docs-empty-pane.tsx';
import { pageContext } from '@/lib/api/handler.ts';

export const metadata: Metadata = { title: 'Docs' };

export default async function DocsPage() {
  const { principal } = await pageContext();
  return <DocsEmptyPane canWrite={can(principal, 'doc:write')} />;
}
