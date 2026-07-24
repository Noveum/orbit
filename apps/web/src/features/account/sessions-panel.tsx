'use client';

import { relativeTime } from '@orbit/shared/utils';
import { MonitorSmartphone } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { messageOf } from '@/lib/api/client.ts';
import { authClient } from '@/lib/auth/client.ts';
import { cn } from '@/lib/cn.ts';
import { cardHover } from '@/lib/interaction.ts';
import type { SessionView } from './data.ts';

export interface SessionsPanelProps {
  readonly sessions: readonly SessionView[];
}

export function SessionsPanel({ sessions }: SessionsPanelProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const others = sessions.filter((session) => !session.current);

  const run = async (key: string, action: () => Promise<{ error?: unknown }>): Promise<void> => {
    setBusy(key);
    setError(null);
    try {
      const result = await action();
      if (result.error !== undefined && result.error !== null) {
        throw new Error('Could not revoke that session.');
      }
      toast({ title: 'Session revoked', tone: 'success' });
      router.refresh();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="sessions-panel">
      <ul className="flex flex-col gap-2">
        {sessions.map((session) => (
          <li
            key={session.id}
            data-testid={`session-${session.id}`}
            className={cn(
              'flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2.5',
              cardHover,
            )}
          >
            <MonitorSmartphone className="size-4 shrink-0 text-faint" aria-hidden="true" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-center gap-2 font-medium text-dense text-text">
                {session.device}
                {session.current ? <Badge tone="accent">This device</Badge> : null}
              </span>
              <span className="truncate text-2xs text-faint">
                {session.ipAddress ?? 'Unknown IP'}, last seen{' '}
                {relativeTime(new Date(session.lastSeenAt))}
              </span>
            </span>
            {session.current ? null : (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy !== null}
                onClick={() => {
                  run(session.id, () => authClient.revokeSession({ token: session.token }));
                }}
              >
                Revoke
              </Button>
            )}
          </li>
        ))}
      </ul>

      <div>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy !== null || others.length === 0}
          onClick={() => {
            run('all', () => authClient.revokeOtherSessions());
          }}
        >
          Sign out of all other sessions
        </Button>
      </div>

      {error === null ? null : (
        <p role="alert" className="text-danger text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
