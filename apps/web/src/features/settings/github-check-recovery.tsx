'use client';

import {
  type GithubRecoveryCandidate,
  type GithubRecoveryStatus,
  githubRecoveryCandidateSchema,
  githubRecoveryResultSchema,
} from '@orbit/shared/validators';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button.tsx';
import { apiRequest, messageOf } from '@/lib/api/client.ts';

const path = '/api/integrations/github/check-recovery';
const recoveryMessages: Record<GithubRecoveryStatus, string> = {
  queued: 'Retry queued.',
  already_queued: 'A retry is already queued.',
  already_attempted: 'This retry already finished.',
  busy: 'A check update is already in progress.',
  superseded: 'The saved check changed. Review the current head before retrying.',
  not_active: 'This pull request is no longer active.',
  head_changed: 'GitHub reports a newer head. Wait for Orbit to sync it.',
  installation_unavailable: 'GitHub could not find this installation. Reconnect the GitHub App.',
  installation_suspended: 'The GitHub App installation is suspended.',
  repository_unavailable: 'The installed GitHub App cannot find this repository.',
  pull_request_unavailable: 'GitHub could not find this pull request.',
  repository_access_required: 'Grant the GitHub App access to this repository.',
  provider_authentication_failed:
    'GitHub rejected the app credentials. Check the app configuration.',
  provider_temporarily_unavailable: 'GitHub is temporarily unavailable. Try again later.',
  expired: 'Verification timed out. Try again.',
};

function pullLabel(candidate: GithubRecoveryCandidate): string {
  return `${candidate.repositoryName}#${candidate.pullRequestNumber}`;
}

export function GithubCheckRecovery({ organizationId }: { organizationId: string }) {
  const list = useQuery({
    queryKey: ['github-check-recovery', organizationId],
    queryFn: async () =>
      githubRecoveryCandidateSchema.array().parse(await apiRequest<unknown>(path)),
    retry: false,
  });
  const recovery = useMutation({
    mutationFn: async (candidate: GithubRecoveryCandidate) =>
      githubRecoveryResultSchema.parse(
        await apiRequest<unknown>(path, { method: 'POST', body: candidate.selector }),
      ),
    onSettled: () => list.refetch(),
    retry: false,
  });
  if (list.isError)
    return (
      <p role="alert" className="text-danger text-xs">
        Could not load failed GitHub check updates.{' '}
        <Button variant="ghost" size="sm" onClick={() => list.refetch()}>
          Reload checks
        </Button>
      </p>
    );
  const candidates = list.data ?? [];
  if (candidates.length === 0 && recovery.isIdle) return null;
  return (
    <section
      aria-label="Failed GitHub check updates"
      className="flex flex-col gap-2 rounded-lg border border-border p-4"
    >
      <h3 className="font-medium text-dense text-text">Failed GitHub check updates</h3>
      {recovery.isError ? (
        <p role="alert" className="text-danger text-xs">
          {messageOf(recovery.error)}
        </p>
      ) : null}
      {recovery.isSuccess ? (
        <p role="status" className="text-muted text-xs">
          {pullLabel(recovery.variables)}: {recoveryMessages[recovery.data.status]}
        </p>
      ) : null}
      {candidates.length > 0 ? (
        <>
          <p className="text-muted text-xs">
            Retry a check update to verify the pull request head with GitHub and queue a new sync.
          </p>
          <ul className="flex flex-col divide-y divide-border">
            {candidates.map((candidate) => (
              <li
                key={candidate.selector.reconciliationId}
                className="flex items-center justify-between gap-2 py-2"
              >
                <span className="min-w-0 truncate text-dense text-text">
                  {pullLabel(candidate)}{' '}
                  <code className="text-faint text-xs">
                    {candidate.selector.expectedHeadSha.slice(0, 7)}
                  </code>
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={recovery.isPending}
                  aria-label={`Retry check updates for ${pullLabel(candidate)}`}
                  onClick={() => recovery.mutate(candidate)}
                >
                  {recovery.isPending &&
                  recovery.variables.selector.reconciliationId ===
                    candidate.selector.reconciliationId
                    ? 'Verifying…'
                    : 'Retry sync'}
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
