'use client';

import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_TYPES,
  type NotificationChannel,
  type NotificationType,
} from '@orbit/shared/constants';
import { Bell, ChevronRight, Inbox, Mail, MessageSquare } from 'lucide-react';
import { type ComponentType, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Collapsible } from '@/components/ui/collapsible.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Switch } from '@/components/ui/switch.tsx';
import { apiRequest, messageOf } from '@/lib/api/client.ts';
import { cn } from '@/lib/cn.ts';
import { rowHover } from '@/lib/interaction.ts';
import {
  NOTIFICATION_GROUPS,
  NOTIFICATION_TYPE_LABELS,
  type NotificationGroup,
} from './notification-groups.ts';

export type SlackDmAvailability =
  | 'available'
  | 'disabled'
  | 'unmapped'
  | 'reauthorize'
  | 'unavailable';

export function channelTypeKey(channel: string, type: string): string {
  return `${channel}:${type}`;
}

interface ChannelMeta {
  readonly label: string;
  readonly icon: ComponentType<{ readonly className?: string }>;
}

const CHANNEL_META: Record<NotificationChannel, ChannelMeta> = {
  inbox: { label: 'Inbox', icon: Inbox },
  email: { label: 'Email', icon: Mail },
  slack: { label: 'Slack', icon: MessageSquare },
  slack_dm: { label: 'Slack DM', icon: MessageSquare },
  push: { label: 'Push', icon: Bell },
};

const NON_SLACK_NOTIFICATION_CHANNELS = NOTIFICATION_CHANNELS.filter(
  (channel) => channel !== 'slack' && channel !== 'slack_dm',
);
const SLACK_DM_NOTIFICATION_CHANNELS = NOTIFICATION_CHANNELS.filter(
  (channel) => channel !== 'slack',
);

function channelKeys(channel: NotificationChannel): string[] {
  return NOTIFICATION_TYPES.map((type) => channelTypeKey(channel, type));
}

function enabledTypeCount(disabled: ReadonlySet<string>, channel: NotificationChannel): number {
  return channelKeys(channel).filter((key) => !disabled.has(key)).length;
}

function enabledGroupCount(
  disabled: ReadonlySet<string>,
  channel: NotificationChannel,
  group: NotificationGroup,
): number {
  return group.types.filter((type) => !disabled.has(channelTypeKey(channel, type))).length;
}

function channelSummary(enabled: number): string {
  if (enabled === 0) return 'Off for every notification.';
  if (enabled === NOTIFICATION_TYPES.length) {
    return `On for all ${NOTIFICATION_TYPES.length} notifications.`;
  }
  return `On for ${enabled} of ${NOTIFICATION_TYPES.length} notifications.`;
}

function slackDmNoticeFor(slackDm: SlackDmAvailability): string | null {
  if (slackDm === 'unmapped') return 'Connect your Orbit account to Slack to enable Slack DMs.';
  if (slackDm === 'reauthorize') {
    return 'Slack DMs require permission to send direct messages. Reconnect Slack from Integrations.';
  }
  if (slackDm === 'unavailable') {
    return 'Slack DMs are unavailable until Slack is connected for this workspace.';
  }
  return null;
}

export interface NotificationChannelsProps {
  readonly disabledKeys: readonly string[];
  readonly quietHoursEnabled: boolean;
  readonly quietHoursStart: string;
  readonly quietHoursEnd: string;
  readonly urgentBypassEnabled: boolean;
  readonly slackDm: SlackDmAvailability;
  readonly emailEnabled?: boolean;
}

