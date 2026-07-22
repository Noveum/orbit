'use client';

import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  type NotificationChannel,
  type NotificationType,
} from '@orbit/shared/constants';
import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Checkbox } from '@/components/ui/checkbox.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Switch } from '@/components/ui/switch.tsx';
import { apiRequest, messageOf } from '@/lib/api/client.ts';

export function matrixKey(channel: string, type: string): string {
  return `${channel}:${type}`;
}

const CHANNEL_LABELS: Record<NotificationChannel, string> = {
  inbox: 'Inbox',
  email: 'Email',
  slack: 'Slack',
  push: 'Push',
};

function typeLabel(type: NotificationType): string {
  const words = type.split('_');
  const first = words[0] ?? '';
  return [first.charAt(0).toUpperCase() + first.slice(1), ...words.slice(1)].join(' ');
}

export interface NotificationMatrixProps {
  readonly disabledKeys: readonly string[];
  readonly quietHoursEnabled: boolean;
  readonly quietHoursStart: string;
  readonly quietHoursEnd: string;
  readonly urgentBypassEnabled: boolean;
}

export function NotificationMatrix(props: NotificationMatrixProps) {
  const [disabled, setDisabled] = useState<ReadonlySet<string>>(() => new Set(props.disabledKeys));
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(props.quietHoursEnabled);
  const [quietHoursStart, setQuietHoursStart] = useState(props.quietHoursStart);
  const [quietHoursEnd, setQuietHoursEnd] = useState(props.quietHoursEnd);
  const [urgentBypassEnabled, setUrgentBypassEnabled] = useState(props.urgentBypassEnabled);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function toggle(channel: NotificationChannel, type: NotificationType): void {
    setSaved(false);
    const key = matrixKey(channel, type);
    setDisabled((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function save(): Promise<void> {
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      await apiRequest('/api/notifications/preferences', {
        method: 'PUT',
        body: {
          preferences: NOTIFICATION_CHANNELS.flatMap((channel) =>
            NOTIFICATION_TYPES.map((type) => ({
              channel,
              type,
              enabled: !disabled.has(matrixKey(channel, type)),
            })),
          ),
          quietHoursEnabled,
          quietHoursStart,
          quietHoursEnd,
          urgentBypassEnabled,
        },
      });
      setSaved(true);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[36rem] border-collapse text-dense">
          <thead>
            <tr className="border-border border-b text-2xs text-faint uppercase">
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Notification
              </th>
              {NOTIFICATION_CHANNELS.map((channel) => (
                <th key={channel} scope="col" className="px-3 py-2 text-center font-medium">
                  {CHANNEL_LABELS[channel]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {NOTIFICATION_TYPES.map((type) => (
              <tr key={type} className="border-border border-b last:border-b-0">
                <th scope="row" className="px-3 py-1.5 text-left font-normal text-muted">
                  {typeLabel(type)}
                </th>
                {NOTIFICATION_CHANNELS.map((channel) => (
                  <td key={channel} className="px-3 py-1.5 text-center">
                    <Checkbox
                      className="mx-auto"
                      checked={!disabled.has(matrixKey(channel, type))}
                      onCheckedChange={() => toggle(channel, type)}
                      aria-label={`${CHANNEL_LABELS[channel]} for ${typeLabel(type)}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <label htmlFor="quiet-hours" className="flex items-center justify-between gap-3">
          <span className="flex flex-col">
            <span className="font-medium text-dense text-text">Quiet hours</span>
            <span className="text-muted text-xs">
              Email is held until the window ends, in your local time.
            </span>
          </span>
          <Switch
            id="quiet-hours"
            checked={quietHoursEnabled}
            onCheckedChange={setQuietHoursEnabled}
            aria-label="Quiet hours"
          />
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="quiet-start" className="flex items-center gap-2 text-muted text-xs">
            From
            <Input
              id="quiet-start"
              type="time"
              value={quietHoursStart}
              onChange={(event) => setQuietHoursStart(event.target.value)}
              className="h-7 w-28 text-xs"
              disabled={!quietHoursEnabled}
              aria-label="Quiet hours start"
            />
          </label>
          <label htmlFor="quiet-end" className="flex items-center gap-2 text-muted text-xs">
            To
            <Input
              id="quiet-end"
              type="time"
              value={quietHoursEnd}
              onChange={(event) => setQuietHoursEnd(event.target.value)}
              className="h-7 w-28 text-xs"
              disabled={!quietHoursEnabled}
              aria-label="Quiet hours end"
            />
          </label>
        </div>

        <label
          htmlFor="urgent-bypass"
          className="flex items-center justify-between gap-3 border-border border-t pt-3"
        >
          <span className="flex flex-col">
            <span className="font-medium text-dense text-text">Urgent bypass</span>
            <span className="text-muted text-xs">
              Urgent assignments still reach you during quiet hours.
            </span>
          </span>
          <Switch
            id="urgent-bypass"
            checked={urgentBypassEnabled}
            onCheckedChange={setUrgentBypassEnabled}
            aria-label="Urgent bypass"
          />
        </label>
      </div>

      {error === null ? null : (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
      {saved ? (
        <p role="status" className="text-success text-xs">
          Notification preferences saved.
        </p>
      ) : null}

      <div>
        <Button variant="primary" onClick={save} disabled={pending}>
          {pending ? 'Saving' : 'Save preferences'}
        </Button>
      </div>
    </div>
  );
}
