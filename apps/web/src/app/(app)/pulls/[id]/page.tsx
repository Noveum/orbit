import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadPullRequestDetail } from '@/features/pulls/data.ts';
import { PullDetailRealtime } from '@/features/pulls/pull-detail-realtime.tsx';
import { pageContext } from '@/lib/api/handler.ts';
import { deferWork } from '@/lib/background/defer.ts';

export const metadata: Metadata = { title: 'Pull request' };
export const maxDuration = 300;

export default async function PullRequestPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const [{ id }, context] = await Promise.all([params, pageContext()]);
  const pull = await loadPullRequestDetail(context.principal, id);
  if (pull === null) notFound();
  deferWork({
    kind: 'pull-request-history',
    organizationId: context.principal.organizationId,
    userId: context.principal.userId,
    pullRequestId: id,
  });
  return <PullDetailRealtime pull={pull} />;
}
