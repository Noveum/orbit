import { refreshPullRequestHistory } from '@/features/pulls/github-refresh.ts';
import { backfillWorkspacePullRequests } from '@/features/settings/github-connect.ts';
import { githubAppConfig } from '@/lib/env.ts';
import type { DeferredWork } from './work.ts';

export async function performDeferredWork(work: DeferredWork): Promise<void> {
  if (work.kind === 'pull-request-backfill') {
    await backfillWorkspacePullRequests({
      organizationId: work.organizationId,
      config: githubAppConfig(),
    });
    return;
  }
  await refreshPullRequestHistory({
    principal: { organizationId: work.organizationId, userId: work.userId },
    pullRequestId: work.pullRequestId,
    config: githubAppConfig(),
  });
}
