import { relativeTime } from '@orbit/shared/utils';
import { Badge } from '@/components/ui/badge.tsx';
import type { GithubDeliveryView } from './integrations-data.ts';

const REASON_COPY: Record<string, string> = {
  unsupported_event: 'Orbit does not act on this event',
  repository_not_connected: 'That repository is not connected here',
  repository_disabled: 'That repository is switched off',
  no_issue_identifier: 'Its branch and title name no issue',
  no_matching_issue: 'It names an issue this workspace does not have',
};

export function deliveryReasonCopy(reason: string | null): string {
  if (reason === null) return '';
  return REASON_COPY[reason] ?? reason;
}

function tone(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'processed') return 'success';
  if (status === 'ignored') return 'warning';
  if (status === 'failed') return 'danger';
  return 'neutral';
}

export function GithubDeliveries({
  deliveries,
}: {
  readonly deliveries: readonly GithubDeliveryView[];
}) {
  if (deliveries.length === 0) return null;

  const ignored = deliveries.filter((entry) => entry.status === 'ignored').length;

  return (
    <section
      className="flex flex-col gap-2 rounded-lg border border-border p-4"
      data-testid="github-deliveries"
    >
      <div className="flex flex-col gap-1">
        <span className="font-medium text-dense text-text">Recent GitHub deliveries</span>
        <p className="text-muted text-xs">
          {ignored === 0
            ? 'Every recent delivery changed something in Orbit.'
            : `${ignored} of the last ${deliveries.length} deliveries arrived and changed nothing. The reason is next to each one.`}
        </p>
      </div>
      <ul className="flex flex-col gap-1">
        {deliveries.map((delivery) => (
          <li
            key={delivery.id}
            className="flex flex-wrap items-center gap-2 text-2xs"
            data-testid={`github-delivery-${delivery.id}`}
          >
            <Badge tone={tone(delivery.status)}>{delivery.status}</Badge>
            <span data-numeric className="text-muted">
              {delivery.event}
            </span>
            <span className="text-faint">{relativeTime(new Date(delivery.receivedAt))}</span>
            {delivery.reason === null ? null : (
              <span className="text-muted">{deliveryReasonCopy(delivery.reason)}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
