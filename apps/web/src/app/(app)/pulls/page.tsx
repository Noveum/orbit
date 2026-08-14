import { can } from '@orbit/shared/policy';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { githubReach, loadPullRequestPage } from '@/features/pulls/data.ts';
import { PullsRealtime } from '@/features/pulls/pulls-realtime.tsx';
import { pageContext } from '@/lib/api/handler.ts';

export const metadata: Metadata = { title: 'Pull requests' };

export default async function PullsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ page?: string }>;
}) {
  const context = await pageContext();
  const requestedPage = Number.parseInt((await searchParams).page ?? '1', 10);
  const currentPage = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const [pullPage, reach] = await Promise.all([
    loadPullRequestPage(context.principal, currentPage),
    githubReach(context.principal),
  ]);
  if (currentPage > 1 && pullPage.pulls.length === 0) redirect('/pulls');

  return (
    <PullsRealtime
      pulls={pullPage.pulls}
      total={pullPage.total}
      userId={context.principal.userId}
      reach={reach}
      canManageIntegrations={can(context.principal, 'integration:manage')}
      currentPage={currentPage}
      hasMore={pullPage.hasMore}
    />
  );
}
