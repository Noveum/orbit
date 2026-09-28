import type { SlackIntegrationSettings } from './integrations-data.ts';

export function SlackDeliveryHealth({ settings }: { readonly settings: SlackIntegrationSettings }) {
  return (
    <>
      {settings.deliveryDraining ? (
        <p role="status" className="text-warning text-xs">
          Slack is finishing active deliveries. Reconnect again after they finish to resume the
          queue.
        </p>
      ) : null}
      {settings.deliveryHealth === undefined ? null : (
        <div className="rounded-lg border border-border p-3 text-xs">
          <p className="font-medium text-text">Notification delivery</p>
          <ul className="mt-1 space-y-1 text-muted">
            {settings.deliveryHealth
              .filter((row) => row.channel !== 'email' && row.status !== 'delivered')
              .map((row) => (
                <li key={`${row.channel}:${row.status}`}>
                  {row.channel === 'slack_dm' ? 'Personal DMs' : 'Shared channels'}: {row.count}{' '}
                  {row.status === 'failed' ? 'retrying' : row.status.replace('_', ' ')}
                </li>
              ))}
          </ul>
          <p className="mt-2 text-faint">
            Unavailable deliveries need access or configuration restored. Ambiguous sends require
            checking Slack before any retry, to avoid duplicate messages. Dead letters exhausted
            retries.
          </p>
        </div>
      )}
    </>
  );
}