export function NotificationChannels(props: NotificationChannelsProps) {
  const visibleNotificationChannels =
    props.slackDm === 'disabled' ? NON_SLACK_NOTIFICATION_CHANNELS : SLACK_DM_NOTIFICATION_CHANNELS;
  const [disabled, setDisabled] = useState<ReadonlySet<string>>(() => new Set(props.disabledKeys));
  const [openChannel, setOpenChannel] = useState<NotificationChannel | null>(null);
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(props.quietHoursEnabled);
  const [quietHoursStart, setQuietHoursStart] = useState(props.quietHoursStart);
  const [quietHoursEnd, setQuietHoursEnd] = useState(props.quietHoursEnd);
  const [urgentBypassEnabled, setUrgentBypassEnabled] = useState(props.urgentBypassEnabled);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const panelId = useId();
  const remembered = useRef(new Map<NotificationChannel, ReadonlySet<string>>());
  const editRevision = useRef(0);
  const slackDmNotice = slackDmNoticeFor(props.slackDm);

  function summaryFor(channel: NotificationChannel, enabled: number): string {
    if (channel === 'email' && props.emailEnabled === false) {
      return 'Unavailable until the server operator configures email delivery.';
    }
    if (isLocked(channel) && slackDmNotice !== null) return slackDmNotice;
    return channelSummary(enabled);
  }

  function isLocked(channel: NotificationChannel): boolean {
    if (channel === 'email' && props.emailEnabled === false) return true;
    return channel === 'slack_dm' && props.slackDm !== 'available';
  }

  function apply(update: (next: Set<string>) => void): void {
    editRevision.current += 1;
    setSaved(false);
    setDisabled((current) => {
      const next = new Set(current);
      update(next);
      return next;
    });
  }

  function edit<T>(set: (value: T) => void): (value: T) => void {
    return (value) => {
      editRevision.current += 1;
      setSaved(false);
      set(value);
    };
  }

  function toggleType(channel: NotificationChannel, type: NotificationType): void {
    if (isLocked(channel)) return;
    remembered.current.delete(channel);
    apply((next) => {
      const key = channelTypeKey(channel, type);
      if (next.has(key)) next.delete(key);
      else next.add(key);
    });
  }

  function setChannelEnabled(channel: NotificationChannel, enabled: boolean): void {
    if (isLocked(channel)) return;
    const keys = channelKeys(channel);
    if (!enabled) {
      apply((next) => {
        remembered.current.set(channel, new Set(keys.filter((key) => next.has(key))));
        for (const key of keys) next.add(key);
      });
      return;
    }
    const previous = remembered.current.get(channel);
    remembered.current.delete(channel);
    apply((next) => {
      for (const key of keys) {
        if (previous?.has(key) === true) continue;
        next.delete(key);
      }
    });
  }

  function setGroupEnabled(
    channel: NotificationChannel,
    group: NotificationGroup,
    enabled: boolean,
  ): void {
    if (isLocked(channel)) return;
    remembered.current.delete(channel);
    apply((next) => {
      for (const type of group.types) {
        const key = channelTypeKey(channel, type);
        if (enabled) next.delete(key);
        else next.add(key);
      }
    });
  }

  async function save(): Promise<void> {
    const revision = editRevision.current;
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const preferences = visibleNotificationChannels.flatMap((channel) =>
        NOTIFICATION_TYPES.flatMap((type) => {
          if (isLocked(channel)) return [];
          return {
            channel,
            type,
            enabled: !disabled.has(channelTypeKey(channel, type)),
          };
        }),
      );
      await apiRequest('/api/notifications/preferences', {
        method: 'PUT',
        body: {
          preferences,
          quietHoursEnabled,
          quietHoursStart,
          quietHoursEnd,
          urgentBypassEnabled,
        },
      });
      if (editRevision.current === revision) setSaved(true);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        {visibleNotificationChannels.map((channel) => {
          const meta = CHANNEL_META[channel];
          const Icon = meta.icon;
          const locked = isLocked(channel);
          const enabled = locked ? 0 : enabledTypeCount(disabled, channel);
          const open = openChannel === channel;
          const summary = summaryFor(channel, enabled);
          return (
            <div
              key={channel}
              className="overflow-hidden rounded-lg border border-border bg-surface"
            >
              <div className="flex items-center gap-3 px-3 py-2.5">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface-2 text-muted">
                  <Icon className="size-4" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-medium text-dense text-text">{meta.label}</span>
                  <span className="text-muted text-xs">{summary}</span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={locked}
                  aria-expanded={open}
                  aria-label={`Customize ${meta.label}`}
                  onClick={() => setOpenChannel(open ? null : channel)}
                >
                  Customize
                  <ChevronRight
                    className={cn(
                      'size-3.5 transition-transform duration-[var(--duration-fast)] ease-[var(--ease-out-orbit)] motion-reduce:transition-none',
                      open && 'rotate-90',
                    )}
                    aria-hidden="true"
                  />
                </Button>
                <span className="h-5 w-px shrink-0 bg-border" />
                <Switch
                  checked={enabled > 0}
                  onCheckedChange={(next) => setChannelEnabled(channel, next)}
                  disabled={locked}
                  aria-label={`${meta.label} notifications`}
                />
              </div>
              <Collapsible open={open}>
                <div className="grid gap-3 border-border border-t bg-bg p-3 sm:grid-cols-2">
                  {NOTIFICATION_GROUPS.map((group) => (
                    <div
                      key={group.title}
                      className="rounded-md border border-border-subtle bg-surface"
                    >
                      <div className="flex items-center gap-2 border-border-subtle border-b px-3 py-2">
                        <span className="flex-1 font-medium text-text text-xs">{group.title}</span>
                        <span className="text-2xs text-faint">
                          {enabledGroupCount(disabled, channel, group)} of {group.types.length}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-2xs"
                          aria-label={`All ${group.title} notifications for ${meta.label}`}
                          onClick={() => setGroupEnabled(channel, group, true)}
                        >
                          All
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-1.5 text-2xs"
                          aria-label={`None of the ${group.title} notifications for ${meta.label}`}
                          onClick={() => setGroupEnabled(channel, group, false)}
                        >
                          None
                        </Button>
                      </div>
                      <div className="flex flex-col p-1.5">
                        {group.types.map((type) => {
                          const on = !disabled.has(channelTypeKey(channel, type));
                          const switchId = `${panelId}-${channel}-${type}`;
                          return (
                            <label
                              key={type}
                              htmlFor={switchId}
                              className={cn(
                                'flex cursor-pointer items-center justify-between gap-3 rounded-sm px-1.5 py-1.5 text-xs',
                                on ? 'text-secondary' : 'text-muted',
                                rowHover,
                              )}
                            >
                              {NOTIFICATION_TYPE_LABELS[type]}
                              <Switch
                                id={switchId}
                                checked={on}
                                onCheckedChange={() => toggleType(channel, type)}
                                disabled={locked}
                                aria-label={`${meta.label} for ${NOTIFICATION_TYPE_LABELS[type]}`}
                              />
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </Collapsible>
            </div>
          );
        })}
      </div>

      {props.slackDm === 'disabled' ? null : (
        <p className="text-muted text-xs">
          These Slack preferences control your personal DMs. Shared channel updates are managed by
          workspace and team admins under Integrations. Updates to the same issue, document or pull
          request stay in one Slack thread.
        </p>
      )}

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <label htmlFor="quiet-hours" className="flex items-center justify-between gap-3">
          <span className="flex flex-col">
            <span className="font-medium text-dense text-text">Quiet hours</span>
            <span className="text-muted text-xs">
              {props.slackDm === 'available'
                ? 'Email and Slack DMs are held until the window ends, in your local time.'
                : 'Email is held until the window ends, in your local time.'}
            </span>
          </span>
          <Switch
            id="quiet-hours"
            checked={quietHoursEnabled}
            onCheckedChange={edit(setQuietHoursEnabled)}
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
              onChange={(event) => edit(setQuietHoursStart)(event.target.value)}
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
              onChange={(event) => edit(setQuietHoursEnd)(event.target.value)}
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
            onCheckedChange={edit(setUrgentBypassEnabled)}
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
