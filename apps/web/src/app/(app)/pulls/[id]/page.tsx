import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadPullRequestDetail } from '@/features/pulls/data.ts';
import { refreshPullRequestHistory } from '@/features/pulls/github-refresh.ts';
import { PullDetailRealtime } from '@/features/pulls/pull-detail-realtime.tsx';
import { pageContext } from '@/lib/api/handler.ts';
import { githubAppConfig } from '@/lib/env.ts';

export const metadata: Metadata = { title: 'Pull request' };

export default async function PullRequestPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const [{ id }, context] = await Promise.all([params, pageContext()]);
  try {
    await refreshPullRequestHistory({
      principal: context.principal,
      pullRequestId: id,
      config: githubAppConfig(),
    });
  } catch (error) {
    console.error(`Could not refresh GitHub pull request ${id}.`, error);
  }
  const pull = await loadPullRequestDetail(context.principal, id);
  if (pull === null) notFound();
  return <PullDetailRealtime pull={pull} />;
}
