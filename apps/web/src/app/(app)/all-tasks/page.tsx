import type { Metadata } from 'next';
import { AllTasksView } from '@/features/issues/all-tasks-view.tsx';
import { pageContext } from '@/lib/api/handler.ts';

export const metadata: Metadata = { title: 'All tasks' };

export default async function AllTasksPage() {
  const { principal } = await pageContext();
  return <AllTasksView organizationId={principal.organizationId} />;
}
