import { GITHUB_CONNECT_STATUSES, type GithubConnectStatus } from './github-view.ts';

export function githubConnectStatusOf(value: unknown): GithubConnectStatus | null {
  if (typeof value !== 'string') return null;
  const found = GITHUB_CONNECT_STATUSES.find((status) => status === value);
  return found ?? null;
}

const MESSAGES: Record<GithubConnectStatus, string> = {
  connected: 'GitHub is connected. Pick the repositories you want to track below.',
  error: 'Orbit could not finish connecting to GitHub. Start the connection again.',
  denied:
    'That installation was not approved for your account. Ask a GitHub organisation owner to install Orbit, then try again.',
  claimed:
    'That GitHub installation is already connected to another Orbit workspace. Disconnect it there first, or install Orbit on a different organisation.',
};

export function GithubConnectNotice({ status }: { status: GithubConnectStatus }) {
  const success = status === 'connected';
  return (
    <p
      role="status"
      data-testid="github-connect-notice"
      className={
        success
          ? 'rounded-lg border border-border bg-surface-2 px-3 py-2 text-success text-xs'
          : 'rounded-lg border border-border bg-surface-2 px-3 py-2 text-danger text-xs'
      }
    >
      {MESSAGES[status]}
    </p>
  );
}
