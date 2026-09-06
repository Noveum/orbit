export const SLACK_CONNECT_STATUSES = ['connected', 'error', 'denied', 'claimed'] as const;
export type SlackConnectStatus = (typeof SLACK_CONNECT_STATUSES)[number];

export function slackConnectStatusOf(value: unknown): SlackConnectStatus | null {
  if (typeof value !== 'string') return null;
  return SLACK_CONNECT_STATUSES.find((status) => status === value) ?? null;
}

const MESSAGES: Record<SlackConnectStatus, string> = {
  connected: 'Slack is connected. Invite the Orbit bot to a channel, then map it below.',
  error:
    'Orbit could not finish Slack setup. If Slack appears connected below, sync its members; otherwise reconnect it.',
  denied: 'You no longer have permission to connect Slack to this workspace.',
  claimed:
    'That Slack workspace is already connected to another Orbit workspace. Disconnect it there first, or connect a different Slack workspace.',
};

export function SlackConnectNotice({ status }: { status: SlackConnectStatus }) {
  const success = status === 'connected';
  return (
    <p
      role="status"
      data-testid="slack-connect-notice"
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
