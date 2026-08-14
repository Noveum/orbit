import { can } from '@orbit/shared/policy';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { githubReach, loadPullRequestPage } from '@/features/pulls/data.ts';
import { PullsRealtime } from '@/features/pulls/pulls-realtime.tsx';
import { backfillWorkspacePullRequests } from '@/features/settings/github-connect.ts';
import { pageContext } from '@/lib/api/handler.ts';
import { githubAppConfig } from '@/lib/env.ts';

export const metadata: Metadata = { title: 'Pull requests' };
export const maxDuration = 300;

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
  after(async () => {
    try {
      await backfillWorkspacePullRequests({
        organizationId: context.principal.organizationId,
        config: githubAppConfig(),
      });
    } catch (error) {
      console.error(
        `Could not backfill GitHub pull requests for organization ${context.principal.organizationId}.`,
        error,
      );
    }
  });

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
